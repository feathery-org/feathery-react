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
import { readBulletSize, readXfrm } from './read';
import type { Deck, Slide, Shape, Bullet, Xfrm } from './types';

/** "No index" sentinel some exporters emit on <p:ph idx>; treat as unset. */
export const PH_NO_IDX = '4294967295';

/** Run defaults inherited from a placeholder list style (layout/master). */
export interface ResolvedRunDefaults {
  sizePt?: number;
  color?: string;
  colorScheme?: string; // schemeClr val when the default color is a theme color
  font?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ResolvedListProps {
  bullet?: Bullet;
  marLEmu?: number;
  indentEmu?: number;
  defRPr?: ResolvedRunDefaults;
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
  const buSize = readBulletSize(pPr);
  if (child(pPr, 'a:buNone')) out.bullet = { kind: 'none' };
  else {
    const buChar = child(pPr, 'a:buChar');
    const buAutoNum = child(pPr, 'a:buAutoNum');
    if (buChar)
      out.bullet = {
        kind: 'char',
        char: getAttr(buChar, 'char') || '•',
        font: buFont ? getAttr(buFont, 'typeface') : undefined,
        ...buSize
      };
    else if (buAutoNum)
      out.bullet = {
        kind: 'autoNum',
        scheme: getAttr(buAutoNum, 'type') || 'arabicPeriod',
        startAt: Number(getAttr(buAutoNum, 'startAt')) || undefined,
        ...buSize
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
    const scheme = solid && child(solid, 'a:schemeClr');
    out.defRPr = {
      sizePt: sz ? szToPt(Number(sz)) : undefined,
      font: latin ? getAttr(latin, 'typeface') : undefined,
      color: srgb ? getAttr(srgb, 'val') : undefined,
      colorScheme: scheme ? getAttr(scheme, 'val') : undefined,
      bold: getAttr(defRPr, 'b') === '1' || undefined,
      italic: getAttr(defRPr, 'i') === '1' || undefined
    };
  }
  return Object.keys(out).length ? out : null;
}

/** Find the part's placeholder matching this ph: idx names ONE placeholder
 *  while a type is shared by many, so an idx match wins over type. */
function findPlaceholder(
  partRoot: ONode,
  phType: string,
  phIdx: string
): ONode | undefined {
  const spTree = descendant(partRoot, 'p:spTree');
  if (!spTree) return undefined;
  const sps = [...children(spTree, 'p:sp')];
  // PH_NO_IDX matches by type instead of a bogus idx.
  if (phIdx !== '' && phIdx !== PH_NO_IDX) {
    for (const sp of sps) {
      const ph = descendant(sp, 'p:ph');
      if (ph && (getAttr(ph, 'idx') || '') === phIdx) return sp;
    }
  }
  // Fall back to type, preferring a placeholder that defines a run style so
  // style-less duplicates don't inherit the generic txStyles default.
  const typeMatches = sps.filter((sp) => {
    const ph = descendant(sp, 'p:ph');
    return !!ph && (getAttr(ph, 'type') || 'body') === phType;
  });
  const styled = typeMatches.find((sp) => {
    const lst = descendant(sp, 'a:lstStyle');
    const dr = lst && descendant(lst, 'a:defRPr');
    return (
      !!dr && (!!descendant(dr, 'a:solidFill') || !!descendant(dr, 'a:latin'))
    );
  });
  return styled || typeMatches[0];
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

// Masters only have title/body placeholders, keyed by type: titles inherit
// from the master title, every other type from the master body.
function masterPhType(type: string): string {
  return type === 'title' || type === 'ctrTitle' ? 'title' : 'body';
}

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
  // Field-level cascade: the most specific level to supply each field wins;
  // color + colorScheme move as one unit.
  const mergeIn = (r: ResolvedListProps | null) => {
    if (!r) return;
    if (merged.bullet === undefined && r.bullet) merged.bullet = r.bullet;
    if (merged.marLEmu === undefined && r.marLEmu !== undefined)
      merged.marLEmu = r.marLEmu;
    if (merged.indentEmu === undefined && r.indentEmu !== undefined)
      merged.indentEmu = r.indentEmu;
    if (r.defRPr) {
      const d = (merged.defRPr ??= {});
      const s = r.defRPr;
      if (d.sizePt === undefined && s.sizePt !== undefined) d.sizePt = s.sizePt;
      if (d.font === undefined && s.font !== undefined) d.font = s.font;
      if (
        d.color === undefined &&
        d.colorScheme === undefined &&
        (s.color !== undefined || s.colorScheme !== undefined)
      ) {
        d.color = s.color;
        d.colorScheme = s.colorScheme;
      }
      if (d.bold === undefined && s.bold !== undefined) d.bold = s.bold;
      if (d.italic === undefined && s.italic !== undefined) d.italic = s.italic;
    }
  };

  const lvlOf = (host: ONode | undefined) => {
    const lst = host && descendant(host, 'a:lstStyle');
    return readLvlPr(lst ? child(lst, lvlTag) : undefined);
  };

  // 1. layout placeholder lstStyle
  if (layoutPart && pkg.hasPart(layoutPart)) {
    mergeIn(
      lvlOf(findPlaceholder(xmlRoot(pkg.tree(layoutPart)), ph.type, ph.idx))
    );
  }
  // 2. master placeholder lstStyle (more specific), then 3. master txStyles
  // for the placeholder's type.
  if (masterPart && pkg.hasPart(masterPart)) {
    const mRoot = xmlRoot(pkg.tree(masterPart));
    mergeIn(lvlOf(findPlaceholder(mRoot, masterPhType(ph.type), '')));
    const txStyles = child(mRoot, 'p:txStyles');
    const styleEl = txStyles
      ? child(txStyles, TXSTYLE_FOR_PH[ph.type] || 'p:otherStyle')
      : undefined;
    mergeIn(readLvlPr(styleEl ? child(styleEl, lvlTag) : undefined));
  }
  return merged;
}
