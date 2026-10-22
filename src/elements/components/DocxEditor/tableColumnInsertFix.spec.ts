// "Insert column" drops the new cells' fill and borders in Syncfusion 34.1.31
// (see installTableColumnInsertFix). These tests run the REAL Editor from the
// node_modules mirror (same version production loads from the CDN —
// constants.spec.ts enforces the lockstep) on tables styled like the proposal
// templates: navy header cells with a green bottom rule, plain body cells.
import {
  cell,
  cellText,
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para,
  row,
  table,
  textRun
} from './bindings/tests/realEditorHarness';
import { installTableColumnInsertFix } from './tableColumnInsertFix';

const NAVY = '#001B49';
const RULE = '#A9B533';
const RED = '#C00000';

/** A cell with a fill and a bottom rule, as the templates style headers. */
const styled = (text: string, fill: string, extra: object = {}) => ({
  ...cell(para(textRun(text))),
  cellFormat: {
    shading: { backgroundColor: fill, textureStyle: 'TextureNone' },
    borders: { bottom: { lineStyle: 'Single', lineWidth: 1.5, color: RULE } },
    ...extra
  }
});

const docWithTable = (...rows: unknown[]) =>
  docWith(para(textRun('Heading')), table(...rows), para(textRun('End')));

// Header row of styled cells over one plain body row.
const headerTable = () =>
  docWithTable(
    row(styled('Coverage', NAVY), styled('Limit', NAVY)),
    row(cellText('Each Claim'), cellText('$1,000,000'))
  );

/** Caret in `cell` (its position in the row) of `row` of the table. */
function selectCell(ed: any, rowIndex: number, cellIndex: number) {
  const offset = `0;1;${rowIndex};${cellIndex};0;0`;
  ed.selection.select(offset, offset);
}

const tableRows = (ed: any): any[] =>
  JSON.parse(ed.serialize()).sections[0].blocks[1].rows;
// A cloned unshaded fill serializes Syncfusion's "no color" value, 'empty'.
const fills = (r: any) =>
  r.cells.map((c: any) => {
    const fill = c.cellFormat?.shading?.backgroundColor;
    return fill && fill !== 'empty' ? fill : null;
  });
const rules = (r: any) =>
  r.cells.map((c: any) => c.cellFormat?.borders?.bottom?.color ?? null);
const texts = (r: any) =>
  r.cells.map((c: any) =>
    (c.blocks?.[0]?.inlines ?? []).map((i: any) => i.text).join('')
  );

// The live widget table, for checks the serializer can't show (object identity).
function liveTable(ed: any) {
  for (const page of ed.documentHelper.pages) {
    for (const body of page.bodyWidgets ?? []) {
      const found = (body.childWidgets ?? []).find((w: any) => w.tableFormat);
      if (found) return found;
    }
  }
  throw new Error('no table rendered');
}

jest.setTimeout(120000);

describe('installTableColumnInsertFix', () => {
  // One editor for every behavior case: booting Syncfusion in jsdom dominates
  // the runtime. The patch lives on editorModule, which open() keeps.
  let ed: any;
  beforeAll(() => {
    ed = makeRealDocumentEditor(headerTable());
    installTableColumnInsertFix(ed);
  });
  afterAll(() => destroyRealDocumentEditor(ed));

  it.each([
    ['right of the last column', 1, false, 2],
    ['left of the first column', 0, true, 0]
  ])(
    'copies the header fill and rule when inserting %s',
    (_label, fromCell, left, newIndex) => {
      ed.open(JSON.stringify(headerTable()));
      selectCell(ed, 0, fromCell);
      ed.editor.insertColumn(left, 1);

      const [header, body] = tableRows(ed);
      expect(fills(header)).toEqual([NAVY, NAVY, NAVY]);
      expect(rules(header)[newIndex]).toBe(RULE);
      expect(fills(body)[newIndex]).not.toBe(NAVY);
    }
  );

  it('styles a mid-row insert from the column it was inserted from', () => {
    // Column 0 is a navy label column; columns 1 and 2 are plain.
    const labelTable = () =>
      docWithTable(
        row(styled('Policy', NAVY), cellText('A'), cellText('B')),
        row(styled('Premium', NAVY), cellText('C'), cellText('D'))
      );

    // Insert right of the label column: the new column is a label column.
    ed.open(JSON.stringify(labelTable()));
    selectCell(ed, 1, 0);
    ed.editor.insertColumn(false, 1);
    for (const r of tableRows(ed))
      expect(fills(r)).toEqual([NAVY, NAVY, null, null]);

    // Insert left of a plain column: the new column is plain, even though the
    // label column sits on its other side.
    ed.open(JSON.stringify(labelTable()));
    selectCell(ed, 1, 1);
    ed.editor.insertColumn(true, 1);
    for (const r of tableRows(ed))
      expect(fills(r)).toEqual([NAVY, null, null, null]);
  });

  it('finds the new cell by identity in a row with a merged cell', () => {
    // Row 0 = [A, B (spans 2), C]; row 1 = [D, E, F, G]. Caret in F, insert
    // right: insertColumn passes column index 3, but in row 0 the new cell
    // lands at position 2 - between B and C - so cells[3] is C.
    ed.open(
      JSON.stringify(
        docWithTable(
          row(
            styled('A', NAVY),
            styled('B', NAVY, { columnSpan: 2 }),
            styled('C', RED)
          ),
          row(cellText('D'), cellText('E'), cellText('F'), cellText('G'))
        )
      )
    );
    selectCell(ed, 1, 2);
    ed.editor.insertColumn(false, 1);

    const [header, body] = tableRows(ed);
    expect(texts(header)).toEqual(['A', 'B', '', 'C']);
    // C keeps its own fill and rule; the new cell takes B's (its left).
    expect(fills(header)).toEqual([NAVY, NAVY, NAVY, RED]);
    expect(rules(header)).toEqual([RULE, RULE, RULE, RULE]);
    expect(texts(body)).toEqual(['D', 'E', 'F', '', 'G']);
    expect(fills(body)).toEqual([null, null, null, null, null]);
  });

  it('never leaves a new cell sharing the table shading object', () => {
    // Row 0 = [A, B (spans 3)], row 1 = [D, E, F, G]. Insert right of G:
    // column index 4 is past the end of row 0, where the new cell is at
    // position 2 - an index-based lookup finds nothing there and leaves the
    // new cell aliasing the table's shading.
    ed.open(
      JSON.stringify(
        docWithTable(
          row(cellText('A'), {
            ...cellText('B'),
            cellFormat: { columnSpan: 3 }
          }),
          row(cellText('D'), cellText('E'), cellText('F'), cellText('G'))
        )
      )
    );
    selectCell(ed, 1, 3);
    ed.editor.insertColumn(false, 1);

    const live = liveTable(ed);
    const tableShading = live.tableFormat.shading;
    const newCells = [
      live.childWidgets[0].childWidgets[2],
      live.childWidgets[1].childWidgets[4]
    ];
    for (const newCell of newCells) {
      expect(newCell.cellFormat.shading).not.toBe(tableShading);
      // Shading the new cell (right-click > cell shading) must not leak into
      // the table or the other cells.
      newCell.cellFormat.shading.backgroundColor = '#00FF00';
    }
    expect(tableShading.backgroundColor).not.toBe('#00FF00');
    expect(fills(tableRows(ed)[1])).toEqual([
      null,
      null,
      null,
      null,
      '#00FF00'
    ]);
  });

  it('undo removes the column and leaves the original styling', () => {
    ed.open(JSON.stringify(headerTable()));
    selectCell(ed, 0, 1);
    ed.editor.insertColumn(false, 1);
    ed.editorHistory.undo();

    const [header] = tableRows(ed);
    expect(fills(header)).toEqual([NAVY, NAVY]);
    expect(rules(header)).toEqual([RULE, RULE]);
  });
});

describe('installTableColumnInsertFix on a fresh editor', () => {
  let ed: any;
  beforeAll(() => {
    ed = makeRealDocumentEditor(headerTable());
  });
  afterAll(() => destroyRealDocumentEditor(ed));

  it('documents the upstream bug: unpatched, a new header cell loses its fill and rule', () => {
    selectCell(ed, 0, 1);
    ed.editor.insertColumn(false, 1);

    const [header] = tableRows(ed);
    expect(fills(header)[2]).not.toBe(NAVY);
    expect(rules(header)[2]).not.toBe(RULE);
  });

  it('installs once', () => {
    installTableColumnInsertFix(ed);
    const patched = {
      insertColumn: ed.editorModule.insertColumn,
      createColumn: ed.editorModule.createColumn,
      copyCellFormats: ed.editorModule.copyCellFormats
    };
    installTableColumnInsertFix(ed);
    expect(ed.editorModule.insertColumn).toBe(patched.insertColumn);
    expect(ed.editorModule.createColumn).toBe(patched.createColumn);
    expect(ed.editorModule.copyCellFormats).toBe(patched.copyCellFormats);
  });
});
