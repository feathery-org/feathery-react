import {
  AdoptedRowMutation,
  getAt,
  NativeStructuralMutation,
  scanBindings
} from './core/sfdtAdapter';
import {
  ContentControlProperties,
  SfdtCell,
  SfdtDocument,
  SfdtInline
} from './core/sfdtTypes';
import {
  isContentControlAttached,
  normalizeContentControlCollection,
  type SyncfusionEditorLike
} from './editorAdapter';

let nativeApplyDepth = 0;

/** True while a live structural patch is applying native row/table commands. */
export function isApplyingNativeStructuralMutations(): boolean {
  return nativeApplyDepth > 0;
}

function textIn(node: unknown): string {
  if (Array.isArray(node)) return node.map(textIn).join('');
  if (!node || typeof node !== 'object') return '';
  const record = node as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  return Object.values(record).map(textIn).join('');
}

function plannedControl(
  cell: SfdtCell
): { properties: ContentControlProperties; text: string } | null {
  let result: { properties: ContentControlProperties; text: string } | null =
    null;
  const visit = (node: unknown): void => {
    if (result || !node) return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.contentControlProperties) {
      result = {
        properties: record.contentControlProperties as ContentControlProperties,
        text: textIn(record.inlines as SfdtInline[])
      };
      return;
    }
    Object.values(record).forEach(visit);
  };
  visit(cell);
  return result;
}

// A foreign block-level control ahead of the table shifts the live block
// index away from the SFDT path, so the address is read off the marker
function liveTablePrefix(
  editor: SyncfusionEditorLike,
  live: SfdtDocument,
  tablePath: Array<string | number>
): string | null {
  const selection = editor.selection as any;
  const controls = editor.documentHelper?.contentControlCollection;
  const wrapper = getAt(live, tablePath.slice(0, -2)) as
    | { contentControlProperties?: ContentControlProperties }
    | undefined;
  const markerTag = wrapper?.contentControlProperties?.tag;
  const marker =
    markerTag && Array.isArray(controls)
      ? controls.find(
          (control) =>
            isContentControlAttached(control) &&
            String(control.contentControlProperties?.tag || '') === markerTag
        )
      : undefined;
  if (!marker || !selection?.selectContentControl) return null;
  selection.selectContentControl(marker);
  const start = selection.startOffset;
  if (typeof start !== 'string') return null;
  const [section, block] = start.split(';');
  return section && block ? `${section};${block}` : null;
}

function applyRowAdoptions(
  editor: SyncfusionEditorLike,
  mutations: AdoptedRowMutation[]
): boolean {
  const selection = editor.selection;
  const module = editor.editorModule as any;
  if (!selection?.select || !module?.insertContentControl) return false;
  const live = JSON.parse(editor.serialize()) as SfdtDocument;
  const previousHistory = editor.enableEditorHistory;
  const previousTracking = editor.enableTrackChanges;
  // Adoption is not an edit in its own right. The row it fills was just
  // inserted by the structural mutation, and under an authored batch that
  // insertion already carries the revision the reviewer sees - so the controls
  // inside it need neither their own history entries (the reason this function
  // already suspended history) nor their own revisions. Leaving tracking on
  // here also made the SDK's own serializer throw
  // `Cannot set properties of undefined (setting 'revisionIds')` from
  // writeInlineRevisions, because a content control inserted into an
  // already-tracked row produces revision markers it cannot write back out.
  editor.enableEditorHistory = false;
  editor.enableTrackChanges = false;
  try {
    for (const mutation of mutations) {
      const prefix = liveTablePrefix(editor, live, mutation.tablePath);
      if (!prefix) return false;
      const cells = mutation.row.cells ?? [];
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        if (!cell) return false;
        const plan = plannedControl(cell);
        if (!plan?.properties.tag) continue;
        const liveCell = getAt(live, [
          ...mutation.tablePath,
          'rows',
          mutation.rowIndex,
          'cells',
          cellIndex
        ]) as SfdtCell | undefined;
        if (!liveCell) return false;
        const existing = textIn(liveCell.blocks);
        selection.select(
          `${prefix};${mutation.rowIndex};${cellIndex};0;0`,
          `${prefix};${mutation.rowIndex};${cellIndex};0;${existing.length}`
        );
        if (
          !module.insertContentControl({
            type: 'Text',
            title: plan.properties.title,
            tag: plan.properties.tag,
            value: plan.text || '\u200b',
            canDelete: !plan.properties.lockContentControl,
            canEdit: !plan.properties.lockContents
          })
        )
          return false;
      }
    }
  } finally {
    editor.enableEditorHistory = previousHistory;
    editor.enableTrackChanges = previousTracking;
  }
  return true;
}

/**
 * Make a just-pasted table's content controls addressable by tag.
 *
 * The SDK registers a ContentControl in `documentHelper.contentControlCollection`
 * only while LAYING OUT the line that holds it (layout.js, layoutLine). An
 * assistant batch runs with layout suspended, so a natively pasted copy's
 * controls stayed unregistered until the batch's closing relayout - and the
 * value writes that follow the paste in the same transaction (the copy's
 * recomputed formulas) found no control for their tags. The controller then
 * recorded native-mutation-failed and never committed its model, a failure the
 * old runCommands return silently discarded. A whole-document layout here is
 * idempotent (the SDK guards the push with indexOf) and registers everything.
 */
function registerPastedContentControls(editor: SyncfusionEditorLike): void {
  const live = editor as any;
  const layout = live.documentHelper?.layout;
  if (typeof layout?.layoutWholeDocument !== 'function') return;
  const layoutWasOn = live.enableLayout === true;
  if (!layoutWasOn) live.setProperties?.({ enableLayout: true }, true);
  try {
    layout.layoutWholeDocument();
  } finally {
    if (!layoutWasOn) live.setProperties?.({ enableLayout: false }, true);
  }
  // Registration appends; the SDK's lookups assume document order.
  normalizeContentControlCollection(editor);
}

const rowRevisionsOf = (control: any): number =>
  control?.line?.paragraph?.associatedCell?.ownerRow?.rowFormat
    ?.revisionLength ?? 0;

// The SDK's delete commands return nothing and refuse silently on locked content
const tookEffect = (control: any, rowRevisionsBefore: number): boolean =>
  !isContentControlAttached(control) ||
  rowRevisionsOf(control) > rowRevisionsBefore;

function needsGroupedHistory(mutations: NativeStructuralMutation[]): boolean {
  return (
    mutations.length > 1 ||
    mutations.some((mutation) => mutation.kind === 'replace-table')
  );
}

function historyStack(history: any, primary: string, fallback: string): any[] {
  const stack = history?.[primary] ?? history?.[fallback];
  return Array.isArray(stack) ? stack : [];
}

function rollbackFailedNativeBatch(
  editor: SyncfusionEditorLike,
  before: string,
  undoDepth: number,
  maxUndos: number
): void {
  if (editor.serialize() === before) return;
  const history = (editor as any).editorHistory ?? editor.editorHistoryModule;
  const undo = history?.undo;
  for (let count = 0; count < maxUndos; count++) {
    const stack = historyStack(history, 'undoStackIn', 'undoStack');
    if (typeof undo !== 'function' || stack.length <= undoDepth) break;
    undo.call(history);
    if (editor.serialize() === before) {
      historyStack(history, 'redoStackIn', 'redoStack').splice(0);
      return;
    }
  }
  throw new Error('native structural rollback did not restore the document');
}

export function applyNativeStructuralMutations(
  editor: SyncfusionEditorLike,
  mutations: NativeStructuralMutation[]
): boolean {
  const module = editor.editorModule as any;
  const selection = editor.selection as any;
  const history = editor.editorHistoryModule as any;
  const controls = editor.documentHelper?.contentControlCollection;
  if (!module || !selection?.selectContentControl || !Array.isArray(controls))
    return false;
  const controlForTag = (tag: string) =>
    controls.find(
      (control) =>
        isContentControlAttached(control) &&
        String(control.contentControlProperties?.tag || '') === String(tag)
    );

  const before = editor.serialize();
  const undoDepth = historyStack(history, 'undoStackIn', 'undoStack').length;
  let complex = false;
  let succeeded = false;
  nativeApplyDepth += 1;
  try {
    if (
      needsGroupedHistory(mutations) &&
      !history?.currentHistoryInfo &&
      typeof module.initComplexHistory === 'function'
    ) {
      module.initComplexHistory('Grouping');
      complex = true;
    }
    for (const mutation of mutations) {
      if (mutation.kind === 'retag-control') {
        // There is no SDK call for this: `contentControlProperties` IS the live
        // model, and what it holds is what `serialize` reads back. Every
        // ATTACHED control wearing the old tag is retagged, so a formula with
        // several occurrences moves as one; a detached leftover is skipped
        // because it is no longer part of the document.
        const matches = controls.filter(
          (control) =>
            isContentControlAttached(control) &&
            String(control.contentControlProperties?.tag || '') ===
              String(mutation.fromTag)
        );
        if (!matches.length) return false;
        for (const control of matches)
          (control.contentControlProperties as { tag?: string }).tag =
            mutation.toTag;
      } else if (mutation.kind === 'replace-table') {
        const source = controlForTag(mutation.tag);
        if (
          !source ||
          !selection.select ||
          !module.paste ||
          !module.deleteTable
        )
          return false;
        selection.selectContentControl(source);
        const end = selection.endOffset;
        if (typeof end !== 'string') return false;
        const [sectionIndex, blockIndex] = end.split(';');
        const nextBlock = Number(blockIndex) + 1;
        if (!sectionIndex || !Number.isFinite(nextBlock)) return false;
        selection.select(
          `${sectionIndex};${nextBlock};0`,
          `${sectionIndex};${nextBlock};0`
        );
        module.paste(
          JSON.stringify({
            sections: [{ blocks: mutation.blocks, headersFooters: {} }]
          })
        );
        registerPastedContentControls(editor);
        selection.selectContentControl(source);
        const start = selection.startOffset;
        if (typeof start !== 'string') return false;
        selection.select(start, start);
        if (!selection.currentContentControl)
          selection.currentContentControl = source;
        const rowRevisionsBefore = rowRevisionsOf(source);
        module.deleteTable();
        if (!tookEffect(source, rowRevisionsBefore)) return false;
      } else if (mutation.kind === 'delete-table') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.deleteTable || !selection.select) return false;
        selection.selectContentControl(control);
        // deleteTable marks the rows deleted where delete() only strikes text,
        // and it refuses a selection spanning a locked control
        const start = selection.startOffset;
        if (typeof start !== 'string') return false;
        selection.select(start, start);
        // The SDK misses a pasted wrapper as the enclosing control and reads the caret as locked
        if (!selection.currentContentControl)
          selection.currentContentControl = control;
        const rowRevisionsBefore = rowRevisionsOf(control);
        module.deleteTable();
        if (!tookEffect(control, rowRevisionsBefore)) return false;
      } else if (mutation.kind === 'insert-table') {
        const control = controlForTag(mutation.afterTag);
        // `collapseToEnd` does not exist on this SDK - not on Selection, not
        // anywhere in the shipped bundle - so this guard could never pass and
        // the branch below had never once run. Every table the assistant has
        // ever created reached the document through the reopen instead, which
        // is why the reopen's cost went unnoticed for so long.
        // Collapsing is expressed with documented API: an empty range at the
        // control's own end offset.
        if (!control || !selection.select || !module.paste) return false;
        selection.selectContentControl(control);
        // Selecting a block-level control that WRAPS A TABLE leaves the end
        // offset inside the table's last cell (`0;6;5;1;0;12`), not after the
        // table. Pasting there nests the new table inside a cell of the old
        // one - which still satisfies a naive "is the copy in the index?"
        // check, because the binding scan walks nested tables. The anchor must
        // therefore be the start of the FOLLOWING top-level block.
        const end = selection.endOffset;
        if (typeof end !== 'string') return false;
        const [sectionIndex, blockIndex] = end.split(';');
        const nextBlock = Number(blockIndex) + 1;
        if (!sectionIndex || !Number.isFinite(nextBlock)) return false;
        selection.select(
          `${sectionIndex};${nextBlock};0`,
          `${sectionIndex};${nextBlock};0`
        );
        module.paste(
          JSON.stringify({
            sections: [{ blocks: mutation.blocks, headersFooters: {} }]
          })
        );
        registerPastedContentControls(editor);
      } else if (mutation.kind === 'adopt-row') {
        if (!applyRowAdoptions(editor, [mutation])) return false;
      } else if (mutation.kind === 'delete-row') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.deleteRow || !selection.select) return false;
        selection.selectContentControl(control);
        // A selection spanning the control can read as every row of a pasted table
        const start = selection.startOffset;
        if (typeof start !== 'string') return false;
        selection.select(start, start);
        if (!selection.currentContentControl)
          selection.currentContentControl = control;
        const rowRevisionsBefore = rowRevisionsOf(control);
        module.deleteRow();
        if (!tookEffect(control, rowRevisionsBefore)) return false;
      } else if (mutation.kind === 'insert-row') {
        const current = scanBindings(
          JSON.parse(editor.serialize()) as SfdtDocument
        );
        const table = current.tables.get(mutation.tableId);
        const anchorRow = mutation.afterRowId
          ? table?.rows.find((row) => row.rowId === mutation.afterRowId)
          : table?.rows[0];
        const tag = anchorRow && [...anchorRow.bindings.values()][0]?.tag;
        const control = tag && controlForTag(tag);
        if (!control || !module.insertRow) return false;
        selection.selectContentControl(control);
        module.insertRow(mutation.afterRowId == null, 1);
        if (
          !applyRowAdoptions(editor, [
            {
              kind: 'adopt-row',
              tableId: mutation.tableId,
              tablePath: mutation.tablePath,
              rowIndex: mutation.rowIndex,
              rowId: mutation.rowId,
              row: mutation.row
            }
          ])
        )
          return false;
      } else {
        return false;
      }
    }
    succeeded = true;
    return true;
  } finally {
    nativeApplyDepth -= 1;
    // Every native structural command that (re)registers controls appends them;
    // leave the collection in document order whatever path ran.
    normalizeContentControlCollection(editor);
    if (complex) history?.updateComplexHistory?.();
    if (!succeeded)
      rollbackFailedNativeBatch(
        editor,
        before,
        undoDepth,
        complex ? 1 : Math.max(1, mutations.length * 2)
      );
  }
}
