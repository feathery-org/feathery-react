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
import { scanBindings } from '../core/sfdtAdapter';
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
      expect.arrayContaining([
        'contentChange',
        'selectionChange',
        'keyDown',
        'contentControl'
      ])
    );
    remove.mockRestore();
    // Reattach so afterEach's dispose stays valid.
    attached = attachBindings(editor as unknown as SyncfusionEditorLike);
  });

  it('fires the locked-edit hint only when the edit was actually refused', () => {
    attached.dispose();
    const onLockedEdit = jest.fn();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      onLockedEdit
    });
    const module = (editor as any).editorModule;
    const restore = Object.getOwnPropertyDescriptor(
      module,
      'canEditContentControl'
    );
    // Syncfusion fires 'contentControl' even for an editable control (all our
    // controls are lockContentControl), so the event alone must NOT toast.
    Object.defineProperty(module, 'canEditContentControl', {
      configurable: true,
      get: () => true
    });
    (editor as any).trigger('contentControl');
    expect(onLockedEdit).not.toHaveBeenCalled();

    // A genuinely refused edit (gate closed) shows the hint, debounced.
    Object.defineProperty(module, 'canEditContentControl', {
      configurable: true,
      get: () => false
    });
    (editor as any).trigger('contentControl');
    (editor as any).trigger('contentControl');
    expect(onLockedEdit).toHaveBeenCalledTimes(1);

    if (restore) Object.defineProperty(module, 'canEditContentControl', restore);
    else delete module.canEditContentControl;
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
    writeIntoControl(editor, '[[name=quantity|type=integer|row=r-1]]', 'twelve');

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
    surface!.runCommands([
      { type: 'set-value', name: 'project.name', value: 'Bridge run' }
    ]);

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
    const attached = attachBindings(
      editor as unknown as SyncfusionEditorLike,
      { onSuppressContentChange: (suppressed) => calls.push(suppressed) }
    );
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

describe('surviving the editor being torn down mid-event', () => {
  // Going back a form step unmounts the editor. React runs the host's
  // instance.destroy() cleanup BEFORE this binding's dispose, so destroy fires
  // teardown selectionChange/contentChange events into the still-attached
  // listeners while the editor's internals are half-null. A listener that throws
  // there makes Syncfusion log "Error caught while running custom logic" and the
  // throw reaches the host's error boundary, crashing the whole form.
  let editor: DocumentEditor;
  let attached: AttachedBindings;
  const handlers: Record<string, (...args: any[]) => void> = {};

  beforeEach(() => {
    editor = makeEditor(buildTemplateTokenDocument());
    // Capture the listeners attachBindings installs so the test can fire them
    // by hand, standing in for the events destroy() emits.
    const add = jest
      .spyOn(editor, 'addEventListener')
      .mockImplementation((name: any, handler: any) => {
        handlers[name] = handler;
      });
    attached = attachBindings(editor as unknown as SyncfusionEditorLike);
    add.mockRestore();
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  // A destroyed Syncfusion instance dereferences null internals the moment its
  // selection is read - the exact "Cannot convert undefined or null to object"
  // from the field report. `selection` is a prototype getter, so an own-property
  // shadow throws for the test and deleting it restores the real editor.
  function breakSelection(): void {
    Object.defineProperty(editor, 'selection', {
      configurable: true,
      get() {
        throw new Error('Cannot convert undefined or null to object');
      }
    });
  }
  function healSelection(): void {
    delete (editor as unknown as { selection?: unknown }).selection;
  }

  it('does not let a teardown event throw into the host', () => {
    // Type first, so the later selectionChange tries to commit through the now
    // broken editor rather than returning early on no pending edit.
    handlers.contentChange();
    breakSelection();
    try {
      expect(() => handlers.selectionChange()).not.toThrow();
      expect(() => handlers.contentChange()).not.toThrow();
      expect(() =>
        handlers.keyDown({ event: { key: 'Enter' } })
      ).not.toThrow();
    } finally {
      // Heal before afterEach so destroy() can read selection normally.
      healSelection();
    }
  });

  it('stops calling into the controller once disposed', () => {
    handlers.contentChange();
    const flush = jest.spyOn(attached.controller, 'flush');
    attached.dispose();

    // A stray event or timer that fires after dispose must find the handlers
    // inert, not reconcile a document that is on its way out.
    handlers.selectionChange();
    handlers.contentChange();
    expect(flush).not.toHaveBeenCalled();

    // Reattach so afterEach's dispose stays valid.
    attached = attachBindings(editor as unknown as SyncfusionEditorLike);
  });

  it('dispose does not throw when the editor was already destroyed', () => {
    // The real unmount order: React runs the host's instance.destroy() cleanup
    // before this binding's dispose. removeEventListener and the un-patch helpers
    // then run against a torn-down instance. dispose runs inside React's commit,
    // so a throw here is caught by an error boundary and crashes the form.
    destroy(editor);
    expect(() => attached.dispose()).not.toThrow();
    // afterEach will call dispose() again (idempotent) and destroy() a second
    // time; reattaching against the destroyed instance is not possible, so make
    // both safe no-ops.
    attached = { dispose() {} } as AttachedBindings;
    editor = { destroy() {}, get element() { return null; } } as unknown as DocumentEditor;
  });
});
