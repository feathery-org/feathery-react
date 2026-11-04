import { readFileSync } from 'fs';
import { resolve } from 'path';
import { exportDeckBytes } from '../core/model/export';
import { child, childrenOf, el } from '../core/opc/xml';
import { importDeck } from '../core/model/import';
import {
  renderSlideSvg,
  reconcileSlideSvg,
  bulletGlyph
} from '../core/render/svg';
import 'jest-canvas-mock';
const fixture = (n: number) =>
  importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, `fixtures/shape-parity-${n}.pptx`))
    )
  );
const render = (n: number, s: number) => {
  const d = fixture(n);
  return renderSlideSvg(
    d,
    d.slides.find((slide) => slide.path === `ppt/slides/slide${s}.xml`)!
  );
};
const geom = (svg: SVGSVGElement, id: string) =>
  svg.querySelector(`[data-shape-id="${id}"]`)!.firstElementChild!;
it('preserves the source arrow bullet', () => {
  const svg = render(3, 23);
  expect(svg.querySelector('[data-shape-id="1358"]')!.textContent).toContain(
    '➔'
  );
});
it('keeps grouped ellipses at their source aspect ratio', () => {
  const svg = render(3, 25);
  const e = svg.querySelector('[data-shape-id="1400"] ellipse')!;
  expect(e.tagName).toBe('ellipse');
  expect(
    Number(e.getAttribute('rx')) / Number(e.getAttribute('ry'))
  ).toBeCloseTo(1430100 / 357600);
});
it('renders one rounded corner instead of a rectangular fallback', () => {
  const svg = render(4, 18);
  const e = geom(svg, '664');
  expect(e.tagName).toBe('path');
  expect(e.getAttribute('d')).toMatch(/[AQ]/);
});
it.each([
  [4, '1570', '#e6c5b8'],
  [22, '2423', '#e7d5a6']
] as const)('renders the inherited number tile on slide %s', (n, id, fill) => {
  const svg = render(5, Number(n));
  const g = svg.querySelector(`[data-shape-id="${id}"]`)!;
  expect(g.querySelector('rect, path')?.getAttribute('fill')).toBe(fill);
});
it('renders curved tree brackets', () => {
  const svg = render(6, 22);
  expect(geom(svg, '746').getAttribute('d')).toMatch(/[AQ]/);
});
it('renders the concave plaque star', () => {
  const svg = render(6, 24);
  expect(geom(svg, '802').tagName).toBe('path');
  expect(geom(svg, '802').getAttribute('d')).toMatch(/[AQ]/);
});
it('keeps layout decoration below slide text after reconciliation', () => {
  const deck = fixture(6);
  const slide = deck.slides[0];
  const svg = renderSlideSvg(deck, slide);
  reconcileSlideSvg(deck, slide, svg, {
    fullContent: true,
    structure: true,
    background: true
  });
  const layers = Array.from(svg.children);
  const chrome = svg.querySelector('[data-slide-chrome]')!;
  expect(layers.indexOf(chrome)).toBeLessThan(
    layers.indexOf(svg.querySelector('[data-shape-id="345"]')!)
  );
});

it('renders the inherited teardrop and rounded panel on presentation 4 slide 20', () => {
  const svg = render(4, 20);
  expect(geom(svg, 'chrome-l-0').tagName).toBe('path');
  expect(geom(svg, 'chrome-l-1').tagName).toBe('path');
  expect(geom(svg, 'chrome-l-1').getAttribute('d')).toContain('Q');
});

it.each(['➔', '→', '★', '✓', '§'])(
  'preserves Unicode bullet %s outside legacy symbol fonts',
  (char) => {
    expect(bulletGlyph(char, 'Sora')).toBe(char);
  }
);
it('honors explicit fill overrides and preserves sparse inherited fills on export', () => {
  const deck = fixture(5);
  const slide = deck.slides[0];
  const shape = slide.shapes.find((s) => s.id === '1570')!;
  expect(child(shape.spPr!, 'a:solidFill')).toBeUndefined();
  renderSlideSvg(deck, slide);
  const reopened = importDeck(exportDeckBytes(deck));
  expect(
    geom(renderSlideSvg(reopened, reopened.slides[0]), '1570').getAttribute(
      'fill'
    )
  ).toBe('#e6c5b8');
  expect(
    child(
      reopened.slides[0].shapes.find((s) => s.id === '1570')!.spPr!,
      'a:solidFill'
    )
  ).toBeUndefined();
  childrenOf(shape.spPr!).push(el('a:noFill'));
  expect(
    renderSlideSvg(deck, slide).querySelector('[data-shape-id="1570"] > rect')
  ).toBeNull();
  childrenOf(shape.spPr!).pop();
  childrenOf(shape.spPr!).push(
    el('a:solidFill', undefined, [
      el('a:srgbClr', { val: '123456' }, [el('a:alpha', { val: '50000' })])
    ])
  );
  const explicit = geom(renderSlideSvg(deck, slide), '1570');
  expect(explicit.getAttribute('fill')).toBe('#123456');
  expect(explicit.getAttribute('fill-opacity')).toBe('0.5');
});
