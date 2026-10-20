// "Insert column" drops the new cells' fill and borders in Syncfusion 34.1.31
// (see installTableColumnInsertFix). These tests run the REAL Editor from the
// node_modules mirror (same version production loads from the CDN —
// constants.spec.ts enforces the lockstep) on a table styled like the proposal
// templates: a navy header row with a green bottom border, plain body rows.
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  SfdtExport,
  Selection
} from '@syncfusion/ej2-documenteditor';
import { randomFillSync } from 'crypto';
import { featheryDoc, featheryWindow } from '../../../utils/browser';
import { installTableColumnInsertFix } from './tableColumnInsertFix';

DocumentEditor.Inject(Editor, Selection, EditorHistory, SfdtExport);

const win: any = featheryWindow();

if (!win.crypto?.getRandomValues) {
  Object.defineProperty(win, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) => randomFillSync(array)
    }
  });
}

// jsdom throws on getComputedStyle's pseudo-element argument; drop it.
const jsdomGetComputedStyle = win.getComputedStyle.bind(win);
win.getComputedStyle = (elt: Element) => jsdomGetComputedStyle(elt);

if (!win.SVGElement.prototype.getBBox) {
  win.SVGElement.prototype.getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const HEADER_FILL = '#001B49';
const HEADER_RULE = '#A9B533';

function styledTableSfdt() {
  const header = (text: string) => ({
    cellFormat: {
      shading: { backgroundColor: HEADER_FILL, textureStyle: 'TextureNone' },
      borders: {
        bottom: { lineStyle: 'Single', lineWidth: 1.5, color: HEADER_RULE }
      }
    },
    blocks: [{ inlines: [{ text, characterFormat: { fontColor: '#FFFFFF' } }] }]
  });
  const body = (text: string) => ({
    cellFormat: {},
    blocks: [{ inlines: [{ text }] }]
  });
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Heading' }] },
          {
            tableFormat: {},
            rows: [
              { rowFormat: {}, cells: [header('Coverage'), header('Limit')] },
              { rowFormat: {}, cells: [body('Each Claim'), body('$1,000,000')] }
            ]
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  };
}

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
  const host = featheryDoc().createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  featheryDoc().body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableEditorHistory: true,
    enableSfdtExport: true,
    // Same as production: full SFDT keys (`sections`, not `sec`).
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

/** Caret in the given cell of the table (block 1 of section 0). */
function selectCell(ed: any, row: number, cell: number) {
  const offset = `0;1;${row};${cell};0;0`;
  ed.selection.select(offset, offset);
}

// jsdom's mocked text metrics can push the table onto a later page — search
// every page rather than assuming page 0.
function getFirstTable(ed: any) {
  for (const page of ed.documentHelper.pages) {
    for (const body of page.bodyWidgets ?? []) {
      const table = (body.childWidgets ?? []).find((w: any) => w.tableFormat);
      if (table) return table;
    }
  }
  return undefined;
}

function tableRows(ed: any): any[] {
  return JSON.parse(ed.serialize()).sections[0].blocks[1].rows;
}

const fillOf = (cell: any) => cell.cellFormat?.shading?.backgroundColor;
const bottomRuleOf = (cell: any) => cell.cellFormat?.borders?.bottom?.color;

jest.setTimeout(120000);

let ed: any;

afterEach(() => {
  if (ed) {
    const element = ed.element;
    ed.destroy();
    element?.remove();
    ed = undefined;
  }
});

describe('installTableColumnInsertFix', () => {
  it('documents the upstream bug: unpatched, a new header cell loses its fill and border', () => {
    ed = makeRealDocumentEditor(styledTableSfdt());
    selectCell(ed, 0, 1);
    ed.editor.insertColumn(false, 1);

    const [headerRow] = tableRows(ed);
    expect(headerRow.cells).toHaveLength(3);
    expect(fillOf(headerRow.cells[2])).not.toBe(HEADER_FILL);
    expect(bottomRuleOf(headerRow.cells[2])).not.toBe(HEADER_RULE);
  });

  it.each([
    ['right of the last column', 1, false, 2],
    ['left of the first column', 0, true, 0]
  ])(
    'copies the neighbour cell fill and borders when inserting %s',
    (_label, fromCell, left, newIndex) => {
      ed = makeRealDocumentEditor(styledTableSfdt());
      installTableColumnInsertFix(ed);
      selectCell(ed, 0, fromCell);
      ed.editor.insertColumn(left, 1);

      const [headerRow, bodyRow] = tableRows(ed);
      expect(headerRow.cells).toHaveLength(3);
      expect(fillOf(headerRow.cells[newIndex])).toBe(HEADER_FILL);
      expect(bottomRuleOf(headerRow.cells[newIndex])).toBe(HEADER_RULE);
      // Body cells stay unfilled, and the original cells are untouched.
      expect(fillOf(bodyRow.cells[newIndex])).not.toBe(HEADER_FILL);
      for (const cell of headerRow.cells)
        expect(fillOf(cell)).toBe(HEADER_FILL);
    }
  );

  it('does not recolor the table itself', () => {
    ed = makeRealDocumentEditor(styledTableSfdt());
    installTableColumnInsertFix(ed);
    const table = getFirstTable(ed);
    const tableFillBefore = table.tableFormat.shading.backgroundColor;
    selectCell(ed, 0, 1);
    ed.editor.insertColumn(false, 1);

    expect(table.tableFormat.shading.backgroundColor).toBe(tableFillBefore);
    expect(fillOf(tableRows(ed)[1].cells[2])).not.toBe(HEADER_FILL);
  });

  it('undo removes the column and leaves the original styling', () => {
    ed = makeRealDocumentEditor(styledTableSfdt());
    installTableColumnInsertFix(ed);
    selectCell(ed, 0, 1);
    ed.editor.insertColumn(false, 1);
    ed.editorHistory.undo();

    const [headerRow] = tableRows(ed);
    expect(headerRow.cells).toHaveLength(2);
    for (const cell of headerRow.cells) {
      expect(fillOf(cell)).toBe(HEADER_FILL);
      expect(bottomRuleOf(cell)).toBe(HEADER_RULE);
    }
  });

  it('installs once', () => {
    ed = makeRealDocumentEditor(styledTableSfdt());
    installTableColumnInsertFix(ed);
    const patched = ed.editorModule.copyCellFormats;
    installTableColumnInsertFix(ed);
    expect(ed.editorModule.copyCellFormats).toBe(patched);
  });
});
