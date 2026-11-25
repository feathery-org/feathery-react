import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { renderSlideSvg } from '../core/render/svg';
import { exportDeckBytes } from '../core/model/export';
import { child, childrenOf, el, setAttr } from '../core/opc/xml';
import 'jest-canvas-mock';

// Reduced from slide 10 of a Google Slides export, checked in native PowerPoint.
// PowerPoint uses its title style for this export's title-type footers.
const referenceBytes = () =>
  new Uint8Array(
    readFileSync(resolve(__dirname, 'fixtures/powerpoint-text-defaults.pptx'))
  );
const renderReference = (deck = importDeck(referenceBytes())) => {
  const svg = renderSlideSvg(deck, deck.slides[0]);
  return Array.from(svg.querySelectorAll('[data-source-run]')) as HTMLElement[];
};

it('uses master otherStyle for ordinary text boxes without explicit font sizes', () => {
  const runs = renderReference();
  const company = runs.find((run) => run.textContent === 'Company name')!;
  expect(parseFloat(company.style.fontSize)).toBeCloseTo((14 * 96) / 72);
});

it('lifts compressed title lines above their rules without changing the line pitch', () => {
  const deck = importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/template1-text-group.pptx'))
    )
  );
  const svg = renderSlideSvg(deck, deck.slides[0]);
  const paragraphs = Array.from(
    svg.querySelectorAll('[data-source-paragraph]')
  ).filter(
    (node) => node.tagName.toLowerCase() === 'div' && !!node.textContent?.trim()
  ) as HTMLElement[];
  expect(paragraphs).toHaveLength(2);
  for (const paragraph of paragraphs) {
    expect(parseFloat(paragraph.style.lineHeight)).toBeCloseTo(67.2);
    expect(parseFloat(paragraph.style.marginTop)).toBeCloseTo(-14.4);
    expect(parseFloat(paragraph.style.marginBottom)).toBeCloseTo(14.4);
  }
});

it('uses the master slide-number placeholder rather than the body placeholder', () => {
  const number = renderReference().find((run) => run.textContent === '1')!;
  expect(parseFloat(number.style.fontSize)).toBe(8); // 6pt
});

it('keeps native PowerPoint title inheritance for title-type footers', () => {
  const runs = renderReference();
  for (const text of ['Key stakeholders', 'Company Name', 'Date']) {
    expect(runs.find((run) => run.textContent === text)!.style.fontSize).toBe(
      '48px'
    );
  }
});

it('inherits the master line spacing for text without paragraph overrides', () => {
  const company = renderReference().find(
    (run) => run.textContent === 'Company name'
  )!;
  expect(parseFloat(company.parentElement!.style.lineHeight)).toBeCloseTo(
    ((14 * 96) / 72) * 1.2
  );
});

it('wraps words wider than their text box, as PowerPoint does', () => {
  const company = renderReference().find(
    (run) => run.textContent === 'Company Name'
  )!;
  expect(company.parentElement!.style.overflowWrap).toBe('break-word');
});

it('keeps direct font and line-spacing overrides and explicit no-wrap', () => {
  const deck = importDeck(referenceBytes());
  const footer = deck.slides[0].shapes.find(
    (shape) => shape.text?.paragraphs[0].runs[0]?.text === 'Company Name'
  )!;
  const paragraph = footer.text!.paragraphs[0];
  paragraph.runs[0].sizePt = 20;
  const pPr = child(paragraph.node, 'a:pPr')!;
  childrenOf(pPr).push(
    el('a:lnSpc', undefined, [el('a:spcPts', { val: '2400' })])
  );
  setAttr(child(footer.text!.node, 'a:bodyPr')!, 'wrap', 'none');
  const run = renderReference(deck).find(
    (run) => run.textContent === 'Company Name'
  )!;
  expect(parseFloat(run.style.fontSize)).toBeCloseTo((20 * 96) / 72);
  expect(run.parentElement!.style.lineHeight).toBe('32px');
  expect(run.parentElement!.style.whiteSpace).toBe('pre');
  expect(run.parentElement!.style.overflowWrap).toBe('');
});

it('keeps inherited styles sparse when rendering and exporting', () => {
  const bytes = referenceBytes();
  const deck = importDeck(bytes);
  renderReference(deck);
  const reopened = importDeck(exportDeckBytes(deck));
  const runs = renderReference(reopened);
  expect(
    runs.find((run) => run.textContent === 'Company name')!.style.fontSize
  ).toBe(`${(14 * 96) / 72}px`);
  expect(
    reopened.slides[0].shapes.find(
      (shape) => shape.text?.paragraphs[0].runs[0]?.text === 'Company Name'
    )!.text!.paragraphs[0].runs[0].sizePt
  ).toBeUndefined();
});
