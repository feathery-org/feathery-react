import 'jest-canvas-mock';
import { DocumentEditor } from '@syncfusion/ej2-documenteditor';
import { attachBindings, AttachedBindings } from '../attachBindings';
import { scanBindings } from '../core/sfdtAdapter';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';
import { SfdtDocument } from '../core/sfdtTypes';
import { SyncfusionEditorLike } from '../editorAdapter';
import { bindingCommandSurfaceFor } from '../reconcileRegistry';
import {
  destroyRealDocumentEditor,
  makeRealDocumentEditor
} from './realEditorHarness';

const QUANTITY_R1 = '[[name=quantity|type=integer|row=r-1]]';
const QUANTITY_R2 = '[[name=quantity|type=integer|row=r-2]]';

const indexOf = (editor: DocumentEditor) =>
  scanBindings(JSON.parse(editor.serialize()) as SfdtDocument);

const costsRows = (editor: DocumentEditor) =>
  indexOf(editor).tables.get('costs')!.rows;

const costsCell = (editor: DocumentEditor, rowId: string, column: string) =>
  costsRows(editor).find((row) => row.rowId === rowId)?.bindings.get(column)
    ?.text;

const grandTotal = (editor: DocumentEditor) =>
  indexOf(editor).formulas.get('grand_total')![0].text;

function controlForTag(editor: DocumentEditor, tag: string) {
  const collection = (editor as any).documentHelper.contentControlCollection;
  return collection.find(
    (candidate: any) => candidate?.contentControlProperties?.tag === tag
  );
}

function writeIntoControl(
  editor: DocumentEditor,
  tag: string,
  text: string
): void {
  const control = controlForTag(editor, tag);
  if (!control) throw new Error(`no control for ${tag}`);
  (editor as any).editorModule.updateContentControl(control, text);
}

function stacks(editor: DocumentEditor): { undo: number; redo: number } {
  const history = (editor as any).editorHistoryModule ?? editor.editorHistory;
  const undo = history.undoStackIn ?? history.undoStack;
  const redo = history.redoStackIn ?? history.redoStack;
  return {
    undo: Array.isArray(undo) ? undo.length : 0,
    redo: Array.isArray(redo) ? redo.length : 0
  };
}

function insertRowBelow(editor: DocumentEditor, tag: string): void {
  const control = controlForTag(editor, tag);
  if (!control) throw new Error(`no control for ${tag}`);
  editor.selection.selectContentControl(control);
  (editor as any).editorModule.insertRow(false, 1);
}

function deleteRowAt(editor: DocumentEditor, tag: string): void {
  const control = controlForTag(editor, tag);
  if (!control) throw new Error(`no control for ${tag}`);
  editor.selection.selectContentControl(control);
  (editor as any).editorModule.deleteRow();
}

describe('one native binding history timeline', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeRealDocumentEditor(buildCostsFixture());
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroyRealDocumentEditor(editor);
  });

  it('interleaves bound values and assistant rows without reloading', () => {
    const surface = bindingCommandSurfaceFor(editor)!;
    const open = jest.spyOn(editor, 'open');
    const before = stacks(editor).undo;

    surface.runCommands([
      { type: 'set-value', name: 'project.name', value: 'Bridge run' }
    ]);
    const afterName = stacks(editor).undo;
    expect(afterName).toBeGreaterThanOrEqual(before);
    surface.runCommands([
      {
        type: 'add-row',
        tableId: 'costs',
        afterRowId: 'r-2',
        rowId: 'r-3'
      }
    ]);

    expect(open).not.toHaveBeenCalled();
    expect(stacks(editor).undo).toBeGreaterThan(afterName);
    expect(costsRows(editor)).toHaveLength(3);
    expect(indexOf(editor).fields.get('project.name')?.[0].text).toBe(
      'Bridge run'
    );
    expect(costsCell(editor, 'r-3', 'line_total')).toBe('$0.00');

    editor.editorHistory.undo();
    expect(costsRows(editor)).toHaveLength(2);
    const nameOf = () => indexOf(editor).fields.get('project.name')?.[0].text;
    let guard = 0;
    while (nameOf() !== 'Website relaunch' && editor.editorHistory.canUndo() && guard < 4) {
      editor.editorHistory.undo();
      guard += 1;
    }
    expect(nameOf()).toBe('Website relaunch');

    while (nameOf() !== 'Bridge run' && editor.editorHistory.canRedo() && guard < 8) {
      editor.editorHistory.redo();
      guard += 1;
    }
    expect(nameOf()).toBe('Bridge run');
    expect(open).not.toHaveBeenCalled();
  });

  it('undoes bound-cell, native row, new-row edit, and delete in reverse', () => {
    const open = jest.spyOn(editor, 'open');
    const before = stacks(editor).undo;

    writeIntoControl(editor, QUANTITY_R1, '13');
    attached.controller.flush();
    expect(costsCell(editor, 'r-1', 'line_total')).toBe('$1,950.00');
    expect(grandTotal(editor)).toBe('$7,950.00');
    expect(stacks(editor).undo).toBe(before + 1);

    insertRowBelow(editor, QUANTITY_R2);
    expect(open).not.toHaveBeenCalled();
    expect(costsRows(editor)).toHaveLength(3);
    const adopted = costsRows(editor)[2];
    expect(adopted.rowId).not.toBe('r-1');
    expect(adopted.rowId).not.toBe('r-2');
    expect(adopted.bindings.get('quantity')?.tag).toContain(
      `row=${adopted.rowId}`
    );
    expect(stacks(editor).undo).toBe(before + 2);

    const newQuantityTag = adopted.bindings.get('quantity')!.tag;
    writeIntoControl(editor, newQuantityTag, '4');
    attached.controller.flush();
    expect(costsCell(editor, adopted.rowId!, 'quantity')).toBe('4');
    expect(stacks(editor).undo).toBe(before + 3);

    deleteRowAt(editor, newQuantityTag);
    expect(costsRows(editor).map((row) => row.rowId)).toEqual(['r-1', 'r-2']);
    expect(grandTotal(editor)).toBe('$7,950.00');
    expect(stacks(editor).undo).toBe(before + 4);

    editor.editorHistory.undo();
    expect(costsRows(editor)).toHaveLength(3);
    expect(costsCell(editor, adopted.rowId!, 'quantity')).toBe('4');

    editor.editorHistory.undo();
    expect(costsCell(editor, adopted.rowId!, 'quantity')).not.toBe('4');

    editor.editorHistory.undo();
    expect(costsRows(editor).map((row) => row.rowId)).toEqual(['r-1', 'r-2']);

    editor.editorHistory.undo();
    attached.controller.flush({ mode: 'self-heal' });
    expect(costsCell(editor, 'r-1', 'quantity')).toBe('12');
    expect(grandTotal(editor)).toBe('$7,800.00');

    editor.editorHistory.redo();
    expect(costsCell(editor, 'r-1', 'quantity')).toBe('13');
    expect(open).not.toHaveBeenCalled();
  });

  it('clears redo when a new edit follows undo', () => {
    writeIntoControl(editor, QUANTITY_R1, '13');
    attached.controller.flush();
    editor.editorHistory.undo();
    expect(stacks(editor).redo).toBeGreaterThan(0);

    writeIntoControl(editor, QUANTITY_R1, '14');
    attached.controller.flush();
    expect(stacks(editor).redo).toBe(0);
    expect(costsCell(editor, 'r-1', 'quantity')).toBe('14');
  });

  it('leaves prior history intact when adoption cannot be applied', () => {
    const open = jest.spyOn(editor, 'open');
    writeIntoControl(editor, QUANTITY_R1, '13');
    attached.controller.flush();

    jest
      .spyOn((editor as any).editorModule, 'insertContentControl')
      .mockReturnValue(undefined);
    insertRowBelow(editor, QUANTITY_R2);

    expect(open).not.toHaveBeenCalled();
    expect(
      attached
        .diagnostics()
        .some((entry) => entry.code === 'native-mutation-failed')
    ).toBe(true);

    editor.editorHistory.undo();
    expect(costsCell(editor, 'r-1', 'quantity')).toBe('13');
    editor.editorHistory.undo();
    expect(costsCell(editor, 'r-1', 'quantity')).toBe('12');
  });
});
