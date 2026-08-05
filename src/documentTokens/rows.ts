/**
 * Table rows carrying repeated tokens, grown and shrunk to match the field.
 *
 * A repeated field is one key holding an array, shown as one table row per
 * element. Nothing kept the two in step, so adding a line item left the document
 * a row short and removing one left a row of zeroes standing.
 *
 * The Syncfusion behaviour relied on here is measured in
 * tests/rowMechanics.spec.ts, and none of it is what the typings suggest:
 *
 *   - `insertRow` does NOT clone the content controls of the row it copies, so a
 *     grown row arrives blank and its tokens have to be built.
 *   - `insertContentControl('Text')` DOES create a control — it is the object
 *     form that no-ops. It arrives untagged; assigning the tag makes it a token.
 *   - A control built that way survives serialise and reopen.
 *   - `deleteRow` leaves `contentControlCollection` STALE, so a row count must be
 *     read from the table widgets and never from the token collection.
 */

import {
  decodeTag,
  EditorLike,
  encodeTag,
  isDetached,
  readTokens,
  writeValues
} from './controls';
import { instanceKey, TokenSpec, valueKey } from './plan';

const controlsOf = (editor: EditorLike): any[] => {
  const collection = (editor as any)?.documentHelper?.contentControlCollection;
  return Array.isArray(collection) ? collection : [];
};

const specOf = (control: any): TokenSpec | null =>
  decodeTag(control?.contentControlProperties?.tag ?? '');

/** The table row widget a control sits in, walked by identity. */
const rowOf = (control: any): any => {
  const paragraph = control?.line?.paragraph;
  const cell = paragraph?.associatedCell ?? paragraph?.containerWidget;
  return cell?.ownerRow ?? cell?.containerWidget;
};

/**
 * How a structural step reports something it could not do.
 *
 * Every failure path here used to be a bare `continue`, which is how a row that
 * built only half its controls looked identical to one that built all of them.
 * A partially built row is not visibly wrong — the tokens that ARE there work —
 * so nothing surfaced it until someone dumped the control collection by hand.
 */
export type ProblemReporter = (message: string) => void;

/** A run of table rows standing for one repeated group. */
export type RepeatGroup = {
  table: any;
  /** Repeat index → table row index. Read from live widgets, not the tokens. */
  rows: Map<number, number>;
  /** Repeat index → the specs that row carries, with their column. */
  cells: Map<number, Array<{ spec: TokenSpec; cellIndex: number }>>;
  /** Field keys backing this group, so a removal knows what to splice. */
  sources: string[];
};

/**
 * Every group of table rows carrying repeated tokens, one per table.
 *
 * Two line-item tables give two groups; they grow and shrink independently.
 */
export const repeatGroups = (editor: EditorLike): RepeatGroup[] => {
  const byTable = new Map<any, RepeatGroup>();

  for (const control of controlsOf(editor)) {
    const spec = specOf(control);
    if (!spec || spec.index === undefined || spec.index === null) continue;
    if (isDetached(control)) continue;
    const paragraph = control?.line?.paragraph;
    const cell = paragraph?.associatedCell ?? paragraph?.containerWidget;
    const row = cell?.ownerRow ?? cell?.containerWidget;
    const table = row?.ownerTable ?? row?.containerWidget;
    if (!Array.isArray(table?.childWidgets)) continue;
    // BOTH positions by identity. A stored rowIndex/cellIndex goes stale after a
    // structural edit, and a stale column collapses every token in the row onto
    // one cell — the second control is then created inside the first and bails.
    const rowIndex = table.childWidgets.indexOf(row);
    const cellIndex = Array.isArray(row?.childWidgets)
      ? row.childWidgets.indexOf(cell)
      : -1;
    if (rowIndex === -1 || cellIndex === -1) continue;

    const group =
      byTable.get(table) ??
      ({
        table,
        rows: new Map(),
        cells: new Map(),
        sources: []
      } as RepeatGroup);
    group.rows.set(spec.index, rowIndex);
    const carried = group.cells.get(spec.index) ?? [];
    carried.push({ spec, cellIndex });
    group.cells.set(spec.index, carried);
    if (spec.source && !group.sources.includes(spec.source)) {
      group.sources.push(spec.source);
    }
    byTable.set(table, group);
  }

  return [...byTable.values()];
};

/** How many repeat rows a group currently shows. */
export const groupLength = (group: RepeatGroup): number => group.rows.size;

const selectCell = (
  editor: EditorLike,
  table: any,
  rowIndex: number,
  cellIndex: number
): boolean => {
  const paragraph =
    table.childWidgets?.[rowIndex]?.childWidgets?.[cellIndex]
      ?.childWidgets?.[0];
  const select = (editor as any)?.selection?.selectParagraphInternal;
  if (!paragraph || typeof select !== 'function') return false;
  select.call((editor as any).selection, paragraph, true);
  return true;
};

/**
 * Give an inserted row the shading of the row two above it.
 *
 * Banding in these templates is explicit per-cell shading (`F2F2F2` alternating
 * with none), not a table style the renderer re-evaluates — measured on a filled
 * document. `insertRow` copies the ADJACENT row, so a new row arrives the same
 * colour as its neighbour and the stripe breaks. The same-parity row is the one
 * two above.
 */
const restoreBanding = (table: any, rowIndex: number): void => {
  const source = table.childWidgets?.[rowIndex - 2];
  const target = table.childWidgets?.[rowIndex];
  if (!source?.childWidgets || !target?.childWidgets) return;

  target.childWidgets.forEach((cell: any, index: number) => {
    const from = source.childWidgets[index]?.cellFormat?.shading;
    const to = cell?.cellFormat?.shading;
    if (!from || !to) return;
    to.backgroundColor = from.backgroundColor;
    to.foregroundColor = from.foregroundColor;
    to.textureStyle = from.textureStyle;
  });
};

/**
 * Add rows until the group shows `target` of them, returning the specs built.
 *
 * The last existing row is the template: whichever tokens it carries, in
 * whichever columns, the next row gets the same with the following repeat index.
 * `textFor` renders each one, so a grown row arrives showing its value instead
 * of a placeholder.
 *
 * Creating the control and filling it are separate steps because
 * `insertContentControl` DISCARDS the selected text and drops in Syncfusion's
 * placeholder — measured. The value goes in afterwards through the same
 * select-then-insert write every other token update uses.
 */
export const growGroup = (
  editor: EditorLike,
  group: RepeatGroup,
  target: number,
  textFor: (spec: TokenSpec) => string,
  onProblem: ProblemReporter = () => undefined
): TokenSpec[] => {
  const indexes = [...group.rows.keys()].sort((a, b) => a - b);
  const lastIndex = indexes[indexes.length - 1];
  const template = group.cells.get(lastIndex);
  if (lastIndex === undefined || !template || template.length === 0) {
    onProblem(
      `cannot grow to ${target} rows: no template row to copy` +
        ` (${group.sources.join(', ') || 'no fields'})`
    );
    return [];
  }

  const added: TokenSpec[] = [];
  let anchorRow = group.rows.get(lastIndex) as number;

  for (let next = lastIndex + 1; next < target; next += 1) {
    // insertRow works off the selection, so sit in the row being copied.
    if (!selectCell(editor, group.table, anchorRow, template[0].cellIndex)) {
      onProblem(`cannot reach row ${anchorRow} to copy it; stopped at ${next}`);
      break;
    }
    (editor as any).editor?.insertRow?.(false, 1);
    const newRow = anchorRow + 1;

    for (const { spec, cellIndex } of template) {
      const fresh: TokenSpec = { ...spec, index: next };
      delete (fresh as any).instance;

      if (!selectCell(editor, group.table, newRow, cellIndex)) {
        onProblem(
          `cannot reach row ${newRow} column ${cellIndex} for ${fresh.id}`
        );
        continue;
      }

      // The collection is kept in DOCUMENT order, so the new control is NOT
      // the last entry — taking the last one retags whichever token follows the
      // table, destroying it. A before/after set difference fails too: the
      // editor can REPLACE the collection array, so old references never match.
      //
      // The new control is the untagged one sitting in the row just built.
      // Scoping to that row by identity is what keeps a foreign untagged
      // control elsewhere in the document from being retagged as ours.
      const targetRow = group.table.childWidgets?.[newRow];
      (editor as any).editor?.insertContentControl?.('Text');
      const built = controlsOf(editor).find(
        (candidate) =>
          !candidate?.contentControlProperties?.tag &&
          rowOf(candidate) === targetRow
      );
      if (!built?.contentControlProperties) {
        onProblem(
          `the editor created no control for ${fresh.id}` +
            ` at row ${next} column ${cellIndex}`
        );
        continue;
      }
      built.contentControlProperties.tag = encodeTag(fresh);
      built.contentControlProperties.title = fresh.id;
      built.contentControlProperties.lockContents = Boolean(fresh.formula);
      built.contentControlProperties.lockContentControl = true;
      added.push(fresh);
    }

    restoreBanding(group.table, newRow);
    // A row is all of its tokens or none of them. Half a row still renders,
    // which is exactly why this has to be said out loud.
    const builtHere = added.filter((spec) => spec.index === next).length;
    if (builtHere !== template.length) {
      onProblem(
        `row ${next} built ${builtHere} of ${template.length} tokens —` +
          ' the rest show a placeholder and stay unlinked'
      );
    }

    anchorRow = newRow;
  }

  // Fill the new controls now they carry their tags. One pass for the whole
  // batch, through the write path that is already proven against this editor.
  //
  // Empty text is written too, not skipped: a control arrives showing
  // Syncfusion's placeholder, and the write is what clears it. Leaving it meant
  // a new row read "Click here or tap to insert text" until someone typed.
  if (added.length > 0) {
    writeValues(
      editor,
      added.map((spec) => ({ id: valueKey(spec), text: textFor(spec) }))
    );
  }

  return added;
};

/**
 * Drop rows from the end until the group shows `target`, returning the repeat
 * indexes removed.
 *
 * From the end so every surviving row keeps its index and nothing is renumbered.
 */
export const shrinkGroup = (
  editor: EditorLike,
  group: RepeatGroup,
  target: number,
  onProblem: ProblemReporter = () => undefined
): number[] => {
  const descending = [...group.rows.keys()].sort((a, b) => b - a);
  const dropped: number[] = [];

  for (const index of descending) {
    if (group.rows.size - dropped.length <= target) break;
    const cells = group.cells.get(index);
    const rowIndex = group.rows.get(index);
    if (!cells || rowIndex === undefined) continue;
    if (!selectCell(editor, group.table, rowIndex, cells[0].cellIndex))
      continue;
    (editor as any).editor?.deleteRow?.();
    dropped.push(index);
  }

  if (group.rows.size - dropped.length > target) {
    onProblem(
      `wanted ${target} rows but ${group.rows.size - dropped.length} remain`
    );
  }

  return dropped;
};

/** A snapshot of each group's repeat rows, for spotting a deletion later. */
export type RowSnapshot = Array<{ sources: string[]; indexes: number[] }>;

export const rowSnapshot = (editor: EditorLike): RowSnapshot =>
  repeatGroups(editor).map((group) => ({
    sources: [...group.sources],
    indexes: [...group.rows.keys()].sort((a, b) => a - b)
  }));

/**
 * Repeat indexes gone since `before`, per group of field keys.
 *
 * This is how an editor-side row deletion is noticed. It cannot go through the
 * token collection, which still lists the deleted row's controls — measured.
 */
export const deletedRows = (
  before: RowSnapshot,
  after: RowSnapshot
): Array<{ sources: string[]; indexes: number[] }> => {
  const result: Array<{ sources: string[]; indexes: number[] }> = [];

  for (const was of before) {
    const key = was.sources.join(' ');
    const now = after.find((group) => group.sources.join(' ') === key);
    // A group gone ENTIRELY means the read found nothing, not that the reader
    // deleted every row: `contentChange` can fire while a document is still
    // loading, and inferring deletions there would splice the whole field away.
    // Only a group still present can report a missing row.
    if (!now) continue;
    const remaining = new Set(now.indexes);
    const missing = was.indexes.filter((index) => !remaining.has(index));
    if (missing.length > 0)
      result.push({ sources: was.sources, indexes: missing });
  }

  return result;
};

/**
 * The tokens the document really has.
 *
 * `readTokens` already drops any control whose row was deleted, by identity, so
 * this is a name kept for the callers that read better with it.
 */
export const liveTokens = readTokens;

/**
 * Renumber a group's rows to 0..n-1 in document order.
 *
 * A control's repeat index MUST equal its index in the field's array — every
 * read and write goes through that number. Deleting a row in the middle breaks
 * it: the survivors keep their original tags, so `{0,1,2}` minus row 1 leaves
 * controls tagged `0` and `2` over a field holding two values. The control
 * tagged `2` then reads nothing and adopts its own text back into the field,
 * and the next grown row picks index 3 against a field whose next slot is 2.
 *
 * Returns true when anything moved.
 */
export const renumberGroup = (
  editor: EditorLike,
  group: RepeatGroup
): boolean => {
  // Document order, which is what the field's values must line up with.
  const inOrder = [...group.rows.entries()].sort(
    ([, leftRow], [, rightRow]) => leftRow - rightRow
  );

  let moved = false;
  inOrder.forEach(([oldIndex], position) => {
    if (oldIndex === position) return;
    for (const { spec } of group.cells.get(oldIndex) ?? []) {
      const control = controlsOf(editor).find((candidate) => {
        const found = specOf(candidate);
        return found !== null && instanceKey(found) === instanceKey(spec);
      });
      if (!control?.contentControlProperties) continue;

      // Keep the appearance suffix: a token used twice in one row needs both
      // controls to stay separately addressable.
      const occurrence = /#(\d+)$/.exec(spec.instance ?? '');
      const renumbered: TokenSpec = { ...spec, index: position };
      if (occurrence) {
        renumbered.instance = `${spec.id}__${position}#${occurrence[1]}`;
      } else {
        delete (renumbered as any).instance;
      }
      control.contentControlProperties.tag = encodeTag(renumbered);
      moved = true;
    }
  });

  return moved;
};
