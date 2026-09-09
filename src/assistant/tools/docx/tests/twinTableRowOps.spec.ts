// Row ops in one twin table must not make the other twin's anchors ambiguous
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

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);
if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

const para = (text: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: [{ characterFormat: {}, text }]
});
const cell = (text: string) => ({
  blocks: [para(text)],
  cellFormat: { columnSpan: 1, rowSpan: 1 }
});
const table = () => ({
  rows: [
    { rowFormat: {}, cells: [cell('Coverage'), cell('Premium')] },
    { rowFormat: {}, cells: [cell('Excess'), cell('$750.00')] },
    { rowFormat: {}, cells: [cell('Tax & Fees'), cell('$272.50')] },
    { rowFormat: {}, cells: [cell('TOTAL'), cell('$1,022.50')] }
  ]
});
const twinDocument = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [para('Premium Summary'), table(), para(''), table(), para('After')]
    }
  ]
});

function open(sfdt: unknown): DocumentEditor {
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
const rowCounts = (editor: DocumentEditor): number[] =>
  JSON.parse(editor.serialize())
    .sections[0].blocks.filter((b: any) => b.rows)
    .map((b: any) => b.rows.length);

describe('row ops across twin tables in one change set', () => {
  let editor: DocumentEditor;
  beforeEach(() => {
    editor = open(twinDocument());
  });
  afterEach(() => {
    editor.destroy();
  });

  it('a delete in the second twin leaves the first twin addressable by its own anchor', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'twin-deletes',
      edits: [
        { op: 'delete_row', anchor: '0;3;3;0;0', rows: [3], group: 'g' } as any,
        { op: 'delete_row', anchor: '0;1;1;0;0', rows: [1, 2], group: 'g' } as any
      ]
    }) as any;
    expect(
      result.results.map((r: any) => (r.ok ? 'ok' : r.error))
    ).toEqual(['ok', 'ok']);
    editor.revisions.acceptAll();
    expect(rowCounts(editor)).toEqual([2, 3]);
  });

  it('a paragraph insert still makes later twin anchors ambiguous', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'twin-shift',
      edits: [
        {
          op: 'insert_text',
          anchor: '0;0',
          position: 'after',
          text: 'Inserted',
          group: 'g'
        } as any,
        { op: 'delete_row', anchor: '0;3;3;0;0', rows: [3], group: 'g' } as any
      ]
    }) as any;
    expect(result.results.map((r: any) => (r.ok ? 'ok' : r.error))).toEqual([
      'change_set_failed',
      'anchor_relocation_ambiguous'
    ]);
  });
});
