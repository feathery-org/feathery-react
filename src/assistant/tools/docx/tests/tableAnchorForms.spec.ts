import 'jest-canvas-mock';
import * as fs from 'fs';
import * as path from 'path';
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
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import type { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';

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
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

/**
 * Every way the schema lets the model name a table is one address.
 *
 * Captured on the captain's rig (2026-09-09), one request, four engine calls:
 * `split_table {anchor:"1;10", rows:[1,3]}` refused as
 * structural_op_would_destroy_bindings because the split compiler only knew
 * cell anchors; `duplicate_table {table} + delete_row {anchor:"1;10"}` failed
 * missing_anchor / anchor_not_found; two separate calls landed, as two cards.
 * The browser document with its header stories stripped (a header-bearing
 * document never finishes opening in jsdom).
 */
const flagshipV4 = () => {
  const sfdt = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        'corpus',
        'browser-only',
        'flagship-v4.browser.sfdt.json'
      ),
      'utf8'
    )
  );
  for (const section of sfdt.sections ?? []) section.headersFooters = {};
  return sfdt;
};

const makeEditor = (sfdt: any): DocumentEditor => {
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
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
};

// The 1.3 Premium Detail table of flagship-v4 sits at section 1, block 10.
const TABLE_ANCHOR = '1;10';
const TABLE_ID = 'property_premium';
const ROWS = [1, 3];

const outcomes = (result: any) =>
  result.results.map((entry: any) =>
    entry.ok ? 'ok' : `${entry.error}: ${String(entry.message ?? '').slice(0, 80)}`
  );

describe('table-scoped ops accept the table anchor, the bound table id, or a cell anchor alike', () => {
  const editors: DocumentEditor[] = [];
  const attachments: AttachedBindings[] = [];
  afterAll(() => {
    for (const attached of attachments) attached.dispose();
    for (const ed of editors) ed.destroy();
  });
  // The binding runtime is what makes a table BOUND; without it every planner
  // sees a plain table, exactly as the browser would not.
  const open = () => {
    const ed = makeEditor(flagshipV4());
    editors.push(ed);
    attachments.push(
      attachBindings(ed as unknown as SyncfusionEditorLike, {
        convertTokensOnOpen: false
      })
    );
    return ed;
  };

  it('split_table by the table anchor with non-adjacent rows lands, and matches the cell-anchor form', () => {
    const byTable = open();
    const a = applyDocumentEdits(byTable as unknown as LiveEditor, {
      changeSetId: 'anchor-forms-a',
      edits: [{ op: 'split_table', anchor: TABLE_ANCHOR, rows: ROWS } as any]
    });
    expect(outcomes(a)).toEqual(['ok']);

    const byCell = open();
    const b = applyDocumentEdits(byCell as unknown as LiveEditor, {
      changeSetId: 'anchor-forms-a',
      edits: [
        { op: 'split_table', anchor: `${TABLE_ANCHOR};1;0;0`, rows: ROWS } as any
      ]
    });
    expect(outcomes(b)).toEqual(['ok']);
    // Revision ids are random, so two editors never match byte for byte; the
    // structural outcome does: the same controls, the same fragments.
    const controls = (ed: DocumentEditor) =>
      ((ed as any).serialize().match(/contentControlProperties/g) ?? []).length;
    expect(controls(byTable)).toBe(controls(byCell));
    // Buildings and Stock leave, so the copy totals $12,012.00 in both forms.
    expect((byTable as any).serialize()).toContain('$12,012.00');
    expect((byCell as any).serialize()).toContain('$12,012.00');
  });

  it('duplicate_table by table id plus delete_row by table anchor land together in one change set', () => {
    const ed = open();
    const result = applyDocumentEdits(ed as unknown as LiveEditor, {
      changeSetId: 'anchor-forms-b',
      edits: [
        {
          op: 'duplicate_table',
          group: 'g01-split',
          table: TABLE_ID,
          rows: 'copy',
          keepRows: ROWS
        } as any,
        { op: 'delete_row', group: 'g01-split', anchor: TABLE_ANCHOR, rows: ROWS } as any
      ]
    });
    expect(outcomes(result)).toEqual(['ok', 'ok']);
  });
});
