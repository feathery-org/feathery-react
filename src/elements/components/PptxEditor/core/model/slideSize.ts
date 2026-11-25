import {
  child,
  childrenOf,
  el,
  getAttr,
  removeAttr,
  root,
  setAttr
} from '../opc/xml';
import type { Deck } from './types';

const PRESENTATION_PART = 'ppt/presentation.xml';

export const SLIDE_SIZE_PRESETS = {
  wide: { label: 'Widescreen 16:9', cx: 12192000, cy: 6858000 },
  standard: { label: 'Standard 4:3', cx: 9144000, cy: 6858000 },
  a4Landscape: { label: 'A4 landscape', cx: 10689336, cy: 7560072 },
  a4Portrait: { label: 'A4 portrait', cx: 7560072, cy: 10689336 }
} as const;

export function presentationSizeType(deck: Deck): string | undefined {
  const size = child(root(deck.pkg.tree(PRESENTATION_PART)), 'p:sldSz');
  return size ? getAttr(size, 'type') : undefined;
}

/** Resize every slide: PPTX has one presentation-wide size (p:sldSz). */
export function setPresentationSize(
  deck: Deck,
  cx: number,
  cy: number,
  type?: string
): void {
  const size = {
    cx: Math.max(914400, Math.round(cx)),
    cy: Math.max(914400, Math.round(cy))
  };
  const pres = root(deck.pkg.tree(PRESENTATION_PART));
  let sldSz = child(pres, 'p:sldSz');
  if (!sldSz) {
    sldSz = el('p:sldSz');
    const siblings = childrenOf(pres);
    const notesSz = child(pres, 'p:notesSz');
    const at = notesSz ? siblings.indexOf(notesSz) : -1;
    if (at >= 0) siblings.splice(at, 0, sldSz);
    else siblings.push(sldSz);
  }
  setAttr(sldSz, 'cx', String(size.cx));
  setAttr(sldSz, 'cy', String(size.cy));
  // User resizing clears the old preset; history can restore its exact value.
  if (type !== undefined) setAttr(sldSz, 'type', type);
  else if (getAttr(sldSz, 'type') !== undefined) removeAttr(sldSz, 'type');
  deck.pkg.markDirty(PRESENTATION_PART);
  deck.size = size;
}
