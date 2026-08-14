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
  editor.enableEditorHistory = false;
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
  }
  return true;
}

function needsGroupedHistory(mutations: NativeStructuralMutation[]): boolean {
  return mutations.length > 1;
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
      if (mutation.kind === 'delete-table') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.delete) return false;
        selection.selectContentControl(control);
        module.delete();
      } else if (mutation.kind === 'insert-table') {
        const control = controlForTag(mutation.afterTag);
        if (!control || !selection.collapseToEnd || !module.paste) return false;
        selection.selectContentControl(control);
        selection.collapseToEnd();
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
