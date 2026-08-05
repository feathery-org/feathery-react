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
  readTokens,
  writeValues
} from './controls';
import { instanceKey, TokenSpec, valueKey } from './plan';

/** The widget chain from a control to its table. Minified classes, stable props. */
type Placement = { table: any; rowIndex: number; cellIndex: number };

const placementOf = (control: any): Placement | null => {
  const paragraph = control?.line?.paragraph;
  const cell = paragraph?.associatedCell ?? paragraph?.containerWidget;
  const row = cell?.ownerRow ?? cell?.containerWidget;
  const table = row?.ownerTable ?? row?.containerWidget;
  if (!table?.childWidgets || typeof row?.rowIndex !== 'number') return null;
  return { table, rowIndex: row.rowIndex, cellIndex: cell.cellIndex ?? 0 };
};

const controlsOf = (editor: EditorLike): any[] => {
  const collection = (editor as any)?.documentHelper?.contentControlCollection;
  return Array.isArray(collection) ? collection : [];
};

const specOf = (control: any): TokenSpec | null =>
  decodeTag(control?.contentControlProperties?.tag ?? '');

/** A control still sitting in a row the table actually has. */
const isLive = (placement: Placement | null): boolean =>
  placement !== null &&
  placement.rowIndex < (placement.table.childWidgets?.length ?? 0) &&
  placement.table.childWidgets[placement.rowIndex] !== undefined;

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
    const placement = placementOf(control);
    if (!isLive(placement)) continue;
    const { table, rowIndex, cellIndex } = placement as Placement;

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
  textFor: (spec: TokenSpec) => string
): TokenSpec[] => {
  const indexes = [...group.rows.keys()].sort((a, b) => a - b);
  const lastIndex = indexes[indexes.length - 1];
  const template = group.cells.get(lastIndex);
  if (lastIndex === undefined || !template || template.length === 0) return [];

  const added: TokenSpec[] = [];
  let anchorRow = group.rows.get(lastIndex) as number;

  for (let next = lastIndex + 1; next < target; next += 1) {
    // insertRow works off the selection, so sit in the row being copied.
    if (!selectCell(editor, group.table, anchorRow, template[0].cellIndex)) {
      break;
    }
    (editor as any).editor?.insertRow?.(false, 1);
    const newRow = anchorRow + 1;

    for (const { spec, cellIndex } of template) {
      const fresh: TokenSpec = { ...spec, index: next };
      delete (fresh as any).instance;

      if (!selectCell(editor, group.table, newRow, cellIndex)) continue;

      // The collection is kept in DOCUMENT order, so the new control is NOT
      // the last entry — taking the last one retags whichever token follows the
      // table, destroying it. Find the control that was not there before.
      const existing = new Set(controlsOf(editor));
      (editor as any).editor?.insertContentControl?.('Text');
      const built = controlsOf(editor).find(
        (candidate) => !existing.has(candidate)
      );
      if (!built?.contentControlProperties) continue;
      built.contentControlProperties.tag = encodeTag(fresh);
      built.contentControlProperties.title = fresh.id;
      built.contentControlProperties.lockContents = Boolean(fresh.formula);
      built.contentControlProperties.lockContentControl = true;
      added.push(fresh);
    }

    restoreBanding(group.table, newRow);
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
  target: number
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

/** Addresses of controls whose row is gone — the stale collection entries. */
export const staleControls = (editor: EditorLike): string[] => {
  const stale: string[] = [];
  for (const control of controlsOf(editor)) {
    const spec = specOf(control);
    if (!spec) continue;
    const placement = placementOf(control);
    // No placement means the token is not in a table at all — a scalar like
    // `subtotal`. Only a control whose row is genuinely gone counts as stale.
    if (placement === null || isLive(placement)) continue;
    stale.push(instanceKey(spec));
  }
  return stale;
};

/**
 * The tokens the document really has, ignoring controls whose row was deleted.
 *
 * Falls back to the plain read when nothing is stale, and when the widget chain
 * is unavailable — a token outside a table has no placement, and must not be
 * mistaken for a deleted one.
 */
export const liveTokens = (
  editor: EditorLike
): Array<{ spec: TokenSpec; value: string }> => {
  const dead = new Set(staleControls(editor));
  if (dead.size === 0) return readTokens(editor);
  return readTokens(editor).filter(
    (entry) => !dead.has(instanceKey(entry.spec))
  );
};

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

/**
 * Drop controls whose row was deleted out of Syncfusion's own collection.
 *
 * `deleteRow` leaves them behind (measured), and filtering them out by address
 * is not enough: renumbering a survivor can give it the same address as a dead
 * entry, and then both disappear. Removing them is the only way the collection
 * stays a truthful list of what the document holds.
 */
export const pruneDeleted = (editor: EditorLike): string[] => {
  const collection = (editor as any)?.documentHelper?.contentControlCollection;
  if (!Array.isArray(collection)) return [];

  const dropped: string[] = [];
  for (let at = collection.length - 1; at >= 0; at -= 1) {
    const spec = specOf(collection[at]);
    if (!spec) continue;
    const placement = placementOf(collection[at]);
    if (placement === null || isLive(placement)) continue;
    dropped.push(instanceKey(spec));
    collection.splice(at, 1);
  }
  return dropped;
};
