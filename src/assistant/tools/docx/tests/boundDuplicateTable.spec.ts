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
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';

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

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

const textAt = (editor: DocumentEditor, anchor: string): string | undefined =>
  flattenSfdt(parsed(editor)).find((block) => block.anchor === anchor)?.text;

const indexOf = (editor: DocumentEditor) => scanBindings(parsed(editor));

const blocks = (sfdt: any) => sfdt.sections[0].blocks;

function scrubCloneForStyleDiff(node: any): any {
  if (Array.isArray(node)) return node.map(scrubCloneForStyleDiff);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'contentControlProperties') continue;
    if (key === 'text') {
      out[key] = '';
      continue;
    }
    out[key] = scrubCloneForStyleDiff(value);
  }
  return out;
}

describe('duplicate_table over bound tables', () => {
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

  it('clones a bound table into an isolated namespace while preserving SFDT styling', () => {
    const before = parsed(editor);
    const sourceTable = before.sections[0].blocks[6];
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'duplicate_table',
      route: 'engine'
    });
    const index = indexOf(editor);
    expect(index.tables.has('expenses')).toBe(true);
    expect(index.tables.has('expenses_copy')).toBe(true);
    const source = index.tables.get('expenses')!;
    const copy = index.tables.get('expenses_copy')!;
    expect(copy.rows.map((row) => row.rowId)).toEqual([
      'expenses_copy_r1',
      'expenses_copy_r2'
    ]);
    expect(copy.rows.map((row) => row.rowId)).not.toEqual(
      source.rows.map((row) => row.rowId)
    );

    const after = parsed(editor);
    // Word renders two adjacent tables as one, so the copy is separated from its
    // source by an empty TOP-LEVEL paragraph rather than landing flush against
    // it. Both tables are block content controls; a paragraph inside either
    // wrapper would still leave the wrappers adjacent in Word.
    expect(
      after.sections[0].blocks
        .slice(6, 9)
        .map((entry: any) =>
          entry.contentControlProperties?.tag
            ? entry.contentControlProperties.tag
            : entry.inlines
            ? 'paragraph'
            : 'other'
        )
    ).toEqual(['[[table=expenses]]', 'paragraph', '[[table=expenses_copy]]']);
    const separator = after.sections[0].blocks[7];
    expect(separator.rows).toBeUndefined();
    expect(separator.blocks).toBeUndefined();
    expect(separator.inlines).toEqual([]);
    const cloneTable = after.sections[0].blocks[8];
    expect(scrubCloneForStyleDiff(cloneTable)).toEqual(
      scrubCloneForStyleDiff(sourceTable)
    );
    expect(JSON.stringify(cloneTable)).toContain('[[table=expenses_copy]]');
    expect(JSON.stringify(cloneTable)).toContain('expenses_copy_subtotal');
    expect(JSON.stringify(cloneTable)).toContain('sum(expenses_copy.amount)');

    const editCopy = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: '0;8;1;1;0',
          text: '$600.00',
          literal: true
        }
      ]
    });
    expect(editCopy.results[0]).toMatchObject({
      ok: true,
      route: 'engine'
    });
    expect(textAt(editor, '0;6;1;1;0')).toBe('$500.00');
    expect(textAt(editor, '0;8;1;1;0')).toBe('$600.00');
    expect(textAt(editor, '0;6;5;1;0')).toBe('$1,700.00');
    expect(textAt(editor, '0;8;5;1;0')).toBe('$1,800.00');
  });

  it('writes every independent instance of a duplicated document field', () => {
    const duplicate = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });
    expect(duplicate.results[0].ok).toBe(true);
    const copyTax = flattenSfdt(parsed(editor)).find((block) =>
      block.boundTag?.includes('name=expenses_copy_tax_rate')
    );
    expect(copyTax).toBeDefined();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_text',
          anchor: copyTax!.anchor,
          text: '8%',
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true, route: 'engine' });
    expect(result.results[0].details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('updated 2 independent instances')
      ])
    );
    expect(
      indexOf(editor)
        .fields.get('tax_rate')
        ?.map((entry) => entry.text)
    ).toEqual(['8%', '8%']);
    expect(
      indexOf(editor)
        .fields.get('expenses_copy_tax_rate')
        ?.map((entry) => entry.text)
    ).toEqual(['8%']);
  });

  it('refuses an ambiguous transform across independent field instances', () => {
    const duplicate = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }]
    });
    expect(duplicate.results[0].ok).toBe(true);
    const copyTax = flattenSfdt(parsed(editor)).find((block) =>
      block.boundTag?.includes('name=expenses_copy_tax_rate')
    );
    const before = editor.serialize();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: copyTax!.anchor,
          find: '0%',
          replace: '8%'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      route: 'engine',
      error: 'independent_binding_instances_ambiguous',
      message: expect.stringContaining('2 independent binding instances')
    });
    expect(result.results[0].details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('table "costs"'),
        expect.stringContaining('table "expenses_copy"')
      ])
    );
    expect(editor.serialize()).toBe(before);
  });

  it('materializes replacement rows through the engine and recomputes formulas', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: '0;2;0;0;0',
          rows: [
            { item: 'Hosting', quantity: '12', unit_cost: '$25.00' },
            { item: 'Support', quantity: '6', unit_cost: '$80.00' }
          ],
          literal: true
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'duplicate_table',
      route: 'engine'
    });
    expect(indexOf(editor).tables.has('costs_copy')).toBe(true);
    expect(result.results[0].anchor).toBe('0;4');
    expect(textAt(editor, '0;4;1;0;0')).toBe('Hosting');
    expect(textAt(editor, '0;4;1;3;0')).toBe('$300.00');
    expect(textAt(editor, '0;4;2;0;0')).toBe('Support');
    expect(textAt(editor, '0;4;2;3;0')).toBe('$480.00');
    expect(textAt(editor, '0;4;3;1;0')).toBe('$780.00');
    expect(textAt(editor, '0;4;5;1;0')).toBe('$780.00');
  });

  it('refuses numeric replacement rows without provenance before cloning', () => {
    const before = editor.serialize();
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'duplicate_table',
          anchor: '0;2;0;0;0',
          rows: [{ item: 'Hosting', quantity: '12', unit_cost: '$25.00' }]
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      op: 'duplicate_table',
      route: 'engine',
      error: 'model_authored_number'
    });
    expect(editor.serialize()).toBe(before);
  });

  it('refuses multiple duplicate_table ops or later anchored ops in one batch', () => {
    const multiple = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: '0;2;0;0;0', rows: 'copy' },
        { op: 'duplicate_table', anchor: '0;6;0;0;0', rows: 'copy' }
      ]
    });
    expect(multiple.results[0].error).toBe(
      'duplicate_table_one_per_change_set'
    );

    const before = editor.serialize();
    const laterAnchored = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        { op: 'duplicate_table', anchor: '0;2;0;0;0', rows: 'copy' },
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Project',
          replace: 'Plan'
        }
      ]
    });
    expect(laterAnchored.results[0].error).toBe(
      'duplicate_table_must_end_change_set'
    );
    expect(editor.serialize()).toBe(before);
  });
});
