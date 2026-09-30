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
  refreshContentControlCollection,
  type ContentControlLike,
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
  const collection = editor.documentHelper?.contentControlCollection;
  if (!selection?.select || !module?.insertContentControl) {
    return false;
  }
  if (!Array.isArray(collection)) return false;
  const live = JSON.parse(editor.serialize()) as SfdtDocument;
  const previousHistory = editor.enableEditorHistory;
  const previousTracking = editor.enableTrackChanges;
  // The row insertion owns the revision. Adding its controls must be untracked
  // or Syncfusion cannot serialize their revision markers.
  editor.enableEditorHistory = false;
  editor.enableTrackChanges = false;
  try {
    for (const mutation of mutations) {
      const prefix = liveTablePrefix(editor, live, mutation.tablePath);
      if (!prefix) {
        return false;
      }
      const cells = mutation.row.cells ?? [];
      for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        if (!cell) return false;
        const plan = plannedControl(cell);
        if (!plan?.properties.tag) {
          continue;
        }
        const liveCell = getAt(live, [
          ...mutation.tablePath,
          'rows',
          mutation.rowIndex,
          'cells',
          cellIndex
        ]) as SfdtCell | undefined;
        if (!liveCell) {
          return false;
        }
        const existing = textIn(liveCell.blocks);
        const existingPlan = plannedControl(liveCell);
        if (existingPlan?.properties.tag) {
          const targetPrefix = `${prefix};${mutation.rowIndex};${cellIndex};`;
          const existingControl = collection
            .filter(
              (candidate) =>
                isContentControlAttached(candidate) &&
                String(candidate.contentControlProperties?.tag || '') ===
                  String(existingPlan.properties.tag)
            )
            .find((candidate) => {
              (selection as any).selectContentControl?.(candidate);
              return String(selection.startOffset ?? '').startsWith(
                targetPrefix
              );
            });
          if (!existingControl?.contentControlProperties) {
            return false;
          }
          const properties = existingControl.contentControlProperties;
          const titleFollowedTag = properties.title === properties.tag;
          properties.tag = plan.properties.tag;
          if (titleFollowedTag) properties.title = plan.properties.title;
          const replacement = plan.text || '\u200b';
          if (
            properties.type === 'RichText' &&
            selection.selectContentControlInternal &&
            module.insertText
          ) {
            selection.selectContentControlInternal(existingControl);
            module.insertText(replacement);
          } else if (module.updateContentControl) {
            module.updateContentControl(existingControl, replacement);
          } else {
            return false;
          }
          continue;
        }
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
        ) {
          return false;
        }
        // insertContentControl's canEdit is not reliably honored; set the lock
        // state on the created control directly so a field stays editable.
        const created = collection
          .filter(
            (candidate) =>
              isContentControlAttached(candidate) &&
              String(candidate.contentControlProperties?.tag || '') ===
                String(plan.properties.tag)
          )
          .find((candidate) => {
            (selection as any).selectContentControl?.(candidate);
            return String(selection.startOffset ?? '').startsWith(
              `${prefix};${mutation.rowIndex};${cellIndex};`
            );
          });
        if (created?.contentControlProperties) {
          created.contentControlProperties.lockContents =
            plan.properties.lockContents;
          created.contentControlProperties.lockContentControl =
            plan.properties.lockContentControl;
        } else {
        }
      }
      restyleAsDataRow(editor, prefix, mutation.rowIndex);
    }
    refreshContentControlCollection(editor);
  } finally {
    editor.enableEditorHistory = previousHistory;
    editor.enableTrackChanges = previousTracking;
  }
  return true;
}

// Syncfusion copies the ADJACENT row's formatting into a newly inserted row, so
// a row inserted above the first data row is styled like the header, and one
// inserted above a totals row is styled like the totals row. Copy formatting
// from the CLOSEST non-header sibling, preferring the one above on a tie.
function restyleAsDataRow(
  editor: SyncfusionEditorLike,
  prefix: string,
  rowIndex: number
): void {
  try {
    const selection = editor.selection as any;
    if (!selection?.select) return;
    selection.select(
      `${prefix};${rowIndex};0;0;0`,
      `${prefix};${rowIndex};0;0;0`
    );
    const insertedRow = selection.start?.paragraph?.associatedCell?.ownerRow;
    const rows: any[] = insertedRow?.ownerTable?.childWidgets ?? [];
    const myIndex = rows.indexOf(insertedRow);
    if (myIndex < 0) return;
    const isHeader = (row: any): boolean => !!row?.rowFormat?.isHeader;
    let source: any;
    for (
      let d = 1;
      !source && (myIndex - d >= 0 || myIndex + d < rows.length);
      d++
    ) {
      const above = rows[myIndex - d];
      const below = rows[myIndex + d];
      if (above && !isHeader(above)) source = above;
      else if (below && !isHeader(below)) source = below;
    }
    if (!source) {
      return;
    }
    // The source row's run character format (bold/colour/font): the first
    // element in the cell subtree that carries a text character format.
    const firstRunFormat = (node: any): any => {
      let fmt: any;
      const walk = (w: any): void => {
        if (fmt || !w || typeof w !== 'object') return;
        if (w.characterFormat && typeof w.text === 'string') {
          fmt = w.characterFormat;
          return;
        }
        for (const child of w.childWidgets ?? w.children ?? []) walk(child);
      };
      walk(node);
      return fmt;
    };
    // copyFormat only merges explicitly-set properties, so an inherited source
    // value never overrides the inserted row's explicit header/totals value.
    // Read EFFECTIVE values through the getters and assign them explicitly.
    const CHAR_PROPS = [
      'fontColor',
      'bold',
      'italic',
      'fontSize',
      'fontFamily',
      'underline',
      'strikethrough',
      'highlightColor'
    ];
    const stampRunFormat = (node: any, srcFmt: any): void => {
      if (!node || typeof node !== 'object') return;
      if (node.characterFormat) {
        for (const prop of CHAR_PROPS) {
          try {
            const value = srcFmt[prop];
            if (value !== undefined) node.characterFormat[prop] = value;
          } catch {
            /* a property a given format class doesn't carry */
          }
        }
      }
      for (const child of node.childWidgets ?? node.children ?? [])
        stampRunFormat(child, srcFmt);
    };
    const srcCells: any[] = source.childWidgets ?? [];
    (insertedRow.childWidgets ?? []).forEach((cell: any, c: number) => {
      const src = srcCells[Math.min(c, srcCells.length - 1)];
      if (!src) return;
      cell.cellFormat?.copyFormat?.(src.cellFormat);
      // Stamp the source cell's effective shading over whatever explicit
      // shading the insert cloned from the adjacent (header/totals) row.
      const srcShading = src.cellFormat?.shading;
      const destShading = cell.cellFormat?.shading;
      if (srcShading && destShading) {
        destShading.backgroundColor = srcShading.backgroundColor;
        destShading.foregroundColor = srcShading.foregroundColor;
        destShading.textureStyle = srcShading.textureStyle;
      }
      const srcPara = (src.childWidgets ?? [])[0];
      (cell.childWidgets ?? []).forEach((para: any) => {
        if (srcPara?.paragraphFormat)
          para.paragraphFormat?.copyFormat?.(srcPara.paragraphFormat);
      });
      // Reset the run fonts (incl. the control's text) to the source cell's.
      const runFmt = firstRunFormat(src);
      if (runFmt) stampRunFormat(cell, runFmt);
    });
    if (source.rowFormat) insertedRow.rowFormat?.copyFormat?.(source.rowFormat);
  } catch (thrown) {}
}

// Later mutations address pasted controls by tag before the closing relayout.
function registerPastedContentControls(editor: SyncfusionEditorLike): void {
  refreshContentControlCollection(editor);
}

const rowRevisionsOf = (control: any): number =>
  control?.line?.paragraph?.associatedCell?.ownerRow?.rowFormat
    ?.revisionLength ?? 0;

// The SDK's delete commands return nothing and refuse silently on locked content
const tookEffect = (control: any, rowRevisionsBefore: number): boolean =>
  !isContentControlAttached(control) ||
  rowRevisionsOf(control) > rowRevisionsBefore;

function selectControlCaret(
  editor: SyncfusionEditorLike,
  control: ContentControlLike
): boolean {
  const selection = editor.selection as any;
  if (!selection?.selectContentControl || !selection.select) return false;
  selection.selectContentControl(control);
  const start = selection.startOffset;
  if (typeof start !== 'string') return false;
  selection.select(start, start);
  if (!selection.currentContentControl)
    selection.currentContentControl = control;
  return true;
}

function selectAfterBlockControl(selection: any, control: ContentControlLike) {
  if (!selection?.selectContentControl || !selection.select) return false;
  selection.selectContentControl(control);
  const end = selection.endOffset;
  if (typeof end !== 'string') return false;
  const [sectionIndex, blockIndex] = end.split(';');
  const nextBlock = Number(blockIndex) + 1;
  if (!sectionIndex || !Number.isFinite(nextBlock)) return false;
  selection.select(
    `${sectionIndex};${nextBlock};0`,
    `${sectionIndex};${nextBlock};0`
  );
  return true;
}

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

function rethrowRollbackFailure(error: unknown): never {
  throw error;
}

/** One native commit boundary spanning structural commands and value writes. */
export function applyNativeTransaction(
  editor: SyncfusionEditorLike,
  run: () => boolean
): boolean {
  const history = editor.editorHistoryModule as any;
  if (!history || history.currentHistoryInfo) return false;
  const before = editor.serialize();
  const undoStack = historyStack(history, 'undoStackIn', 'undoStack');
  const redoStack = historyStack(history, 'redoStackIn', 'redoStack');
  const undoBefore = [...undoStack];
  const redoBefore = [...redoStack];
  const controlTags = (
    editor.documentHelper?.contentControlCollection ?? []
  ).map((control) => [control, control.contentControlProperties?.tag] as const);
  try {
    if (run() === true) return true;
  } catch {
    // Roll back below through the same native history that applied the edits.
  }
  for (const [control, tag] of controlTags) {
    if (control.contentControlProperties)
      control.contentControlProperties.tag = tag;
  }
  rollbackFailedNativeBatch(
    editor,
    before,
    undoBefore.length,
    Math.max(1, undoStack.length - undoBefore.length)
  );
  undoStack.splice(0, undoStack.length, ...undoBefore);
  redoStack.splice(0, redoStack.length, ...redoBefore);
  return false;
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
  const appliedRetags: Array<{ fromTag: string; toTag: string }> = [];
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
        // Retag every attached occurrence of the same formula identity.
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
        appliedRetags.push({
          fromTag: mutation.fromTag,
          toTag: mutation.toTag
        });
      } else if (mutation.kind === 'replace-table') {
        const source = controlForTag(mutation.tag);
        if (!source || !module.paste || !module.deleteTable) return false;
        if (!selectAfterBlockControl(selection, source)) return false;
        module.paste(
          JSON.stringify({
            sections: [{ blocks: mutation.blocks, headersFooters: {} }]
          })
        );
        registerPastedContentControls(editor);
        if (!selectControlCaret(editor, source)) return false;
        const rowRevisionsBefore = rowRevisionsOf(source);
        module.deleteTable();
        if (!tookEffect(source, rowRevisionsBefore)) return false;
      } else if (mutation.kind === 'delete-table') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.deleteTable || !selection.select) return false;
        if (!selectControlCaret(editor, control)) return false;
        const rowRevisionsBefore = rowRevisionsOf(control);
        module.deleteTable();
        if (!tookEffect(control, rowRevisionsBefore)) return false;
      } else if (mutation.kind === 'insert-table') {
        const control = controlForTag(mutation.afterTag);
        if (!control || !module.paste) return false;
        if (!selectAfterBlockControl(selection, control)) return false;
        module.paste(
          JSON.stringify({
            sections: [{ blocks: mutation.blocks, headersFooters: {} }]
          })
        );
        registerPastedContentControls(editor);
      } else if (mutation.kind === 'adopt-row') {
        if (!applyRowAdoptions(editor, [mutation])) {
          return false;
        }
      } else if (mutation.kind === 'delete-row') {
        const control = controlForTag(mutation.tag);
        if (!control || !module.deleteRow || !selection.select) return false;
        if (!selectControlCaret(editor, control)) return false;
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
        if (!selectControlCaret(editor, control)) return false;
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
    if (complex) history?.updateComplexHistory?.();
    let rollbackError: unknown;
    if (!succeeded) {
      try {
        rollbackFailedNativeBatch(
          editor,
          before,
          undoDepth,
          complex ? 1 : Math.max(1, mutations.length * 2)
        );
      } catch (error) {
        rollbackError = error;
      }
      for (let index = appliedRetags.length - 1; index >= 0; index--) {
        const retag = appliedRetags[index];
        for (const control of controls) {
          const properties = control.contentControlProperties;
          if (
            !properties ||
            !isContentControlAttached(control) ||
            String(properties.tag ?? '') !== retag.toTag
          )
            continue;
          properties.tag = retag.fromTag;
        }
      }
    }
    // Native commands and undo both append controls. Normalize only after the
    // transaction has reached its final document state.
    normalizeContentControlCollection(editor);
    const restored = editor.serialize() === before;
    if (!succeeded && restored)
      historyStack(history, 'redoStackIn', 'redoStack').splice(0);
    if (rollbackError && !restored) rethrowRollbackFailure(rollbackError);
  }
}
