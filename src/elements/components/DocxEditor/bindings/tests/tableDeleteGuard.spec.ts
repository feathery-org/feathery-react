// The user-facing repro this guard exists for, against a REAL DocumentEditor:
// with the caret inside a locked formula cell, deleteTable was a silent no-op
// (Syncfusion's canEditContentControl gate). The guard lifts the gate for the
// explicit whole-table gesture, asks before stranding formulas elsewhere, and
// unwraps the stranded controls to plain text in the same undo group.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { installTableDeleteGuard } from '../tableDeleteGuard';
import { SyncfusionEditorLike } from '../editorAdapter';
import { scanBindings } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, Search);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}
if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

function makeEditor(document_: unknown): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(document_));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function scan(editor: DocumentEditor) {
  return scanBindings(JSON.parse(editor.serialize()) as SfdtDocument);
}

/** Puts the caret INSIDE the first attached control carrying the tag part. */
function caretIntoControl(editor: DocumentEditor, tagPart: string): void {
  const collection = (editor as any).documentHelper
    .contentControlCollection as any[];
  const control = collection.find((entry) =>
    String(entry.contentControlProperties?.tag || '').includes(tagPart)
  );
  expect(control).toBeTruthy();
  (editor.selection as any).selectContentControlInternal(control);
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

/** Occurrences of a literal value string in the serialized document. */
function countOf(editor: DocumentEditor, value: string): number {
  return editor.serialize().split(value).length - 1;
}

/**
 * The failure the live env exposed: a control can exist in the serialized
 * document yet be invisible to every lookup because the collection is out of
 * document order. Discoverable = selecting inside it reports it.
 */
function controlIsDiscoverable(editor: DocumentEditor, tagPart: string): boolean {
  const collection = (editor as any).documentHelper
    .contentControlCollection as any[];
  const control = collection.find((entry) =>
    String(entry.contentControlProperties?.tag || '').includes(tagPart)
  );
  if (!control) return false;
  (editor.selection as any).selectContentControlInternal(control);
  return !!(editor.selection as any).currentContentControl;
}

/** True when the collection is sorted by document position. */
function collectionInDocumentOrder(editor: DocumentEditor): boolean {
  const selection = editor.selection as any;
  const collection = (editor as any).documentHelper
    .contentControlCollection as any[];
  let previous: any = null;
  for (const control of collection) {
    let position: any = null;
    try {
      position = selection.getPosition(control, true)?.startPosition ?? null;
    } catch {
      position = null;
    }
    if (!position) continue;
    if (previous && position.isExistBefore(previous)) return false;
    previous = position;
  }
  return true;
}

/** Row count of the bound costs table in the serialized document. */
function costsRowCount(editor: DocumentEditor): number {
  const doc = JSON.parse(editor.serialize()) as any;
  for (const block of doc.sections[0].blocks) {
    if (!String(block.contentControlProperties?.tag || '').includes('costs'))
      continue;
    const table = (block.blocks ?? []).find((child: any) =>
      Array.isArray(child.rows)
    );
    if (table) return table.rows.length;
  }
  return -1;
}

describe('installTableDeleteGuard', () => {
  let editor: DocumentEditor;
  let uninstall: () => void = () => undefined;

  afterEach(() => {
    uninstall();
    destroy(editor);
  });

  it('reproduces the bug without the guard: deleteTable from a locked cell is a silent no-op', () => {
    editor = makeEditor(buildCostsFixture());
    caretIntoControl(editor, 'grand_total');
    (editor as any).editorModule.deleteTable();
    expect(scan(editor).tables.has('costs')).toBe(true);
  });

  it('deletes from a locked formula cell, confirming and unwrapping stranded formulas', async () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(true));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    caretIntoControl(editor, 'grand_total');
    (editor as any).editorModule.deleteTable();
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      confirm.mock.calls[0][0].orphans.map((orphan: any) => orphan.name)
    ).toEqual(['combined_total', 'grand_total']);

    const index = scan(editor);
    expect(index.tables.has('costs')).toBe(false);
    // Stranded formulas became plain text: control gone, cached number kept.
    expect(index.formulas.has('grand_total')).toBe(false);
    expect(index.formulas.has('combined_total')).toBe(false);
    const text = editor.serialize();
    expect(text).toContain('$7,800.00');
    expect(text).toContain('$9,500.00');
  });

  it('cancelling keeps the document untouched', async () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(false));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    caretIntoControl(editor, 'grand_total');
    (editor as any).editorModule.deleteTable();
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    const index = scan(editor);
    expect(index.tables.has('costs')).toBe(true);
    expect(index.formulas.has('grand_total')).toBe(true);
  });

  it('deletes without asking when nothing outside the table reads it', async () => {
    const doc = buildCostsFixture();
    // Drop the prose consumers (combined_total para, amount-due para).
    doc.sections?.[0]?.blocks?.splice(8, 1);
    doc.sections?.[0]?.blocks?.splice(4, 1);
    editor = makeEditor(doc);
    const confirm = jest.fn(() => Promise.resolve(true));
    const onDeleted = jest.fn();
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm, onDeleted }
    );

    caretIntoControl(editor, 'grand_total');
    (editor as any).editorModule.deleteTable();

    expect(confirm).not.toHaveBeenCalled();
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(scan(editor).tables.has('costs')).toBe(false);
  });

  it('one undo restores the table and the re-wrapped prose formulas atomically', async () => {
    editor = makeEditor(buildCostsFixture());
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm: () => Promise.resolve(true) }
    );

    caretIntoControl(editor, 'grand_total');
    (editor as any).editorModule.deleteTable();
    await flush();
    expect(scan(editor).tables.has('costs')).toBe(false);

    const history = (editor as any).editorHistoryModule;
    // The delete + unwraps are one grouped entry: a single undo restores the
    // table AND re-wraps the prose formulas around their values.
    history.undo();
    const restored = scan(editor);
    expect(restored.tables.has('costs')).toBe(true);
    expect(restored.formulas.has('grand_total')).toBe(true);
    expect(restored.formulas.has('combined_total')).toBe(true);
    // The restore must not duplicate the value text beside the re-wrapped
    // control ('$9,500.00' exists exactly once in the original document).
    expect(countOf(editor, '$9,500.00')).toBe(1);

    // A single redo replays the whole group.
    history.redo();
    const redone = scan(editor);
    expect(redone.tables.has('costs')).toBe(false);
    expect(redone.formulas.has('combined_total')).toBe(false);
    expect(countOf(editor, '$9,500.00')).toBe(1);

    // Editing after an undo clears the redo stack; that teardown crashing is
    // exactly what grouping removeContentControl entries did, so pin that the
    // InsertText/DeleteTable group survives it (and editor destroy in
    // afterEach covers the other teardown surface).
    history.undo();
    (editor as any).editorModule.insertText('x');
    expect(scan(editor).tables.has('costs')).toBe(true);
    expect(countOf(editor, '$9,500.00')).toBe(1);
  });

  it('reproduces the row bug without the guard: deleteRow from a locked cell is a silent no-op', () => {
    editor = makeEditor(buildCostsFixture());
    caretIntoControl(editor, 'line_total');
    (editor as any).editorModule.deleteRow();
    expect(costsRowCount(editor)).toBe(6);
  });

  it('deletes a data row from its locked formula cell without asking', () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(true));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    caretIntoControl(editor, 'line_total');
    (editor as any).editorModule.deleteRow();

    expect(confirm).not.toHaveBeenCalled();
    expect(costsRowCount(editor)).toBe(5);
  });

  it('deleting the Subtotal row confirms and unwraps everything that read it', async () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(true));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    caretIntoControl(editor, 'costs_subtotal');
    (editor as any).editorModule.deleteRow();
    await flush();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].scope).toBe('row');
    expect(
      confirm.mock.calls[0][0].orphans.map((orphan: any) => orphan.name)
    ).toEqual(['combined_total', 'costs_tax', 'grand_total']);

    const index = scan(editor);
    expect(costsRowCount(editor)).toBe(5);
    expect(index.formulas.has('grand_total')).toBe(false);
    expect(index.formulas.has('costs_tax')).toBe(false);
    // Values survive as plain text: Total cell + prose repeat keep $7,800.00
    // (the Subtotal copy died with its row).
    expect(countOf(editor, '$7,800.00')).toBe(2);

    // Row entries cannot be natively grouped on this Syncfusion version
    // (table-clone reverts crash inside complex history), so the guard chains
    // the sequential entries instead: ONE undo gesture walks the whole set.
    const history = (editor as any).editorHistoryModule;
    history.undo();
    const restored = scan(editor);
    expect(costsRowCount(editor)).toBe(6);
    expect(restored.formulas.has('grand_total')).toBe(true);
    expect(restored.formulas.has('costs_tax')).toBe(true);
    expect(restored.formulas.has('combined_total')).toBe(true);
    expect(countOf(editor, '$7,800.00')).toBe(3);
    // Existing in the model is not enough - the restored controls must be
    // discoverable (collection in document order), or they render and behave
    // as plain text even though serialize still shows them.
    expect(collectionInDocumentOrder(editor)).toBe(true);
    expect(controlIsDiscoverable(editor, 'name=costs_subtotal')).toBe(true);
    expect(controlIsDiscoverable(editor, 'name=combined_total')).toBe(true);

    // One redo gesture replays the whole set.
    history.redo();
    expect(costsRowCount(editor)).toBe(5);
    expect(scan(editor).formulas.has('grand_total')).toBe(false);
    expect(countOf(editor, '$7,800.00')).toBe(2);

    // An unrelated edit after the restore is NOT chained into the set: its
    // undo removes only itself.
    history.undo();
    (editor as any).editorModule.insertText('x');
    history.undo();
    expect(costsRowCount(editor)).toBe(6);
    expect(scan(editor).formulas.has('grand_total')).toBe(true);
  });

  it('passes through untouched under track changes', async () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(true));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    editor.enableTrackChanges = true;
    caretIntoControl(editor, 'grand_total');
    (editor as any).editorModule.deleteTable();
    await flush();

    expect(confirm).not.toHaveBeenCalled();
    expect(scan(editor).tables.has('costs')).toBe(true);
  });

  it('routes whole-row Delete/Backspace on a bound table through the guard', async () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(true));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    caretIntoControl(editor, 'costs_subtotal');
    (editor.selection as any).selectRow();
    const args = { event: { key: 'Backspace' }, isHandled: false };
    (editor as any).trigger('keyDown', args);
    await flush();

    expect(args.isHandled).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0].scope).toBe('row');
    expect(costsRowCount(editor)).toBe(5);
  });

  it('routes whole-table Delete/Backspace on a bound table through the guard', async () => {
    editor = makeEditor(buildCostsFixture());
    const confirm = jest.fn(() => Promise.resolve(true));
    uninstall = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike,
      { confirm }
    );

    caretIntoControl(editor, 'grand_total');
    (editor.selection as any).selectTable();
    const args = { event: { key: 'Backspace' }, isHandled: false };
    (editor as any).trigger('keyDown', args);
    await flush();

    expect(args.isHandled).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(scan(editor).tables.has('costs')).toBe(false);
  });

  it('uninstall restores the original method', () => {
    editor = makeEditor(buildCostsFixture());
    const module = (editor as any).editorModule;
    const original = module.deleteTable;
    const restore = installTableDeleteGuard(
      editor as unknown as SyncfusionEditorLike
    );
    expect(module.deleteTable).not.toBe(original);
    restore();
    expect(module.deleteTable).toBe(original);
  });
});
