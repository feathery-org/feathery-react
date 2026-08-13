// Phase 3's exit criterion, minus React: a tokenized template opens in a REAL
// editor, its tokens become live bindings, its formulas compute, an edit
// recalculates them, and a document with an error refuses to be saved.
//
// This is the integration the hook performs. Testing it here rather than through
// a rendered component keeps the risky part - the editor - in the test and the
// uninteresting part - an effect firing - out of it.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { attachBindings, AttachedBindings } from '../attachBindings';
import { SyncfusionEditorLike } from '../editorAdapter';
import { scanBindings, setTaggedValue } from '../core/sfdtAdapter';
import { SfdtDocument } from '../core/sfdtTypes';
import { buildTemplateTokenDocument } from '../core/tests/fixtures/templateTokenFixture';
import { buildCostsFixture } from '../core/tests/fixtures/costsFixture';
import { bindingCommandSurfaceFor } from '../reconcileRegistry';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

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
    enableImageResizer: true,
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

const liveIndex = (editor: DocumentEditor) =>
  scanBindings(JSON.parse(editor.serialize()) as SfdtDocument);

const formulaText = (editor: DocumentEditor, name: string) =>
  liveIndex(editor).formulas.get(name)?.[0].text;

const costsCell = (editor: DocumentEditor, column: string) =>
  liveIndex(editor).tables.get('costs')!.rows[0].bindings.get(column)!.text;

function writeIntoControl(
  editor: DocumentEditor,
  tag: string,
  text: string
): void {
  const collection = (editor as any).documentHelper.contentControlCollection;
  const control = collection.find(
    (candidate: any) => candidate?.contentControlProperties?.tag === tag
  );
  if (!control) throw new Error(`no control for ${tag}`);
  (editor as any).editorModule.updateContentControl(control, text);
}

describe('attaching bindings to a tokenized template', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor(buildTemplateTokenDocument());
    attached = attachBindings(editor as unknown as SyncfusionEditorLike);
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('turns tokens into live bindings and computes every formula', () => {
    // Before attaching there were no content controls at all, only text.
    expect(attached.importDiagnostics).toEqual([]);
    const index = liveIndex(editor);
    expect([...index.tables.keys()].sort()).toEqual(['costs', 'expenses']);

    expect(costsCell(editor, 'unit_cost')).toBe('$150.00');
    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');
    expect(formulaText(editor, 'costs_subtotal')).toBe('$7,800.00');
    expect(formulaText(editor, 'combined_total')).toBe('$9,500.00');
  });

  it('recalculates dependents when a bound cell is edited', () => {
    const quantityTag = liveIndex(editor)
      .tables.get('costs')!
      .rows[0].bindings.get('quantity')!.tag;

    writeIntoControl(editor, quantityTag, '13');
    attached.controller.flush();

    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');
    expect(formulaText(editor, 'combined_total')).toBe('$9,650.00');
  });

  it('reports document-level field values for the host', () => {
    expect(attached.fieldValues()).toEqual(
      expect.objectContaining({
        'project.name': 'Website relaunch',
        tax_rate: '0'
      })
    );
  });

  it('is idempotent across a reattach, as an instance recreation causes', () => {
    const before = liveIndex(editor).occurrences.length;
    attached.dispose();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike);
    // Converting an already-converted document must not double-wrap anything.
    expect(liveIndex(editor).occurrences).toHaveLength(before);
    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');
  });

  it('removes every listener it installed on dispose', () => {
    const remove = jest.spyOn(editor, 'removeEventListener');
    attached.dispose();
    const removed = remove.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(
      expect.arrayContaining(['contentChange', 'selectionChange', 'keyDown'])
    );
    remove.mockRestore();
    // Reattach so afterEach's dispose stays valid.
    attached = attachBindings(editor as unknown as SyncfusionEditorLike);
  });
});

describe('save gating', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor(buildCostsFixture());
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      // Already a bound document; nothing to convert.
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('allows a save when the document reconciles cleanly', () => {
    expect(attached.commitForSave()).toBe(true);
    expect(attached.diagnostics()).toEqual([]);
  });

  it('refuses a save while a bound cell holds invalid input', () => {
    writeIntoControl(
      editor,
      '[[name=quantity|type=integer|row=r-1]]',
      'twelve'
    );

    expect(attached.commitForSave()).toBe(false);
    expect(
      attached.diagnostics().some((entry) => entry.code === 'invalid-input')
    ).toBe(true);

    // And it unblocks once the value is valid again.
    writeIntoControl(editor, '[[name=quantity|type=integer|row=r-1]]', '12');
    expect(attached.commitForSave()).toBe(true);
  });

  it('commits an uncommitted edit as part of the save check', () => {
    // The user typed but never pressed Enter or moved the caret. The bytes about
    // to be written must still be reconciled ones.
    writeIntoControl(editor, '[[name=quantity|type=integer|row=r-1]]', '13');
    expect(costsCell(editor, 'line_total')).toBe('$1,800.00');

    expect(attached.commitForSave()).toBe(true);

    expect(costsCell(editor, 'line_total')).toBe('$1,950.00');
  });

  it('registers the assistant command surface on the editor instance', () => {
    const surface = bindingCommandSurfaceFor(editor);
    expect(surface).toBeTruthy();
    surface!.runCommand((sfdt, index) =>
      setTaggedValue(sfdt, 'project.name', 'Bridge run', index)
    );

    expect(attached.fieldValues()).toEqual(
      expect.objectContaining({ 'project.name': 'Bridge run' })
    );
    expect(liveIndex(editor).fields.get('project.name')?.[0].text).toBe(
      'Bridge run'
    );
  });
});

describe('content-change suppression', () => {
  it('brackets the initial reconcile so it is not read as a user edit', () => {
    const editor = makeEditor(buildTemplateTokenDocument());
    const calls: boolean[] = [];
    const attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      onSuppressContentChange: (suppressed) => calls.push(suppressed)
    });
    try {
      // Computing a template's formulas is the editor doing its job, not the
      // user dirtying the document.
      expect(calls).toEqual([true, false]);
    } finally {
      attached.dispose();
      destroy(editor);
    }
  });
});
