// The inheritance resolver (SFDT-style cascade). PPTX stores sparse deltas; the
// rendered value is resolved live by walking the placeholder chain
// slide → layout → master. This module resolves what a paragraph inherits when
// its own pPr is silent — most importantly BULLETS and default run formatting,
// which real decks define once in the master/layout list styles, not per slide.
//
// Cascade for a placeholder paragraph at level N (most specific wins):
//   slide paragraph pPr  (already on the model)          [checked by the caller]
//   → layout placeholder lstStyle a:lvlNpPr
//   → master p:txStyles {title|body|other}Style a:lvlNpPr
//   → master placeholder lstStyle a:lvlNpPr

import {
  child,
  children,
  descendant,
  getAttr,
  root as xmlRoot,
  type ONode
} from '../opc/xml';
import { szToPt } from './units';
import { readXfrm } from './read';
import type { Deck, Slide, Shape, Bullet, Xfrm } from './types';

export interface ResolvedListProps {
  bullet?: Bullet;
  marLEmu?: number;
  indentEmu?: number;
  defRPr?: {
    sizePt?: number;
    color?: string;
    font?: string;
    bold?: boolean;
    italic?: boolean;
  };
}

function placeholderOf(shape: Shape): { type: string; idx: string } | null {
  const ph = descendant(shape.node, 'p:ph');
  if (!ph) return null;
  return { type: getAttr(ph, 'type') || 'body', idx: getAttr(ph, 'idx') || '' };
}

/** Read bullet / spacing / default run props out of an a:lvlNpPr (or a:pPr). */
function readLvlPr(pPr: ONode | undefined): ResolvedListProps | null {
  if (!pPr) return null;
  const out: ResolvedListProps = {};
  const buFont = child(pPr, 'a:buFont');
  if (child(pPr, 'a:buNone')) out.bullet = { kind: 'none' };
  else {
    const buChar = child(pPr, 'a:buChar');
    const buAutoNum = child(pPr, 'a:buAutoNum');
    if (buChar)
      out.bullet = {
        kind: 'char',
        char: getAttr(buChar, 'char') || '•',
        font: buFont ? getAttr(buFont, 'typeface') : undefined
      };
    else if (buAutoNum)
      out.bullet = {
        kind: 'autoNum',
        scheme: getAttr(buAutoNum, 'type') || 'arabicPeriod',
        startAt: Number(getAttr(buAutoNum, 'startAt')) || undefined
      };
  }
  const marL = getAttr(pPr, 'marL');
  if (marL !== undefined) out.marLEmu = Number(marL);
  const indent = getAttr(pPr, 'indent');
  if (indent !== undefined) out.indentEmu = Number(indent);
  const defRPr = child(pPr, 'a:defRPr');
  if (defRPr) {
    const sz = getAttr(defRPr, 'sz');
    const latin = child(defRPr, 'a:latin');
    const solid = child(defRPr, 'a:solidFill');
    const srgb = solid && child(solid, 'a:srgbClr');
    out.defRPr = {
      sizePt: sz ? szToPt(Number(sz)) : undefined,
      font: latin ? getAttr(latin, 'typeface') : undefined,
      color: srgb ? getAttr(srgb, 'val') : undefined,
      bold: getAttr(defRPr, 'b') === '1' || undefined,
      italic: getAttr(defRPr, 'i') === '1' || undefined
    };
  }
  return Object.keys(out).length ? out : null;
}

/** Find the placeholder shape in a part's spTree that matches this ph type/idx. */
function findPlaceholder(
  partRoot: ONode,
  phType: string,
  phIdx: string
): ONode | undefined {
  const spTree = descendant(partRoot, 'p:spTree');
  if (!spTree) return undefined;
  for (const sp of children(spTree, 'p:sp')) {
    const ph = descendant(sp, 'p:ph');
    if (!ph) continue;
    const t = getAttr(ph, 'type') || 'body';
    const i = getAttr(ph, 'idx') || '';
    if (t === phType || (phIdx !== '' && i === phIdx)) return sp;
  }
  return undefined;
}

/** Resolve a placeholder's inherited geometry from the layout, then master. */
export function resolveXfrm(
  deck: Deck,
  slide: Slide,
  shape: Shape
): Xfrm | undefined {
  const ph = placeholderOf(shape);
  if (!ph) return undefined;
  const pkg = deck.pkg;
  const layoutPart = pkg.layoutFor(slide.path);
  const masterPart = layoutPart ? pkg.masterFor(layoutPart) : undefined;
  for (const part of [layoutPart, masterPart]) {
    if (!part || !pkg.hasPart(part)) continue;
    const lp = findPlaceholder(xmlRoot(pkg.tree(part)), ph.type, ph.idx);
    const xf = lp && descendant(lp, 'a:xfrm');
    if (xf) return readXfrm(xf);
  }
  return undefined;
}

const TXSTYLE_FOR_PH: Record<string, string> = {
  title: 'p:titleStyle',
  ctrTitle: 'p:titleStyle',
  subTitle: 'p:bodyStyle',
  body: 'p:bodyStyle',
  obj: 'p:bodyStyle'
};

/** Resolve the list/bullet/default-run props a placeholder paragraph inherits at a level. */
export function resolveListProps(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  level: number
): ResolvedListProps {
  const ph = placeholderOf(shape);
  if (!ph) return {};
  const pkg = deck.pkg;
  const lvlTag = `a:lvl${level + 1}pPr`;
  const layoutPart = pkg.layoutFor(slide.path);
  const masterPart = layoutPart ? pkg.masterFor(layoutPart) : undefined;

  const merged: ResolvedListProps = {};
  const mergeIn = (r: ResolvedListProps | null) => {
    if (!r) return;
    if (merged.bullet === undefined && r.bullet) merged.bullet = r.bullet;
    if (merged.marLEmu === undefined && r.marLEmu !== undefined)
      merged.marLEmu = r.marLEmu;
    if (merged.indentEmu === undefined && r.indentEmu !== undefined)
      merged.indentEmu = r.indentEmu;
    if (!merged.defRPr && r.defRPr) merged.defRPr = r.defRPr;
  };

  // 1. layout placeholder lstStyle
  if (layoutPart && pkg.hasPart(layoutPart)) {
    const lp = findPlaceholder(xmlRoot(pkg.tree(layoutPart)), ph.type, ph.idx);
    const lst = lp && descendant(lp, 'a:lstStyle');
    mergeIn(readLvlPr(lst ? child(lst, lvlTag) : undefined));
  }
  // 2. master txStyles for the placeholder type + 3. master placeholder lstStyle
  if (masterPart && pkg.hasPart(masterPart)) {
    const mRoot = xmlRoot(pkg.tree(masterPart));
    const txStyles = child(mRoot, 'p:txStyles');
    const styleEl = txStyles
      ? child(txStyles, TXSTYLE_FOR_PH[ph.type] || 'p:otherStyle')
      : undefined;
    mergeIn(readLvlPr(styleEl ? child(styleEl, lvlTag) : undefined));
    const mp = findPlaceholder(mRoot, ph.type, ph.idx);
    const lst = mp && descendant(mp, 'a:lstStyle');
    mergeIn(readLvlPr(lst ? child(lst, lvlTag) : undefined));
  }
  return merged;
}
