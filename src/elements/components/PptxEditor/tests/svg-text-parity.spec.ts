import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { deckToJSON } from '../core/model/json';
import { refreshShapeText } from '../core/model/read';
import { renderSlideSvg } from '../core/render/svg';
import { child, childrenOf, el, setAttr, tagOf } from '../core/opc/xml';

it('carries DrawingML autofit, paragraph spacing, tabs, and field identity into JSON and SVG text', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slideIndex = deck.slides.findIndex((slide) =>
    slide.shapes.some((shape) => shape.text)
  );
  const slide = deck.slides[slideIndex];
  const shape = slide.shapes.find((s) => s.text)!;
  const bodyPr = child(shape.text!.node, 'a:bodyPr')!;
  setAttr(bodyPr, 'anchor', 'b');
  const normal = child(bodyPr, 'a:normAutofit') || el('a:normAutofit');
  if (!child(bodyPr, 'a:normAutofit')) childrenOf(bodyPr).push(normal);
  setAttr(normal, 'fontScale', '80000');
  setAttr(normal, 'lnSpcReduction', '10000');
  const para = shape.text!.paragraphs[0].node;
  const pPr = child(para, 'a:pPr') || el('a:pPr');
  if (!child(para, 'a:pPr')) childrenOf(para).unshift(pPr);
  const line = child(pPr, 'a:lnSpc') || el('a:lnSpc');
  if (!child(pPr, 'a:lnSpc')) childrenOf(pPr).push(line);
  childrenOf(line).splice(
    0,
    childrenOf(line).length,
    el('a:spcPct', { val: '120000' })
  );
  const before = child(pPr, 'a:spcBef') || el('a:spcBef');
  if (!child(pPr, 'a:spcBef')) childrenOf(pPr).push(before);
  childrenOf(before).splice(
    0,
    childrenOf(before).length,
    el('a:spcPts', { val: '1200' })
  );
  const tabs = child(pPr, 'a:tabLst') || el('a:tabLst');
  if (!child(pPr, 'a:tabLst')) childrenOf(pPr).push(tabs);
  childrenOf(tabs).splice(
    0,
    childrenOf(tabs).length,
    el('a:tab', { pos: '914400', algn: 'ctr' })
  );
  const field = el('a:fld', { id: 'field-1', type: 'slidenum' }, [
    el('a:rPr', { lang: 'en-US' }),
    el('a:t', undefined, [{ '#text': '1' }])
  ]);
  const paraKids = childrenOf(para);
  const endIndex = paraKids.findIndex((node) => tagOf(node) === 'a:endParaRPr');
  paraKids.splice(endIndex < 0 ? paraKids.length : endIndex, 0, field);
  refreshShapeText(shape);

  const text = deckToJSON(deck).slides[slideIndex].shapes.find(
    (s) => s.id === shape.id
  )!.text!;
  expect(text.bodyPr.autofit).toEqual({
    type: 'normal',
    fontScalePct: 80,
    lineSpaceReductionPct: 10
  });
  expect(text.bodyPr.anchor).toBe('b');
  expect(text.paragraphs[0].props?.lineSpacing).toEqual({
    kind: 'percent',
    valPct: 120
  });
  expect(text.paragraphs[0].props?.spaceBefore).toEqual({
    kind: 'points',
    valPt: 12
  });
  expect(text.paragraphs[0].props?.tabs).toEqual([
    { posEMU: 914400, align: 'ctr' }
  ]);
  expect(text.paragraphs[0].runs.at(-1)).toMatchObject({
    node: 'field',
    id: 'field-1',
    fieldType: 'slidenum',
    text: '1'
  });

  const svg = renderSlideSvg(deck, slide);
  const group = svg.querySelector(`[data-shape-id="${shape.id}"]`)!;
  const content = group.querySelector('[data-textbody]') as HTMLElement;
  const firstPara = content.firstElementChild as HTMLElement;
  const firstRun = firstPara.querySelector(
    '[data-source-run="0"]'
  ) as HTMLElement;
  expect(content.style.justifyContent).toBe('flex-end');
  expect(firstPara.style.lineHeight).toBe('1.1');
  expect(firstPara.style.marginTop).toBe('16px');
  expect(Number.parseFloat(firstRun.style.fontSize)).toBeCloseTo(
    (((shape.text!.paragraphs[0].runs[0].sizePt ?? 18) * 96) / 72) * 0.8
  );
  expect(
    group.querySelector('[contenteditable="false"][data-source-run]')
  ).not.toBeNull();
});

it('lets centered no-autofit text extend above and below its box unless vertical clipping is explicit', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides.find((s) => s.shapes.some((shape) => shape.text))!;
  const shape = slide.shapes.find((s) => s.text)!;
  const bodyPr = child(shape.text!.node, 'a:bodyPr')!;
  setAttr(bodyPr, 'anchor', 'ctr');
  setAttr(bodyPr, 'wrap', 'square');
  childrenOf(bodyPr).splice(0, childrenOf(bodyPr).length, el('a:noAutofit'));
  shape.xfrm!.cy = 100000; // shorter than the rendered line of text
  shape.text!.paragraphs[0].runs[0].text =
    'First line\nSecond line\nThird line';

  const renderedText = () => {
    const group = renderSlideSvg(deck, slide).querySelector(
      `[data-shape-id="${shape.id}"]`
    )!;
    return {
      fo: group.querySelector('foreignObject') as SVGForeignObjectElement,
      body: group.querySelector('[data-textbody]') as HTMLElement,
      para: group.querySelector('[data-textbody] > div') as HTMLElement
    };
  };
  const overflowing = renderedText();
  expect(overflowing.body.style.justifyContent).toBe('center');
  expect(overflowing.fo.style.overflow).toBe('visible');
  expect(overflowing.body.style.overflow).toBe('visible');
  expect(overflowing.para.style.flexShrink).toBe('0');
  expect(
    deckToJSON(deck)
      .slides.find((s) => s.path === slide.path)!
      .shapes.find((s) => s.id === shape.id)!.text!.bodyPr.autofit
  ).toEqual({ type: 'none' });

  setAttr(bodyPr, 'vertOverflow', 'clip');
  const clipped = renderedText();
  expect(clipped.fo.style.overflow).toBe('hidden');
  expect(clipped.body.style.overflow).toBe('hidden');
  expect(
    deckToJSON(deck)
      .slides.find((s) => s.path === slide.path)!
      .shapes.find((s) => s.id === shape.id)!.text!.bodyPr.verticalOverflow
  ).toBe('clip');
});

it('renders DrawingML hyperlinks as clickable anchors in SVG text', () => {
  const deck = importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
  const slide = deck.slides.find((candidate) =>
    candidate.shapes.some((shape) =>
      shape.text?.paragraphs.some((paragraph) => paragraph.runs.length)
    )
  )!;
  const shape = slide.shapes.find((candidate) =>
    candidate.text?.paragraphs.some((paragraph) => paragraph.runs.length)
  )!;
  const run = shape.text!.paragraphs.find((paragraph) => paragraph.runs.length)!
    .runs[0];
  const rPr = run.rPr || el('a:rPr');
  if (!run.rPr) childrenOf(run.node).unshift(rPr);
  const relationshipId = deck.pkg.addRelationship(
    slide.path,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
    'https://example.com/docs',
    true
  );
  childrenOf(rPr).push(
    el('a:hlinkClick', {
      'r:id': relationshipId,
      tooltip: 'Open documentation'
    })
  );
  refreshShapeText(shape);

  const link = renderSlideSvg(deck, slide).querySelector(
    `[data-shape-id="${shape.id}"] a[data-hyperlink]`
  ) as HTMLAnchorElement;
  expect(link).toBeTruthy();
  expect(link.getAttribute('href')).toBe('https://example.com/docs');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('title')).toBe('Open documentation');
  expect(link.textContent).toContain(run.text);
});
