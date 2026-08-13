// Assistant writes aimed at content-control bindings route through the binding
// engine instead of using SyncFusion's raw range write primitive.
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
import {
  applyDocumentEdits,
  flattenSfdt,
  LiveEditor
} from '../syncfusionDocumentOps';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

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

const textAt = (editor: DocumentEditor, anchor: string): string | undefined =>
  flattenSfdt(JSON.parse(editor.serialize())).find(
    (block) => block.anchor === anchor
  )?.text;

describe('writes aimed at a bound cell', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor();
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('routes set_cell_text on a bound input through the engine', () => {
    const before = tagsIn(editor).length;
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'set_cell_text', anchor: QUANTITY_CELL, text: '20', literal: true }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'set_cell_text',
      route: 'engine'
    });
    expect(tagsIn(editor)).toHaveLength(before);
    expect(textAt(editor, QUANTITY_CELL)).toBe('20');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,000.00');
    expect(textAt(editor, '0;2;3;1;0')).toBe('$9,000.00');
    expect(textAt(editor, '0;4')).toBe(
      'Amount due for Website relaunch: $9,000.00.'
    );
    expect(textAt(editor, '0;8')).toBe(
      'Combined total (costs + expenses): $10,700.00.'
    );
  });

  it('refuses numeric bound input writes without user/source provenance', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: QUANTITY_CELL, text: '99' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'model_authored_number',
      route: 'engine'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('routes document-level input replacement through setTaggedValue', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;1',
          find: 'Website relaunch',
          replace: 'Mobile app'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      route: 'engine'
    });
    expect(textAt(editor, '0;1')).toBe(
      'Project: Mobile app    Prepared: 2026-08-11'
    );
    expect(textAt(editor, '0;4')).toBe('Amount due for Mobile app: $7,800.00.');
  });

  it('redirects formula writes to their source inputs', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_formula',
          anchor: LINE_TOTAL_CELL,
          formula: `[${QUANTITY_CELL}] * 2`
        }
      ]
    });
    const failure: any = result.results[0];
    expect(failure.error).toBe('target_is_bound_formula');
    expect(failure.route).toBe('engine');
    expect(failure.retry).toBeUndefined();
    expect(failure.message).toMatch(/quantity/);
    expect(failure.message).toMatch(/unit_cost/);
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
    expect(result.results[0].route).toBe('engine');
    expect(result.results[0].retry).toBeUndefined();
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

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      route: 'editor'
    });
    expect(editor.serialize()).toContain('Cost estimate v2');
  });

  it('preflights mixed editor and engine batches before either route writes', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project cost estimate',
          replace: 'Should not land'
        },
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: 'twelve',
          literal: true
        }
      ]
    });

    expect(result.results.map((entry) => entry.ok)).toEqual([false, false]);
    expect(result.results[0]).toMatchObject({
      error: 'change_set_preflight_failed',
      route: 'editor'
    });
    expect(result.results[1]).toMatchObject({
      error: 'binding_value_parse_failed',
      route: 'engine'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('applies mixed editor and engine batches atomically when both preflight', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project cost estimate',
          replace: 'Cost estimate v2'
        },
        {
          op: 'set_cell_text',
          anchor: QUANTITY_CELL,
          text: '20',
          literal: true
        }
      ]
    });

    expect(result.results).toMatchObject([
      { ok: true, route: 'editor' },
      { ok: true, route: 'engine' }
    ]);
    expect(textAt(editor, '0;0')).toBe('Cost estimate v2');
    expect(textAt(editor, QUANTITY_CELL)).toBe('20');
    expect(textAt(editor, LINE_TOTAL_CELL)).toBe('$3,000.00');
  });
});
