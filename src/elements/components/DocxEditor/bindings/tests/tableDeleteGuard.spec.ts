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

  it('undo walks back through consistent documents to a full restore', async () => {
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
    // First undo restores the table (its own controls with it); the prose
    // formulas stay plain text - a consistent, evaluable document.
    history.undo();
    const partial = scan(editor);
    expect(partial.tables.has('costs')).toBe(true);
    expect(partial.formulas.has('combined_total')).toBe(false);
    // Two more undos re-wrap the prose formulas.
    history.undo();
    history.undo();
    const restored = scan(editor);
    expect(restored.tables.has('costs')).toBe(true);
    expect(restored.formulas.has('grand_total')).toBe(true);
    expect(restored.formulas.has('combined_total')).toBe(true);
    // Editing after the undos clears the redo stack; that teardown crashing
    // is exactly what grouped complex history did, so pin that it does not.
    (editor as any).editorModule.insertText('x');
    expect(scan(editor).tables.has('costs')).toBe(true);
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
