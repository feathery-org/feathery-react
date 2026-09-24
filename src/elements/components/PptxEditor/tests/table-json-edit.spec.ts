import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { addTextBox, insertTable, setTableCellText } from '../core/model/edit';
import { deckToJSON } from '../core/model/json';
import { applySlideJSON } from '../core/model/applyJson';
import {
  tableCell,
  tableCellText,
  tableCells,
  tableColumns,
  tableRows
} from '../core/model/table';
import { child, childrenOf, el, getAttr } from '../core/opc/xml';

it('projects table grid columns, rows, and ordered cells into nested JSON', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 2, 2, 914400, 914400, 2000000, 800000);
  setTableCellText(deck, slide, table, 0, 0, 'Header');
  setTableCellText(deck, slide, table, 1, 1, 'Value');
  const json = deckToJSON(deck).slides[0].shapes.find(
    (shape) => shape.id === table.id
  )!;
  expect(json.table?.columns).toEqual([
    { widthEMU: 1000000 },
    { widthEMU: 1000000 }
  ]);
  expect(
    json.table?.rows.map((row) => ({
      heightEMU: row.heightEMU,
      cells: row.cells.map(({ columnIndex, text }) => ({ columnIndex, text }))
    }))
  ).toEqual([
    {
      heightEMU: 400000,
      cells: [
        { columnIndex: 0, text: 'Header' },
        { columnIndex: 1, text: '' }
      ]
    },
    {
      heightEMU: 400000,
      cells: [
        { columnIndex: 0, text: '' },
        { columnIndex: 1, text: 'Value' }
      ]
    }
  ]);
  expect(json.table?.rows[0].cells[0]).toMatchObject({
    align: 'l',
    verticalAlign: 't',
    gridSpan: 1,
    rowSpan: 1,
    mergeContinuation: false
  });
  expect(json.table?.rows[0].cells[0].paragraphs[0].runs[0].text).toBe(
    'Header'
  );
  const exported = importDeck(exportDeckBytes(deck));
  expect(
    deckToJSON(exported).slides[0].shapes.find(
      (shape) => shape.id === table.id
    )!.table
  ).toEqual(json.table);
});

it('applies nested table JSON edits to cell text, row/column sizes, and the slide frame', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 2, 2, 914400, 914400, 2000000, 800000);
  const draft = JSON.parse(JSON.stringify(deckToJSON(deck).slides[0]));
  const edited = draft.shapes.find(
    (shape: { id: string }) => shape.id === table.id
  );
  edited.frameEMU.x = 1500000;
  edited.table.columns[0].widthEMU = 1200000;
  edited.table.rows[1].heightEMU = 500000;
  edited.table.rows[0].cells[1].text = 'Edited cell';
  expect(applySlideJSON(deck, slide, draft)).toEqual({
    shapeIds: [table.id],
    background: false
  });
  expect(table.xfrm!.x).toBe(1500000);
  expect(table.xfrm!.cx).toBe(2200000);
  expect(table.xfrm!.cy).toBe(900000);
  expect(getAttr(tableColumns(table)[0], 'w')).toBe('1200000');
  expect(getAttr(tableRows(table)[1], 'h')).toBe('500000');
  const saved = importDeck(exportDeckBytes(deck));
  expect(
    deckToJSON(saved).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[0].cells[1].text
  ).toBe('Edited cell');
});

it('adds a table grid column and row from JSON while keeping cells aligned by index', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 1, 914400, 914400, 1000000, 400000);
  const draft = JSON.parse(JSON.stringify(deckToJSON(deck).slides[0]));
  const edited = draft.shapes.find(
    (shape: { id: string }) => shape.id === table.id
  ).table;
  edited.columns.push({ widthEMU: 700000 });
  edited.rows[0].cells.push({ columnIndex: 1, text: 'Right' });
  edited.rows.push({
    heightEMU: 300000,
    cells: [
      { columnIndex: 0, text: 'Bottom left' },
      { columnIndex: 1, text: 'Bottom right' }
    ]
  });
  applySlideJSON(deck, slide, draft);
  expect(tableColumns(table)).toHaveLength(2);
  expect(tableRows(table)).toHaveLength(2);
  expect(tableRows(table).map((row) => tableCells(row).length)).toEqual([2, 2]);
  expect(
    deckToJSON(deck)
      .slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[1].cells.map((cell) => cell.text)
  ).toEqual(['Bottom left', 'Bottom right']);
});

it('preserves a simple table cell hyperlink when its JSON text changes', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 1, 914400, 914400, 1000000, 400000);
  setTableCellText(deck, slide, table, 0, 0, 'Linked');
  const cell = tableCell(table, 0, 0)!;
  const run = child(child(child(cell, 'a:txBody')!, 'a:p')!, 'a:r')!;
  const rPr = child(run, 'a:rPr')!;
  childrenOf(rPr).push(el('a:hlinkClick', { 'r:id': 'rId90' }));
  const draft = JSON.parse(JSON.stringify(deckToJSON(deck).slides[0]));
  draft.shapes.find(
    (shape: { id: string }) => shape.id === table.id
  ).table.rows[0].cells[0].text = 'Updated';
  applySlideJSON(deck, slide, draft);
  expect(tableCellText(cell)).toBe('Updated');
  expect(getAttr(child(rPr, 'a:hlinkClick')!, 'r:id')).toBe('rId90');
});

it('changes a text run and rejects unsupported JSON edits before touching XML', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'Hello'
  );
  const draft = JSON.parse(JSON.stringify(deckToJSON(deck).slides[0]));
  const edited = draft.shapes.find((s: { id: string }) => s.id === shape.id);
  edited.text.paragraphs[0].runs[0].text = 'Updated';
  edited.text.paragraphs[0].runs[0].bold = true;
  edited.text.paragraphs[0].runs[0].color = '#FF0000';
  applySlideJSON(deck, slide, draft);
  expect(shape.text!.paragraphs[0].runs[0]).toMatchObject({
    text: 'Updated',
    bold: true,
    color: 'FF0000'
  });

  const invalid = JSON.parse(JSON.stringify(deckToJSON(deck).slides[0]));
  const bad = invalid.shapes.find((s: { id: string }) => s.id === shape.id);
  bad.text.paragraphs[0].runs[0].text = 'Should not apply';
  bad.name = 'Unsupported rename';
  expect(() => applySlideJSON(deck, slide, invalid)).toThrow(
    /unsupported edit/
  );
  expect(shape.text!.paragraphs[0].runs[0].text).toBe('Updated');
});
