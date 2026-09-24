import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  addAutoShape,
  addTextBox,
  insertImage,
  insertTable,
  readPictureCrop,
  setParagraphBullet,
  setPictureCrop,
  setTableCellRangeAlign,
  setTextStyle
} from '../core/model/edit';
import { exportDeckBytes } from '../core/model/export';
import { importDeck } from '../core/model/import';
import { deckToJSON } from '../core/model/json';
import {
  renderSlideSvg,
  autoNumberGlyph,
  bulletGlyph
} from '../core/render/svg';
import { setSlideSize } from '../core/model/slideSize';
import { child, childrenOf, el } from '../core/opc/xml';
import { readShapeNode } from '../core/model/read';
import { applySlideJSON } from '../core/model/applyJson';

const fixture = () =>
  importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (value) => value.charCodeAt(0)
);

it('renders and serializes highlight, superscript, and subscript run formatting', () => {
  const deck = fixture();
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    100000,
    100000,
    2000000,
    500000,
    'Marked'
  );
  setTextStyle(deck, slide, shape, { highlight: 'F7B801', baselinePct: 30 });
  const span = renderSlideSvg(deck, slide).querySelector(
    `[data-shape-id="${shape.id}"] [data-source-run]`
  ) as HTMLElement;
  expect(span.style.backgroundColor).toBe('rgb(247, 184, 1)');
  expect(span.style.verticalAlign).toBe('30%');
  const run = deckToJSON(deck).slides[0].shapes.find(
    (candidate) => candidate.id === shape.id
  )!.text!.paragraphs[0].runs[0];
  expect(run).toMatchObject({ highlight: '#F7B801', baselinePct: 30 });
  setTextStyle(deck, slide, shape, { baselinePct: -40 });
  expect(
    (
      renderSlideSvg(deck, slide).querySelector(
        `[data-shape-id="${shape.id}"] [data-source-run]`
      ) as HTMLElement
    ).style.verticalAlign
  ).toBe('-40%');
});

it('supports arrow, dash, lower-alpha, and lower-roman bullets', () => {
  expect(bulletGlyph('➤', undefined)).toBe('➤');
  expect(bulletGlyph('–', undefined)).toBe('–');
  expect(autoNumberGlyph(2, 'alphaLcParenR')).toBe('b)');
  expect(autoNumberGlyph(4, 'romanLcPeriod')).toBe('iv.');
  const deck = fixture();
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    100000,
    100000,
    2000000,
    500000,
    'Alpha'
  );
  setParagraphBullet(deck, slide, shape, {
    kind: 'autoNum',
    scheme: 'alphaLcParenR',
    startAt: 1
  });
  expect(
    renderSlideSvg(deck, slide).querySelector('[data-bullet]')?.textContent
  ).toContain('a)');
  expect(
    deckToJSON(deck).slides[0].shapes.find(
      (candidate) => candidate.id === shape.id
    )!.text!.paragraphs[0].bullet
  ).toMatchObject({ scheme: 'alphaLcParenR', startAt: 1 });
});

it('aligns selected table cells horizontally and vertically and exposes it in JSON', () => {
  const deck = fixture();
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 1, 100000, 100000, 1500000, 600000);
  setTableCellRangeAlign(
    deck,
    slide,
    table,
    { startRow: 0, endRow: 0, startCol: 0, endCol: 0 },
    'ctr',
    'b'
  );
  const cell = renderSlideSvg(deck, slide).querySelector(
    `[data-shape-id="${table.id}"] [data-table-cell]`
  ) as HTMLElement;
  expect(cell.style.textAlign).toBe('center');
  expect(cell.style.justifyContent).toBe('flex-end');
  expect(
    deckToJSON(deck).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[0].cells[0]
  ).toMatchObject({ align: 'ctr', verticalAlign: 'b' });
});

it('preserves a per-slide A4-sized viewport through JSON and PPTX round-trip', () => {
  const deck = fixture();
  const slide = deck.slides[0];
  setSlideSize(deck, slide, 10689336, 7560072);
  expect(renderSlideSvg(deck, slide).getAttribute('viewBox')).toBe(
    '0 0 10689336 7560072'
  );
  expect(deckToJSON(deck).slides[0].sizeEMU).toEqual({
    cx: 10689336,
    cy: 7560072
  });
  expect(importDeck(exportDeckBytes(deck)).slides[0].size).toEqual({
    cx: 10689336,
    cy: 7560072
  });
});

it('renders preset geometry, line styles, shadows, and nested groups and exposes their hierarchy in JSON', () => {
  const deck = fixture();
  const slide = deck.slides[0];
  const arrow = addAutoShape(
    deck,
    slide,
    'rightArrow',
    100000,
    100000,
    1200000,
    500000,
    'FF6B4A'
  );
  const spPr = arrow.spPr!;
  childrenOf(spPr).push(
    el('a:ln', { w: '25400' }, [
      el('a:solidFill', undefined, [el('a:srgbClr', { val: '1E2761' })]),
      el('a:prstDash', { val: 'lgDash' }),
      el('a:headEnd', { type: 'oval' }),
      el('a:tailEnd', { type: 'triangle' })
    ]),
    el('a:effectLst', undefined, [
      el('a:outerShdw', { blurRad: '50000', dist: '40000', dir: '2700000' }, [
        el('a:srgbClr', { val: '000000' }, [el('a:alpha', { val: '35000' })])
      ])
    ])
  );

  const childShape = addAutoShape(
    deck,
    slide,
    'star5',
    0,
    0,
    500000,
    500000,
    '7B8FD4'
  );
  const childIndex = slide.shapes.indexOf(childShape);
  slide.shapes.splice(childIndex, 1);
  const rawIndex = childrenOf(slide.spTree).indexOf(childShape.node);
  childrenOf(slide.spTree).splice(rawIndex, 1);
  const groupNode = el('p:grpSp', undefined, [
    el('p:nvGrpSpPr', undefined, [
      el('p:cNvPr', { id: '900', name: 'Nested shapes' }),
      el('p:cNvGrpSpPr'),
      el('p:nvPr')
    ]),
    el('p:grpSpPr', undefined, [
      el('a:xfrm', undefined, [
        el('a:off', { x: '1500000', y: '100000' }),
        el('a:ext', { cx: '1000000', cy: '1000000' }),
        el('a:chOff', { x: '0', y: '0' }),
        el('a:chExt', { cx: '500000', cy: '500000' })
      ])
    ]),
    childShape.node
  ]);
  const group = readShapeNode(groupNode)!;
  childrenOf(slide.spTree).push(groupNode);
  slide.shapes.push(group);

  const svg = renderSlideSvg(deck, slide);
  const arrowGeometry = svg.querySelector(
    `[data-shape-id="${arrow.id}"] polygon`
  )!;
  expect(arrowGeometry.getAttribute('stroke-dasharray')).toBeTruthy();
  expect(arrowGeometry.getAttribute('marker-start')).toContain('line-');
  expect(arrowGeometry.getAttribute('marker-end')).toContain('line-');
  expect(arrowGeometry.getAttribute('filter')).toContain('shadow-');
  expect(
    svg.querySelector(
      `[data-shape-id="${group.id}"] [data-shape-id="${childShape.id}"] polygon`
    )
  ).toBeTruthy();

  const json = deckToJSON(deck).slides[0].shapes;
  expect(json.find((shape) => shape.id === arrow.id)?.style).toMatchObject({
    line: { dash: 'lgDash', head: 'oval', tail: 'triangle' },
    outerShadow: { color: '#000000', opacityPct: 35 }
  });
  expect(
    json.find((shape) => shape.id === group.id)?.children?.[0]
  ).toMatchObject({ geom: 'star5' });
});

it('renders donut/cube geometry, shape transparency, and circular picture crops', () => {
  const deck = fixture();
  const slide = deck.slides[0];
  const donut = addAutoShape(
    deck,
    slide,
    'donut',
    100000,
    100000,
    800000,
    800000,
    'CADCFC'
  );
  const cube = addAutoShape(
    deck,
    slide,
    'cube',
    1000000,
    100000,
    800000,
    800000,
    'EEF3FD'
  );
  const translucent = addAutoShape(
    deck,
    slide,
    'roundRect',
    1900000,
    100000,
    800000,
    800000,
    '1E2761'
  );
  const translucentFill = child(translucent.spPr!, 'a:solidFill')!;
  childrenOf(child(translucentFill, 'a:srgbClr')!).push(
    el('a:alpha', { val: '25000' })
  );

  const picture = insertImage(
    deck,
    slide,
    PNG,
    'png',
    2800000,
    100000,
    800000,
    800000
  );
  picture.imageSrc =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  setPictureCrop(deck, slide, picture, {
    clipGeometry: 'ellipse',
    cropPct: { left: 10, top: 5, right: 20, bottom: 15 }
  });
  expect(readPictureCrop(picture)).toEqual({
    clipGeometry: 'ellipse',
    cropPct: { left: 10, top: 5, right: 20, bottom: 15 }
  });

  const svg = renderSlideSvg(deck, slide);
  const donutPath = svg.querySelector(`[data-shape-id="${donut.id}"] path`)!;
  expect(donutPath.getAttribute('d')!.match(/ A /g) || []).toHaveLength(4);
  expect(donutPath.getAttribute('fill-rule')).toBe('evenodd');
  expect(
    svg.querySelector(`[data-shape-id="${cube.id}"] path`)?.getAttribute('d')
  ).toContain('200000 0');
  expect(
    svg
      .querySelector(`[data-shape-id="${translucent.id}"] rect`)
      ?.getAttribute('fill-opacity')
  ).toBe('0.25');
  const image = svg.querySelector(`[data-shape-id="${picture.id}"] image`)!;
  expect(image.parentElement?.getAttribute('clip-path')).toContain(
    'picture-clip-'
  );
  expect(
    svg.querySelector(
      `clipPath[id$="picture-clip-${picture.id}-${slide.shapes.indexOf(
        picture
      )}"] ellipse`
    )
  ).toBeTruthy();
  expect(Number(image.getAttribute('x'))).toBeLessThan(0);

  const json = deckToJSON(deck).slides[0].shapes;
  expect(
    json.find((shape) => shape.id === translucent.id)?.style?.fill.opacityPct
  ).toBe(25);
  expect(json.find((shape) => shape.id === picture.id)?.picture).toMatchObject({
    clipGeometry: 'ellipse',
    cropPct: { left: 10, top: 5, right: 20, bottom: 15 }
  });
  const draft = JSON.parse(JSON.stringify(deckToJSON(deck).slides[0]));
  const editedPicture = draft.shapes.find(
    (shape: { id: string }) => shape.id === picture.id
  ).picture;
  editedPicture.cropPct = { left: 15, top: 10, right: 25, bottom: 20 };
  editedPicture.clipGeometry = 'rect';
  expect(applySlideJSON(deck, slide, draft).shapeIds).toContain(picture.id);
  expect(readPictureCrop(picture)).toEqual({
    clipGeometry: 'rect',
    cropPct: { left: 15, top: 10, right: 25, bottom: 20 }
  });
  const savedPicture = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (shape) => shape.id === picture.id
  )!;
  expect(readPictureCrop(savedPicture)).toEqual({
    clipGeometry: 'rect',
    cropPct: { left: 15, top: 10, right: 25, bottom: 20 }
  });
});
