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

function tableSelectionPrefix(path: Array<string | number>): string | null {
  const sectionKey = path.indexOf('sections');
  const blocksKey = path.indexOf('blocks', sectionKey + 2);
  const section = path[sectionKey + 1];
  const block = path[blocksKey + 1];
  return typeof section === 'number' && typeof block === 'number'
    ? `${section};${block}`
    : null;
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
      const prefix = tableSelectionPrefix(mutation.tablePath);
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

function needsGroupedHistory(mutations: NativeStructuralMutation[]): boolean {
  return mutations.length > 1;
}

/**
 * A tracked row deletion DESTROYS the binding identity of everything it removes,
 * and no reject brings it back.
 *
 * Measured: `Editor.prototype.handleDeleteTracking` gives a BookmarkElementBox
 * an `insertRevision(el, 'Deletion')` and lets a ContentControl fall to the else
 * branch, where it is spliced out of the line immediately and revision-lessly.
 * Counting a bound row's tags across the three stages gives 4 -> 0 -> 0: present,
 * gone the instant the deletion is applied, still gone after `rejectAll`. The
 * row comes back; its bindings do not. Undo is unaffected only because DeleteRow
 * clones the whole table into history.
 *
 * Every delete-row and delete-table mutation reaching this adapter names bound
 * content by construction, so there is no narrower condition to test - the
 * refusal is the honest shape of what this path can do today.
 *
 * This is deliberately a REFUSAL rather than a silent success. Losing the links
 * inside a client's document is not a degraded result, it is a corrupted one,
 * and the caller is told instead. It is a safety net, not a resting place: the
 * composed split deletes complement rows in both halves, so this also declines
 * that capability until the identity question is settled. See
 * data/docx-master-defect-undo.md.
 */
function refusesBoundDeletion(mutation: NativeStructuralMutation): boolean {
  return mutation.kind === 'delete-row' || mutation.kind === 'delete-table';
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

  let complex = false;
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
      // Checked before anything is applied: a batch that would strip identity
      // must not half-land its other mutations first.
      if (refusesBoundDeletion(mutation)) return false;
      if (mutation.kind === 'delete-table') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.delete) return false;
        selection.selectContentControl(control);
        module.delete();
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
      } else if (mutation.kind === 'adopt-row') {
        if (!applyRowAdoptions(editor, [mutation])) return false;
      } else if (mutation.kind === 'delete-row') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.deleteRow) return false;
        selection.selectContentControl(control);
        module.deleteRow();
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
    return true;
  } finally {
    nativeApplyDepth -= 1;
    if (complex) history?.updateComplexHistory?.();
  }
}
