import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { tableRows } from '../core/model/table';
import { getAttr, setAttr } from '../core/opc/xml';
import { renderSlideSvg } from '../core/render/svg';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);

it('draws a row stored as 0 high as tall as its text, not a share of the table', () => {
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
  const [first, second] = tableRows(shape);
  setAttr(first, 'h', '0');
  // jsdom lays out no text, so give each cell's text a measured height of 20px
  const measured = jest
    .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return this.style.height === 'auto' ? 20 : 0;
    });

  const svg = renderSlideSvg(deck, slide);
  measured.mockRestore();
  const rowHeight = (row: number) =>
    Number(
      svg
        .querySelector(
          `[data-shape-id="${shape.id}"] rect[data-table-cell-bg][data-row="${row}"]`
        )!
        .getAttribute('height')
    );

  expect(rowHeight(0)).toBe(20 * 9525);
  expect(rowHeight(1)).toBe(Number(getAttr(second, 'h')));
});
