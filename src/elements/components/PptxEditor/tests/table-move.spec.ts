import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { insertTable, setShapeGeometry } from '../core/model/edit';
import { tableColumns, tableRows } from '../core/model/table';
import { getAttr, setAttr } from '../core/opc/xml';

function mismatchedTable() {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 2, 2, 914400, 914400, 2000000, 800000);
  // Imported tables may have a frame extent that differs from the row/grid sum.
  tableRows(table).forEach((row) => setAttr(row, 'h', '500000'));
  return { deck, slide, table };
}

const dimensions = (table: ReturnType<typeof mismatchedTable>['table']) => ({
  rows: tableRows(table).map((row) => getAttr(row, 'h')),
  cols: tableColumns(table).map((col) => getAttr(col, 'w')),
  frame: [table.xfrm!.cx, table.xfrm!.cy]
});

it('does not resize a table when SVG move passes its unchanged frame size', () => {
  const { deck, slide, table } = mismatchedTable();
  const before = dimensions(table);
  setShapeGeometry(deck, slide, table, {
    x: 1500000,
    y: 1800000,
    cx: table.xfrm!.cx,
    cy: table.xfrm!.cy
  });
  expect(dimensions(table)).toEqual(before);
  expect([table.xfrm!.x, table.xfrm!.y]).toEqual([1500000, 1800000]);
  const saved = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (s) => s.id === table.id
  )!;
  expect(dimensions(saved)).toEqual(before);
});
