// Row ops on a table bound by marker only, no row bindings, the shape every Hilb proposal uses
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
  getDocumentInventory,
  LiveEditor
} from '../syncfusionDocumentOps';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import { convertTemplateTokens } from '../../../../elements/components/DocxEditor/bindings/core/templateImport';
import {
  SfdtBlock,
  SfdtDocument,
  SfdtRow
} from '../../../../elements/components/DocxEditor/bindings/sfdtTypes';

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

const para = (text: string): SfdtBlock => ({
  paragraphFormat: {},
  inlines: [{ text }]
});
const row = (...texts: string[]): SfdtRow => ({
  rowFormat: { isHeader: false },
  cells: texts.map((text) => ({ cellFormat: {}, blocks: [para(text)] }))
});

const premiumSummaryTokens = (): SfdtDocument => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        para('Premium Summary'),
        para('[[table=premiumSummary]]'),
        {
          tableFormat: {},
          columnCount: 2,
          rows: [
            row('Coverage', 'Premium'),
            row(
              'Property',
              '[[name=PropertyPremium|type=currency|value=4591]]'
            ),
            row(
              'General Liability',
              '[[name=GeneralLiabilityPremium|type=currency|value=4535]]'
            ),
            row(
              'Umbrella',
              '[[name=UmbrellaPremium|type=currency|value=2285]]'
            ),
            row(
              'TOTAL ANNUAL PREMIUM:',
              '[[name=TotalAnnualPremium|expr=sum(PropertyPremium,GeneralLiabilityPremium,UmbrellaPremium)]]'
            )
          ]
        } as SfdtBlock,
        para('Billing Options')
      ]
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

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());
const markerBlockIndex = (editor: DocumentEditor): number =>
  parsed(editor).sections[0].blocks.findIndex(
    (b: any) => b.contentControlProperties?.tag === '[[table=premiumSummary]]'
  );
const tableBlock = (editor: DocumentEditor) => {
  const wrapper = parsed(editor).sections[0].blocks[markerBlockIndex(editor)];
  return wrapper.rows ? wrapper : wrapper.blocks.find((b: any) => b.rows);
};
const controlTags = (editor: DocumentEditor): string[] =>
  JSON.stringify(tableBlock(editor)).match(/\[\[name=[^\]]*\]\]/g) ?? [];

describe('row ops on a marker-only bound table', () => {
  let editor: DocumentEditor;
  let attached: AttachedBindings;
  let block: number;

  beforeEach(() => {
    const converted = convertTemplateTokens(premiumSummaryTokens());
    expect(
      converted.diagnostics.filter((d) => d.severity === 'error')
    ).toEqual([]);
    editor = open(converted.sfdt);
    attached = attachBindings(editor as unknown as SyncfusionEditorLike, {
      convertTokensOnOpen: false
    });
    attached.controller.flush({ mode: 'self-heal' });
    block = markerBlockIndex(editor);
  });

  afterEach(() => {
    attached.dispose();
    editor.destroy();
  });

  it('fixture control: the table is bound by marker only', () => {
    expect(tableBlock(editor).rows).toHaveLength(5);
    expect(controlTags(editor)).toHaveLength(4);
    expect(controlTags(editor).some((tag) => /row=/.test(tag))).toBe(false);
  });

  it('delete_row lands as a tracked editor deletion that reject restores whole', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'marker-only-delete',
      edits: [
        {
          op: 'delete_row',
          anchor: `0;${block};2;0;0`,
          rows: [2],
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results.map((r: any) => [r.ok, r.route])).toEqual([
      [true, 'editor']
    ]);
    expect(editor.revisions.length).toBeGreaterThan(0);

    editor.revisions.rejectAll();
    expect(tableBlock(editor).rows).toHaveLength(5);
    expect(controlTags(editor)).toHaveLength(4);
  });

  it('insert_row lands on the editor route as a plain row', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'marker-only-insert',
      edits: [
        {
          op: 'insert_row',
          anchor: `0;${block};3;0;0`,
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results.map((r: any) => [r.ok, r.route])).toEqual([
      [true, 'editor']
    ]);
    expect(tableBlock(editor).rows).toHaveLength(6);
    expect(controlTags(editor)).toHaveLength(4);
  });

  it('reads as unbound: no table binding fact, and split_table is refused for its cell controls', () => {
    const inventory: any = getDocumentInventory(editor as unknown as LiveEditor, {
      scope: 'structure'
    });
    const table = inventory.structure.tables.find(
      (entry: any) => entry.anchor === `0;${block}`
    );
    expect(table).toBeDefined();
    expect(table.binding).toBeUndefined();

    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'marker-only-split',
      edits: [
        {
          op: 'split_table',
          anchor: `0;${block};2;0;0`,
          splitAtRow: 3,
          targetAnchor: '0;0',
          position: 'before',
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results.map((r: any) => r.error)).toEqual([
      'structural_op_would_destroy_bindings'
    ]);
    expect(tableBlock(editor).rows).toHaveLength(5);
  });

  it('duplicate_table keepRows is refused, roles are not provable without row bindings', () => {
    const result = applyDocumentEdits(editor as unknown as LiveEditor, {
      changeSetId: 'marker-only-keep-rows',
      edits: [
        {
          op: 'duplicate_table',
          anchor: `0;${block}`,
          rows: 'copy',
          keepRows: [1, 3],
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results.map((r: any) => r.error)).toEqual([
      'keep_rows_roles_not_derivable'
    ]);
    expect(tableBlock(editor).rows).toHaveLength(5);
  });
});
