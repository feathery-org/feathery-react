import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import {
  addTextBox,
  setTextRangeStyle,
  setTextStyle
} from '../core/model/edit';
import { child, childrenOf, el, getAttr } from '../core/opc/xml';

const bytes = () =>
  new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')));

it('colors only the first word by splitting one DrawingML run and survives PPTX export', () => {
  const deck = importDeck(bytes());
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'Hello world'
  );
  setTextStyle(deck, slide, shape, { color: 'FFFFFF' });

  expect(
    setTextRangeStyle(
      deck,
      slide,
      shape,
      [{ paragraph: 0, start: 0, end: 5 }],
      { color: 'FF0000' }
    )
  ).toBe(true);
  expect(shape.text!.paragraphs[0].runs.map((r) => [r.text, r.color])).toEqual([
    ['Hello', 'FF0000'],
    [' world', 'FFFFFF']
  ]);

  const out = importDeck(exportDeckBytes(deck));
  const saved = out.slides[0].shapes.find((s) => s.id === shape.id)!;
  expect(saved.text!.paragraphs[0].runs.map((r) => [r.text, r.color])).toEqual([
    ['Hello', 'FF0000'],
    [' world', 'FFFFFF']
  ]);
});

it('preserves run XML outside and inside a selected range', () => {
  const deck = importDeck(bytes());
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'Hello world'
  );
  const run = shape.text!.paragraphs[0].runs[0];
  childrenOf(run.rPr!).push(el('a:hlinkClick', { 'r:id': 'rId90' }));
  setTextRangeStyle(deck, slide, shape, [{ paragraph: 0, start: 6, end: 11 }], {
    color: 'FF0000'
  });
  const runs = shape.text!.paragraphs[0].runs;
  expect(runs.map((r) => r.text)).toEqual(['Hello ', 'world']);
  expect(
    runs.map((r) => getAttr(child(r.rPr!, 'a:hlinkClick')!, 'r:id'))
  ).toEqual(['rId90', 'rId90']);
  expect(runs[0].color).toBeUndefined();
  expect(runs[1].color).toBe('FF0000');
});

it('keeps a symbolic theme color outside an explicitly recolored word', () => {
  const deck = importDeck(bytes());
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'Hello world'
  );
  const original = shape.text!.paragraphs[0].runs[0];
  childrenOf(original.rPr!).push(
    el('a:solidFill', undefined, [el('a:schemeClr', { val: 'tx1' })])
  );
  setTextRangeStyle(deck, slide, shape, [{ paragraph: 0, start: 0, end: 5 }], {
    color: 'FF0000'
  });
  const [first, rest] = shape.text!.paragraphs[0].runs;
  expect(
    getAttr(child(child(first.rPr!, 'a:solidFill')!, 'a:srgbClr')!, 'val')
  ).toBe('FF0000');
  expect(
    getAttr(child(child(rest.rPr!, 'a:solidFill')!, 'a:schemeClr')!, 'val')
  ).toBe('tx1');
  expect(
    child(child(first.rPr!, 'a:solidFill')!, 'a:schemeClr')
  ).toBeUndefined();
});

it('writes an explicit noStrike override when a selected run is toggled off', () => {
  const deck = importDeck(bytes());
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'Hello world'
  );
  setTextStyle(deck, slide, shape, { strike: true });
  expect(
    setTextRangeStyle(
      deck,
      slide,
      shape,
      [{ paragraph: 0, start: 0, end: 5 }],
      { strike: false }
    )
  ).toBe(true);
  const [first, rest] = shape.text!.paragraphs[0].runs;
  expect([first.text, first.strike, getAttr(first.rPr!, 'strike')]).toEqual([
    'Hello',
    false,
    'noStrike'
  ]);
  expect([rest.text, rest.strike, getAttr(rest.rPr!, 'strike')]).toEqual([
    ' world',
    true,
    'sngStrike'
  ]);

  const saved = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (s) => s.id === shape.id
  )!;
  expect(getAttr(saved.text!.paragraphs[0].runs[0].rPr!, 'strike')).toBe(
    'noStrike'
  );
});
