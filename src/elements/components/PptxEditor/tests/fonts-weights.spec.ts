/* eslint-disable no-restricted-globals -- jsdom test */
import { importDeck } from '../core/model/import';
import { addTextBox } from '../core/model/edit';
import { refreshShapeText } from '../core/model/read';
import { renderSlideSvg } from '../core/render/svg';
import { childrenOf, el, setAttr } from '../core/opc/xml';
import { sampleBytes } from './harness';

const hrefs = () =>
  Array.from(document.querySelectorAll('link[data-pptx-font="Roboto"]')).map(
    (link) => link.getAttribute('href') || ''
  );
const requests = (weight: number) =>
  hrefs().filter((href) => new RegExp(`wght@[^&]*\\b${weight}\\b`).test(href));

it('requests weights a family needs later, not only those of its first request', () => {
  const deck = importDeck(sampleBytes());
  const slide = deck.slides[0];
  const shape = addTextBox(deck, slide, 914400, 914400, 3000000, 900000, 'Hi');
  const run = shape.text!.paragraphs[0].runs[0];
  let rPr = run.rPr;
  if (!rPr) {
    rPr = el('a:rPr');
    childrenOf(run.node).unshift(rPr);
  }
  childrenOf(rPr).push(el('a:latin', { typeface: 'Roboto' }));
  refreshShapeText(shape);

  renderSlideSvg(deck, slide);
  expect(requests(400).length).toBeGreaterThan(0);
  expect(requests(700)).toHaveLength(0);

  // Bold applied after the family was first requested needs the 700 face.
  setAttr(rPr, 'b', '1');
  refreshShapeText(shape);
  renderSlideSvg(deck, slide);
  expect(requests(700).length).toBeGreaterThan(0);

  // Already-requested faces are not requested again.
  const before = hrefs().length;
  renderSlideSvg(deck, slide);
  expect(hrefs()).toHaveLength(before);
});
