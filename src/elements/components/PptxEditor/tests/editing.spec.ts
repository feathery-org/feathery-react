import { resolve } from 'path';
import { readFileSync } from 'fs';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import {
  insertTable,
  insertImage,
  insertSlideNumber,
  setSlideBackground,
  setSlideBackgroundImage,
  setTextStyle,
  setParagraphAlign,
  reorderShape,
  setTableCellText,
  addTableRow,
  addTableColumn,
  removeTableRow,
  removeTableColumn,
  setTableColumnWidth,
  setTableRowHeight,
  snapTableRowsToContent,
  setTableStyle
} from '../core/model/edit';
import {
  tableCell,
  tableCellFill,
  tableColumns,
  tableRows
} from '../core/model/table';

const fixture = resolve(__dirname, 'fixtures/sample.pptx');
const bytes = () => new Uint8Array(readFileSync(fixture));
// 1x1 png
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (c) => c.charCodeAt(0)
);

describe('toolbar editing operations survive round trip', () => {
  it('inserts a table', () => {
    const deck = importDeck(bytes());
    const before = deck.slides[0].shapes.length;
    insertTable(deck, deck.slides[0], 3, 4, 0, 0, 5000000, 2000000);
    expect(deck.slides[0].shapes.length).toBe(before + 1);
    const out = importDeck(exportDeckBytes(deck));
    const table = out.slides[0].shapes.find((s) => s.type === 'table')!;
    expect(table).toBeTruthy();
    expect(tableCellFill(tableCell(table, 0, 0))).toBe('FFFFFF');
  });

  it('inserts an image (adds media part + rel + content type)', () => {
    const deck = importDeck(bytes());
    insertImage(deck, deck.slides[0], PNG, 'png', 0, 0, 1000000, 1000000);
    const out = importDeck(exportDeckBytes(deck));
    expect(out.slides[0].shapes.some((s) => s.type === 'pic')).toBe(true);
    // content-type default for png present
    const ct = out.pkg.tree('[Content_Types].xml');
    expect(JSON.stringify(ct)).toContain('image/png');
  });

  it('inserts a slide number field that reads back as text', () => {
    const deck = importDeck(bytes());
    insertSlideNumber(deck, deck.slides[0], 7);
    const out = importDeck(exportDeckBytes(deck));
    const num = out.slides[0].shapes.find((s) =>
      s.name.startsWith('Slide Number')
    );
    expect(num?.text?.paragraphs[0].runs[0].text).toBe('7');
  });

  it('sets a gradient background', () => {
    const deck = importDeck(bytes());
    setSlideBackground(deck, deck.slides[0], {
      type: 'gradient',
      color1: '1F4E79',
      color2: 'C0143C',
      angleDeg: 90
    });
    const out = importDeck(exportDeckBytes(deck));
    expect(JSON.stringify(out.pkg.tree(out.slides[0].path))).toContain(
      'gradFill'
    );
  });

  it('sets an image background (blipFill + media part + rel)', () => {
    const deck = importDeck(bytes());
    setSlideBackgroundImage(deck, deck.slides[0], PNG, 'png');
    const out = importDeck(exportDeckBytes(deck));
    const slideXml = JSON.stringify(out.pkg.tree(out.slides[0].path));
    expect(slideXml).toContain('a:blipFill');
    // the blip's rId resolves to a media part
    const rels = out.pkg.rels(out.slides[0].path);
    expect(
      rels.some((r) => r.type.endsWith('/image') && r.target.includes('media/'))
    ).toBe(true);
  });

  it('applies text style to every run', () => {
    const deck = importDeck(bytes());
    const shape = deck.slides
      .flatMap((s) => s.shapes)
      .find((s) =>
        s.text?.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))
      )!;
    const slide = deck.slides.find((s) => s.shapes.includes(shape))!;
    setTextStyle(deck, slide, shape, {
      bold: true,
      strike: true,
      color: 'C00000',
      sizePt: 24
    });
    setParagraphAlign(deck, slide, shape, 'ctr');
    const r = shape.text!.paragraphs[0].runs[0];
    expect(r.bold).toBe(true);
    expect(r.strike).toBe(true);
    expect(r.color).toBe('C00000');
    expect(r.sizePt).toBe(24);
    expect(shape.text!.paragraphs[0].align).toBe('ctr');
  });

  it('edits, sizes, styles, and round-trips a table', () => {
    const deck = importDeck(bytes());
    const slide = deck.slides[0];
    const table = insertTable(deck, slide, 2, 2, 0, 0, 2000000, 800000);
    setTableCellText(deck, slide, table, 0, 0, 'A long cell value that wraps');
    addTableRow(deck, slide, table);
    addTableColumn(deck, slide, table);
    setTableColumnWidth(deck, slide, table, 0, 1200000);
    setTableRowHeight(deck, slide, table, 0, 360000);
    setTableStyle(deck, slide, table, 'FFF2CC', 'C9A227');
    snapTableRowsToContent(deck, slide, table);
    removeTableRow(deck, slide, table);
    removeTableColumn(deck, slide, table);
    expect(tableRows(table)).toHaveLength(2);
    expect(tableColumns(table)).toHaveLength(2);
    const xml = JSON.stringify(exportDeckBytes(deck));
    expect(xml.length).toBeGreaterThan(0);
    const out = importDeck(exportDeckBytes(deck));
    const outTable = out.slides[0].shapes.find((s) => s.id === table.id)!;
    expect(JSON.stringify(outTable.node)).toContain(
      'A long cell value that wraps'
    );
    expect(JSON.stringify(outTable.node)).toContain('FFF2CC');
    expect(JSON.stringify(outTable.node)).toContain('C9A227');
  });

  it('reorders z-order (send to back)', () => {
    const deck = importDeck(bytes());
    const slide = deck.slides[0];
    const last = slide.shapes[slide.shapes.length - 1];
    reorderShape(deck, slide, last, 'back');
    expect(slide.shapes[0]).toBe(last);
  });
});
