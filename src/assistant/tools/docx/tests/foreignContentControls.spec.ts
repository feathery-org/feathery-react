// A Word template's ordinary structured document tags are NOT document bindings.
// The bound-document write regime (offsets declared untrusted, writes refused,
// row ops routed through the binding engine) must key off the binding grammar
// alone, or every .docx built from a corporate template would lose the ability to
// be edited at all - with the bindings feature switched off.
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

// A plain Word content control: a tag in nobody's grammar, no `[[...]]` at all.
function foreignControl(tag: string, text: string): any {
  return {
    contentControlProperties: {
      lockContentControl: false,
      lockContents: false,
      tag,
      title: tag,
      type: 'Text',
      hasPlaceHolderText: false,
      multiline: false,
      isTemporary: false,
      color: '#00000000',
      appearance: 'BoundingBox'
    },
    inlines: [{ text }]
  };
}

function cell(blocks: any[]): any {
  return {
    blocks,
    cellFormat: {
      preferredWidth: 200,
      preferredWidthType: 'Point',
      cellWidth: 200,
      columnSpan: 1,
      rowSpan: 1
    },
    columnIndex: 0
  };
}

function paragraph(inlines: any[]): any {
  return { paragraphFormat: { afterSpacing: 8 }, inlines };
}

/** A template document with foreign SDTs and no bindings whatsoever. */
function buildForeignControlFixture(): any {
  return {
    sections: [
      {
        sectionFormat: {
          pageWidth: 612,
          pageHeight: 792,
          leftMargin: 72,
          rightMargin: 72,
          topMargin: 72,
          bottomMargin: 72,
          differentFirstPage: false,
          differentOddAndEvenPages: false,
          bidi: false,
          breakCode: 'NewPage'
        },
        blocks: [
          {
            paragraphFormat: { styleName: 'Heading 1', afterSpacing: 10 },
            inlines: [{ text: 'Service agreement' }]
          },
          paragraph([
            { text: 'Client: ' },
            foreignControl('ClientName', 'Acme Corp'),
            { text: ' (confirmed)' }
          ]),
          {
            rows: [
              {
                cells: [
                  cell([paragraph([{ text: 'Term' }])]),
                  cell([paragraph([{ text: 'Value' }])])
                ],
                rowFormat: { isHeader: true, allowBreakAcrossPages: false }
              },
              {
                cells: [
                  cell([paragraph([{ text: 'Renewal' }])]),
                  cell([paragraph([foreignControl('RenewalTerm', 'Annual')])])
                ],
                rowFormat: { isHeader: false, allowBreakAcrossPages: true }
              }
            ],
            grid: [200, 200],
            columnCount: 2,
            tableFormat: {
              leftIndent: 0,
              preferredWidthType: 'Auto',
              tableAlignment: 'Left'
            }
          },
          paragraph([{ text: 'End of agreement.' }])
        ]
      }
    ],
    characterFormat: { fontSize: 11, fontFamily: 'Calibri' },
    paragraphFormat: { afterSpacing: 8 },
    styles: []
  };
}

/**
 * The costs fixture with a foreign block-level content control - one wrapping a
 * CAPTION and a TABLE, i.e. two blocks - spliced in ahead of the bound tables.
 * Every anchor after it shifts by one relative to the raw SFDT block index, which
 * is the coordinate divergence the bound-table lookup has to survive.
 */
function buildCostsWithForeignWrapper(): any {
  const fixture = buildCostsFixture() as any;
  fixture.sections[0].blocks.splice(1, 0, {
    contentControlProperties: {
      lockContentControl: false,
      lockContents: false,
      tag: 'BoilerplateBlock',
      title: 'Boilerplate',
      type: 'RichText',
      hasPlaceHolderText: false,
      multiline: true,
      isTemporary: false,
      color: '#00000000',
      appearance: 'BoundingBox'
    },
    blocks: [
      paragraph([{ text: 'Standard terms' }]),
      {
        rows: [
          {
            cells: [
              cell([paragraph([{ text: 'Clause' }])]),
              cell([paragraph([{ text: 'Applies' }])])
            ],
            rowFormat: { isHeader: false, allowBreakAcrossPages: true }
          }
        ],
        grid: [200, 200],
        columnCount: 2,
        tableFormat: {
          leftIndent: 0,
          preferredWidthType: 'Auto',
          tableAlignment: 'Left'
        }
      }
    ]
  });
  return fixture;
}

function makeEditor(sfdt: any): DocumentEditor {
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
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

const blocksOf = (editor: DocumentEditor) => flattenSfdt(parsed(editor));

const textAt = (editor: DocumentEditor, anchor: string): string | undefined =>
  blocksOf(editor).find((block) => block.anchor === anchor)?.text;

describe('a document whose content controls are not bindings', () => {
  let editor: DocumentEditor;

  beforeEach(() => {
    editor = makeEditor(buildForeignControlFixture());
  });

  afterEach(() => destroy(editor));

  it('is not treated as a bound document by the walker', () => {
    const blocks = blocksOf(editor);
    expect(blocks.some((block) => block.boundTag)).toBe(false);
    expect(blocks.some((block) => block.offsetsUntrusted)).toBe(false);
    // And the binding scanner agrees there is nothing here to own.
    const index = scanBindings(parsed(editor));
    expect(index.occurrences).toHaveLength(0);
    expect(index.tables.size).toBe(0);
  });

  it('still writes prose that shares a paragraph with a foreign control', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;1',
          find: 'Client:',
          replace: 'Customer:'
        }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      route: 'editor'
    });
    expect(textAt(editor, '0;1')).toBe('Customer: Acme Corp (confirmed)');
  });

  it('still writes a table cell in a table that holds a foreign control', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: '0;2;1;0;0', text: 'Extension' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'set_cell_text',
      route: 'editor'
    });
    expect(textAt(editor, '0;2;1;0;0')).toBe('Extension');
  });

  it('does not refuse a control-bearing cell as part of a bound document', () => {
    // SyncFusion counts a control's boundary markers as offset positions, so this
    // write does land off by one and the ordinary verification guard rolls it
    // back. What it must NOT do is refuse up front as `target_is_bound` /
    // `unaddressable_in_bound_document`: there is no binding anywhere here, and a
    // template document is not the bindings feature's business.
    const failure = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'set_cell_text', anchor: '0;2;1;1;0', text: 'Monthly' }]
    }).results[0];

    expect(failure.route).toBe('editor');
    expect(failure.error).not.toBe('target_is_bound');
    expect(failure.error).not.toBe('unaddressable_in_bound_document');
    expect(failure.error).not.toBe('binding_engine_unavailable');
    expect(textAt(editor, '0;2;1;1;0')).toBe('Annual');
  });

  it('still inserts a row into a table that holds a foreign control', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'insert_row', anchor: '0;2;1;0;0' }]
    });

    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'insert_row',
      route: 'editor'
    });
    expect(
      blocksOf(editor).filter((b) => b.kind === 'table_cell')
    ).toHaveLength(6);
  });
});

describe('a bound document with a foreign block-level content control', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;

  beforeEach(() => {
    editor = makeEditor(buildCostsWithForeignWrapper());
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
  });

  afterEach(() => {
    attached.dispose();
    destroy(editor);
  });

  it('addresses the bound table at its expanded anchor, not its raw index', () => {
    // The wrapper contributes TWO addressable blocks, so the costs table answers
    // to 0;4 while its marker still lives at raw block 3.
    const costsCell = blocksOf(editor).find(
      (block) => block.text === 'Design work'
    );
    expect(costsCell?.anchor).toBe('0;4;1;0;0');

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [{ op: 'insert_row', anchor: '0;4;2;0;0' }]
    });

    // Routed through the engine: a native row insert here would leave a row the
    // marker does not describe.
    expect(result.results[0]).toMatchObject({
      ok: true,
      op: 'insert_row',
      route: 'engine'
    });
    const table = scanBindings(parsed(editor)).tables.get('costs');
    expect(table?.rows.map((row) => row.rowId).slice(0, 2)).toEqual([
      'r-1',
      'r-2'
    ]);
    expect(table?.rows).toHaveLength(3);
    expect(textAt(editor, '0;4;3;3;0')).toBe('$0.00');
  });

  it('refuses a write to the bound cell behind the same shifted anchor', () => {
    const failure = applyDocumentEdits(editor as unknown as LiveEditor, {
      edits: [
        {
          op: 'set_cell_formula',
          anchor: '0;4;1;3;0',
          formula: '[0;4;1;1;0] * 2'
        }
      ]
    }).results[0];

    expect(failure.error).toBe('target_is_bound_formula');
    expect(failure.retry).toBe('never');
  });
});
