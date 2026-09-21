import {
  child,
  childrenOf,
  descendant,
  el,
  getAttr,
  root,
  setAttr,
  type OTree
} from '../opc/xml';
import type { Deck, Slide } from './types';

const EXT_URI = '{A728E168-4A95-49C8-86A0-7C58F3F01001}';

export const SLIDE_SIZE_PRESETS = {
  wide: { label: 'Widescreen 16:9', cx: 12192000, cy: 6858000 },
  standard: { label: 'Standard 4:3', cx: 9144000, cy: 6858000 },
  a4Landscape: { label: 'A4 landscape', cx: 10689336, cy: 7560072 },
  a4Portrait: { label: 'A4 portrait', cx: 7560072, cy: 10689336 }
} as const;

export function readEditorSlideSize(
  raw: OTree
): { cx: number; cy: number } | undefined {
  const size = descendant(root(raw), 'fe:slideSize');
  const cx = Number(size && getAttr(size, 'cx'));
  const cy = Number(size && getAttr(size, 'cy'));
  return cx > 0 && cy > 0 ? { cx, cy } : undefined;
}

export function effectiveSlideSize(
  deck: Deck,
  slide: Slide
): { cx: number; cy: number } {
  return slide.size || deck.size;
}

export function setSlideSize(
  deck: Deck,
  slide: Slide,
  cx: number,
  cy: number
): void {
  slide.size = {
    cx: Math.max(914400, Math.round(cx)),
    cy: Math.max(914400, Math.round(cy))
  };
  const sld = root(slide.raw);
  let extLst = child(sld, 'p:extLst');
  if (!extLst) {
    extLst = el('p:extLst');
    childrenOf(sld).push(extLst);
  }
  let ext = childrenOf(extLst).find((node) => getAttr(node, 'uri') === EXT_URI);
  if (!ext) {
    ext = el('p:ext', { uri: EXT_URI });
    childrenOf(extLst).push(ext);
  }
  let size = child(ext, 'fe:slideSize');
  if (!size) {
    size = el('fe:slideSize', {
      'xmlns:fe': 'https://feathery.io/pptx-editor'
    });
    childrenOf(ext).push(size);
  }
  setAttr(size, 'cx', String(slide.size.cx));
  setAttr(size, 'cy', String(slide.size.cy));
  deck.pkg.markDirty(slide.path);
}
