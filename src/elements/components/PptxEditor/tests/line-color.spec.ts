import { setShapeLineColor } from '../core/model/edit';
import { child, childrenOf, el, getAttr, tagOf } from '../core/opc/xml';
import type { Deck, Shape, Slide } from '../core/model/types';

const stub = () => {
  const deck = { pkg: { markDirty: jest.fn() } } as unknown as Deck;
  const slide = { path: 'ppt/slides/slide1.xml' } as unknown as Slide;
  return { deck, slide };
};

const lnColor = (spPr: ReturnType<typeof el>) => {
  const ln = child(spPr, 'a:ln')!;
  const solid = child(ln, 'a:solidFill')!;
  return getAttr(child(solid, 'a:srgbClr')!, 'val');
};

it('replaces an existing template line color on the stroke (a:ln)', () => {
  const { deck, slide } = stub();
  const spPr = el('p:spPr', undefined, [
    el('a:ln', { w: '12700' }, [
      el('a:solidFill', undefined, [el('a:srgbClr', { val: '888888' })])
    ])
  ]);
  const shape = { type: 'connector', id: '1', node: spPr, spPr } as unknown as Shape;

  setShapeLineColor(deck, slide, shape, 'FF0000');

  expect(lnColor(spPr)).toBe('FF0000');
  // Old fill replaced, not stacked.
  const ln = child(spPr, 'a:ln')!;
  expect(childrenOf(ln).filter((n) => tagOf(n) === 'a:solidFill')).toHaveLength(
    1
  );
  expect(deck.pkg.markDirty).toHaveBeenCalledWith(slide.path);
});

it('adds a stroke fill to a line that has none', () => {
  const { deck, slide } = stub();
  const spPr = el('p:spPr', undefined, []);
  const shape = { type: 'connector', id: '2', node: spPr, spPr } as unknown as Shape;

  setShapeLineColor(deck, slide, shape, '00AA00');

  expect(lnColor(spPr)).toBe('00AA00');
});
