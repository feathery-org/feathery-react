/* eslint-disable no-restricted-globals -- jsdom test */
import { importDeck } from '../core/model/import';
import { renderSlideSvg } from '../core/render/svg';
import { child, childrenOf, el, root, setAttr } from '../core/opc/xml';
import type { Deck, Slide } from '../core/model/types';
import { sampleBytes } from './harness';

const MASTER = 'ppt/slideMasters/slideMaster1.xml';
const IMAGE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (value) => value.charCodeAt(0)
);

const xfrm = (cx: number, cy: number, children: ReturnType<typeof el>[] = []) =>
  el('a:xfrm', undefined, [
    el('a:off', { x: '0', y: '0' }),
    el('a:ext', { cx: String(cx), cy: String(cy) }),
    ...children
  ]);

function masterSpTree(deck: Deck) {
  return child(child(root(deck.pkg.tree(MASTER)), 'p:cSld')!, 'p:spTree')!;
}

/** A plain (non-placeholder) rectangle: inherited decoration on every slide. */
function addMasterRect(deck: Deck): void {
  childrenOf(masterSpTree(deck)).push(
    el('p:sp', undefined, [
      el('p:nvSpPr', undefined, [
        el('p:cNvPr', { id: '900', name: 'Decoration' }),
        el('p:cNvSpPr'),
        el('p:nvPr')
      ]),
      el('p:spPr', undefined, [
        xfrm(914400, 914400),
        el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')]),
        el('a:solidFill', undefined, [el('a:srgbClr', { val: 'FF0000' })])
      ])
    ])
  );
}

const masterChrome = (deck: Deck, slide: Slide) =>
  renderSlideSvg(deck, slide).querySelectorAll(
    '[data-slide-chrome] [data-shape-id^="chrome-m-"]'
  ).length;

it('keeps per-slide master visibility out of the shared layout decoration cache', () => {
  // Slides 1 and 2 share slideLayout1; only slide 2 hides the master shapes.
  const deck = importDeck(sampleBytes());
  addMasterRect(deck);
  const [visible, hidden] = deck.slides;
  setAttr(root(hidden.raw), 'showMasterSp', '0');
  expect(masterChrome(deck, visible)).toBe(1);
  expect(masterChrome(deck, hidden)).toBe(0);

  // Same deck rendered in the opposite order must not suppress the visible one.
  const reversed = importDeck(sampleBytes());
  addMasterRect(reversed);
  setAttr(root(reversed.slides[1].raw), 'showMasterSp', '0');
  expect(masterChrome(reversed, reversed.slides[1])).toBe(0);
  expect(masterChrome(reversed, reversed.slides[0])).toBe(1);
});

it('resolves a picture inside an inherited master group against the master part', () => {
  const deck = importDeck(sampleBytes());
  const pkg = deck.pkg;
  const media = pkg.nextMediaPath('png');
  pkg.setBinaryPart(media, PNG);
  pkg.ensureDefaultContentType('png', 'image/png');
  const rid = pkg.addRelationship(
    MASTER,
    IMAGE_REL,
    `../media/${media.split('/').pop()}`
  );
  // The slide must not be able to resolve the master's relationship id.
  expect(pkg.relTarget(deck.slides[0].path, rid)).toBeUndefined();
  childrenOf(masterSpTree(deck)).push(
    el('p:grpSp', undefined, [
      el('p:nvGrpSpPr', undefined, [
        el('p:cNvPr', { id: '901', name: 'Logo group' }),
        el('p:cNvGrpSpPr'),
        el('p:nvPr')
      ]),
      el('p:grpSpPr', undefined, [
        xfrm(914400, 914400, [
          el('a:chOff', { x: '0', y: '0' }),
          el('a:chExt', { cx: '914400', cy: '914400' })
        ])
      ]),
      el('p:pic', undefined, [
        el('p:nvPicPr', undefined, [
          el('p:cNvPr', { id: '902', name: 'Logo' }),
          el('p:cNvPicPr'),
          el('p:nvPr')
        ]),
        el('p:blipFill', undefined, [
          el('a:blip', { 'r:embed': rid }),
          el('a:stretch', undefined, [el('a:fillRect')])
        ]),
        el('p:spPr', undefined, [
          xfrm(914400, 914400),
          el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])
        ])
      ])
    ])
  );
  const previous = URL.createObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:master-logo');
  try {
    const image = renderSlideSvg(deck, deck.slides[0]).querySelector(
      '[data-slide-chrome] image'
    );
    expect(image).not.toBeNull();
    expect(
      image!.getAttribute('href') ?? image!.getAttribute('xlink:href')
    ).toBe('blob:master-logo');
  } finally {
    URL.createObjectURL = previous;
  }
});
