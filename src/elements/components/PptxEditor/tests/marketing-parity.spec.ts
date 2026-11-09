import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { setTextStyle } from '../core/model/edit';
import { renderSlideSvg } from '../core/render/svg';

const fixture = () =>
  importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/marketing-parity.pptx'))
    )
  );
const run = (svg: SVGSVGElement, text: string) =>
  Array.from(svg.querySelectorAll('[data-source-run]')).find(
    (node) => node.textContent === text
  ) as HTMLElement;

it('inherits bold cover typography from the title master', () => {
  const deck = fixture();
  expect(
    run(renderSlideSvg(deck, deck.slides[0]), 'Marketing Plan Presentation')
      .style.fontWeight
  ).toBe('700');
});

it.each([
  [16, 'Customer journey'],
  [22, 'Launch timeline']
] as const)(
  'keeps slide %s title defaults separate from unindexed body placeholders',
  (number, title) => {
    const deck = fixture();
    const titleRun = run(renderSlideSvg(deck, deck.slides[number - 1]), title);
    expect(parseFloat(titleRun.style.fontSize)).toBeGreaterThan(30);
    expect(titleRun.style.fontWeight).toBe('700');
    expect(titleRun.style.color).toBe('rgb(255, 255, 255)');
  }
);

const shapeGeometry = (svg: SVGSVGElement, id: string) =>
  svg.querySelector(`[data-shape-id="${id}"]`)!.firstElementChild!;

it.each([
  [7, '596'],
  [13, '870']
] as const)('renders adjusted rounded corners on slide %s', (number, id) => {
  const deck = fixture();
  const geometry = shapeGeometry(
    renderSlideSvg(deck, deck.slides[number - 1]),
    id
  );
  expect(geometry.tagName).toBe('path');
  expect(geometry.getAttribute('d')).toContain('A ');
});

it('renders both bends of the adjusted connector network', () => {
  const deck = fixture();
  const svg = renderSlideSvg(deck, deck.slides[8]);
  for (const id of ['663', '664']) {
    const geometry = shapeGeometry(svg, id);
    expect(geometry.tagName).toBe('path');
    expect(geometry.getAttribute('d')).toContain('238125');
    expect(geometry.getAttribute('d')!.match(/L/g)).toHaveLength(3);
  }
});

it('uses radial path gradients for the decorative backgrounds', () => {
  const deck = fixture();
  const svg = renderSlideSvg(deck, deck.slides[1]);
  expect(svg.querySelector('radialGradient')).not.toBeNull();
});

it('does not enlarge a freeform arrow stroke with its group coordinate scale', () => {
  const deck = fixture();
  const svg = renderSlideSvg(deck, deck.slides[26]);
  const path = shapeGeometry(svg, '1368');
  expect(path.getAttribute('fill')).toBe('none');
  const groupScale = 1067482 / 166309;
  expect(Number(path.getAttribute('stroke-width')) * groupScale).toBeCloseTo(
    19050,
    -1
  );
});

it('keeps the timeline arrowhead large enough to match the source line ending', () => {
  const deck = fixture();
  const svg = renderSlideSvg(deck, deck.slides[21]);
  const line = shapeGeometry(svg, '1265');
  const id = line.getAttribute('marker-end')!.slice(5, -1);
  expect(
    Number(svg.querySelector(`[id="${id}"]`)!.getAttribute('markerWidth'))
  ).toBeGreaterThanOrEqual(7);
});

it('preserves explicit non-bold run overrides through export and import', () => {
  const deck = fixture();
  const slide = deck.slides[0];
  const shape = slide.shapes.find((node) =>
    node.text?.paragraphs.some((p) =>
      p.runs.some((r) => r.text === 'Marketing Plan Presentation')
    )
  )!;
  setTextStyle(deck, slide, shape, { bold: false });
  const reopened = importDeck(exportDeckBytes(deck));
  const title = run(
    renderSlideSvg(reopened, reopened.slides[0]),
    'Marketing Plan Presentation'
  );
  expect(title.style.fontWeight).not.toBe('700');
});

it('retains the source portrait crop rather than recentering or stretching the visible region', () => {
  const deck = fixture();
  const slide = deck.slides[2];
  const portrait = slide.shapes.find((node) => node.id === '519')!;
  portrait.imageSrc = 'data:image/png;base64,AA==';
  const image = renderSlideSvg(deck, slide).querySelector(
    '[data-shape-id="519"] image'
  )!;
  const sourceWidth = Number(image.getAttribute('width'));
  expect(-Number(image.getAttribute('x')) / sourceWidth).toBeCloseTo(
    0.16746,
    5
  );
  expect(portrait.xfrm!.cx / sourceWidth).toBeCloseTo(1 - 2 * 0.16746, 5);
});
