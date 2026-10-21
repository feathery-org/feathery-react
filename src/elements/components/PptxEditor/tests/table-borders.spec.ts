import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { tableCellBorderEdge, tableCells, tableRows } from '../core/model/table';
import { child, childrenOf, tagOf } from '../core/opc/xml';
import { renderSlideSvg } from '../core/render/svg';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);

function tableSetup() {
  const engine = new PptxEditorEngine();
  engine.load(fixture);
  const deck = (engine as any).deck;
  const slide = deck.slides[0];
  const inserted = engine.execute({
    type: 'insert-shape',
    slideId: slide.path,
    shape: {
      kind: 'table',
      rows: 2,
      columns: 2,
      x: 0,
      y: 0,
      cx: 2200000,
      cy: 1040000
    }
  });
  const shape = slide.shapes.find(
    (candidate: any) => candidate.id === inserted.createdShapeIds[0]
  );
  return { engine, deck, slide, shape };
}

describe('table borders', () => {
  it('writes ln edges in tcPr schema order (before the fill) with the requested style', () => {
    const { engine, slide, shape } = tableSetup();
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [
        {
          kind: 'set-borders',
          target: 'all',
          color: 'FF0000',
          widthPt: 2,
          dash: 'dash'
        }
      ]
    });
    const cell = tableCells(tableRows(shape)[0])[0];
    const pr = child(cell, 'a:tcPr')!;
    const tags = childrenOf(pr).map((node) => tagOf(node));
    // Schema: lnL, lnT, lnR, lnB precede the fill or PowerPoint drops them.
    expect(tags.slice(0, 4)).toEqual(['a:lnL', 'a:lnT', 'a:lnR', 'a:lnB']);
    expect(tags.indexOf('a:solidFill')).toBeGreaterThan(3);
    const edge = tableCellBorderEdge(cell, 'L');
    expect(edge).toMatchObject({
      color: 'FF0000',
      widthEMU: 25400,
      dash: 'dash',
      none: false
    });
  });

  it('renders border lines above every cell background rect', () => {
    const { engine, deck, slide, shape } = tableSetup();
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [
        {
          kind: 'set-borders',
          target: 'all',
          color: 'FF0000',
          widthPt: 2,
          dash: 'solid'
        }
      ]
    });
    const svg = renderSlideSvg(deck, slide);
    const group = svg.querySelector(`[data-shape-id="${shape.id}"]`)!;
    const all = Array.from(group.querySelectorAll('*'));
    const lastRect = all
      .map((el, i) => (el.tagName === 'rect' ? i : -1))
      .reduce((a, b) => Math.max(a, b), -1);
    const firstLine = all.findIndex((el) => el.tagName === 'line');
    expect(lastRect).toBeGreaterThan(-1);
    expect(firstLine).toBeGreaterThan(lastRect);
    expect(
      all.filter((el) => el.tagName === 'line').length
    ).toBeGreaterThanOrEqual(16);
  });

  it('inserts and removes rows and columns at a position', () => {
    const { engine, slide, shape } = tableSetup();
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [
        { kind: 'set-cell-text', row: 0, col: 0, value: 'top' },
        { kind: 'set-cell-text', row: 1, col: 0, value: 'bottom' }
      ]
    });
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [{ kind: 'add-row', index: 1 }]
    });
    expect(tableRows(shape)).toHaveLength(3);
    // The new middle row is blank; original bottom row shifted down.
    const texts = tableRows(shape).map((row) =>
      tableCells(row)
        .map((cell) => cell)
        .map((cell) => JSON.stringify(cell).includes('bottom'))
    );
    expect(texts[2][0]).toBe(true);
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [{ kind: 'remove-row', index: 1 }]
    });
    expect(tableRows(shape)).toHaveLength(2);
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [{ kind: 'add-column', index: 0 }]
    });
    expect(tableCells(tableRows(shape)[0])).toHaveLength(3);
    expect(JSON.stringify(tableCells(tableRows(shape)[0])[1])).toContain(
      'top'
    );
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: shape.id,
      operations: [{ kind: 'remove-column', index: 0 }]
    });
    expect(tableCells(tableRows(shape)[0])).toHaveLength(2);
  });
});
