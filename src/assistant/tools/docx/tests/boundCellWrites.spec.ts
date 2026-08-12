// Phase 4, the write half: assistant edits aimed at a bound cell are refused.
//
// This is a correctness requirement, not a preference. The write primitive here
// is select-a-range-then-insertText, and that DELETES a content control rather
// than replacing its contents (measured on 34.1.31 in the Phase 0 spikes,
// locked or not). So a write that looks like "set the total to $9,000" would
// silently remove the author's binding and leave a plain number where a live
// formula used to be. Refusing keeps the document's bindings intact and tells
// the model what would actually move the value.
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
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';

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

function makeEditor(): DocumentEditor {
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
  editor.open(JSON.stringify(buildCostsFixture()));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const tagsIn = (editor: DocumentEditor): string[] => {
  const found: string[] = [];
  const walk = (node: any): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const tag = node.contentControlProperties?.tag;
    if (typeof tag === 'string') found.push(tag);
    Object.values(node).forEach(walk);
  };
  walk(JSON.parse(editor.serialize()));
  return found;
};

const QUANTITY_CELL = '0;2;1;1;0';
const LINE_TOTAL_CELL = '0;2;1;3;0';
const LABEL_CELL = '0;2;0;0;0';

describe('writes aimed at a bound cell', () => {
  let editor: DocumentEditor;

  beforeEach(() => {
    editor = makeEditor();
  });

  afterEach(() => destroy(editor));

  it('refuses set_cell_text on a bound input cell', () => {
    const before = tagsIn(editor).length;
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: QUANTITY_CELL, text: '99' }]
    });

    expect(result.results[0].error).toBe('target_is_bound');
    // The binding is still there - which is the whole point.
    expect(tagsIn(editor)).toHaveLength(before);
  });

  it('refuses set_cell_formula on a locked formula cell', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_formula',
          anchor: LINE_TOTAL_CELL,
          formula: `[${QUANTITY_CELL}] * 2`
        }
      ]
    });

    expect(result.results[0].error).toBe('target_is_bound');
  });

  it('refuses set_column_formula anchored on a bound column', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_column_formula',
          anchor: LINE_TOTAL_CELL,
          formula: `[0;2;{row};1;0] * 2`
        }
      ]
    });

    expect(result.results[0].error).toBe('target_is_bound');
  });

  it('tells the model the request can never succeed as phrased', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: QUANTITY_CELL, text: '99' }]
    });
    const failure: any = result.results[0];
    // A retry of the same op is not worth an LLM round trip...
    expect(failure.retry).toBe('never');
    // ...and the message says what would actually move the value.
    expect(failure.message).toMatch(/bound value "quantity"/);
    expect(failure.message).toMatch(/form field/);
  });

  it('refuses an unbound cell inside a bound table, rather than writing it wrong', () => {
    // Measured, not assumed: SyncFusion counts a content control's boundary
    // markers as offset positions while the walker counts characters, so this
    // write selected three of the header's four characters and produced
    // "Line itemm". Reading these cells is exact; addressing them for a write is
    // not, until the offset model accounts for markers.
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: LABEL_CELL, text: 'Line item' }]
    });

    expect(result.results[0].error).toBe('unaddressable_in_bound_document');
    // Refused means untouched, not half-written.
    expect(editor.serialize()).toBe(before);
  });

  it('still writes freely where no binding is involved', () => {
    // The refusal is scoped to text that shares a paragraph or a container with a
    // binding - not to bound documents wholesale. This heading is neither.
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project cost estimate',
          replace: 'Cost estimate v2'
        }
      ]
    });

    expect(result.results[0].error).toBeUndefined();
    expect(editor.serialize()).toContain('Cost estimate v2');
  });
});
