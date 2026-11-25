// Edit operations. Each mutates the raw XML node(s) in place, updates the typed
// view to match, and marks the slide part dirty so export re-serializes it.

import {
  el,
  text as textNode,
  child,
  children,
  childrenOf,
  getAttr,
  setAttr,
  removeAttr,
  descendant,
  descendants,
  tagOf,
  root as xmlRoot,
  type ONode
} from '../opc/xml';
import { degToAngle, ptToSz } from './units';
import { trackObjectUrl } from '../opc/objectUrls';
import { readShapeNode, refreshShapeText } from './read';
import type { Bullet, Deck, Slide, Shape, Xfrm } from './types';
import {
  tableCell,
  tableCellText,
  tableCells,
  tableColumns,
  tableNode,
  tableRows
} from './table';
import { deepClone } from '../opc/deepClone';

const SHAPE_TAGS = new Set([
  'p:sp',
  'p:pic',
  'p:graphicFrame',
  'p:grpSp',
  'p:cxnSp'
]);

const markDirty = (deck: Deck, slide: Slide) => deck.pkg.markDirty(slide.path);

/** Largest cNvPr id used in the slide, +1. */
function nextShapeId(slide: Slide): number {
  let max = 1;
  for (const cNvPr of descendants(slide.spTree, 'p:cNvPr')) {
    const id = Number(getAttr(cNvPr, 'id'));
    if (id > max) max = id;
  }
  return max + 1;
}

function ensureChild(parent: ONode, tag: string): ONode {
  let node = child(parent, tag);
  if (!node) {
    node = el(tag);
    childrenOf(parent).push(node);
  }
  return node;
}

function xfrmNodeOf(shape: Shape): ONode | undefined {
  if (shape.type === 'table' || shape.type === 'chart')
    return child(shape.node, 'p:xfrm');
  const spPr = shape.spPr || ensureChild(shape.node, 'p:spPr');
  shape.spPr = spPr;
  return ensureChild(spPr, 'a:xfrm');
}

export function setShapeGeometry(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  geom: Partial<Xfrm>
): void {
  const cur = shape.xfrm || {
    x: 0,
    y: 0,
    cx: 0,
    cy: 0,
    rot: 0,
    flipH: false,
    flipV: false
  };
  const next: Xfrm = { ...cur, ...geom };
  const xn = xfrmNodeOf(shape);
  if (!xn) return;
  const off = ensureChild(xn, 'a:off');
  setAttr(off, 'x', String(Math.round(next.x)));
  setAttr(off, 'y', String(Math.round(next.y)));
  const ext = ensureChild(xn, 'a:ext');
  setAttr(ext, 'cx', String(Math.max(1, Math.round(next.cx))));
  setAttr(ext, 'cy', String(Math.max(1, Math.round(next.cy))));
  const rot = Math.round(degToAngle(next.rot)) % 21600000;
  if (rot) setAttr(xn, 'rot', String(rot));
  else removeAttr(xn, 'rot');
  next.flipH ? setAttr(xn, 'flipH', '1') : removeAttr(xn, 'flipH');
  next.flipV ? setAttr(xn, 'flipV', '1') : removeAttr(xn, 'flipV');
  // A table's visible geometry comes from its grid/row sizes, not only its
  // graphic-frame extent. Scale those dimensions with the resize handles.
  if (shape.type === 'table') {
    const oldCols = tableColumns(shape);
    const oldRows = tableRows(shape);
    const oldW = oldCols.reduce(
      (sum, c) => sum + (Number(getAttr(c, 'w')) || 0),
      0
    );
    const oldH = oldRows.reduce(
      (sum, r) => sum + (Number(getAttr(r, 'h')) || 0),
      0
    );
    if (geom.cx !== undefined && next.cx !== cur.cx && oldW > 0) {
      const ratio = next.cx / (cur.cx || oldW);
      oldCols.forEach((c) =>
        setAttr(
          c,
          'w',
          String(
            Math.max(1, Math.round((Number(getAttr(c, 'w')) || 0) * ratio))
          )
        )
      );
    }
    if (geom.cy !== undefined && next.cy !== cur.cy && oldH > 0) {
      const ratio = next.cy / (cur.cy || oldH);
      oldRows.forEach((r) =>
        setAttr(
          r,
          'h',
          String(
            Math.max(1, Math.round((Number(getAttr(r, 'h')) || 0) * ratio))
          )
        )
      );
    }
  }
  shape.xfrm = next;
  markDirty(deck, slide);
}

export interface PictureCrop {
  clipGeometry: 'rect' | 'ellipse';
  cropPct: { left: number; top: number; right: number; bottom: number };
}

export function readPictureCrop(shape: Shape): PictureCrop {
  const blipFill = child(shape.node, 'p:blipFill');
  const srcRect = blipFill && child(blipFill, 'a:srcRect');
  const pct = (name: string) =>
    Number(srcRect && getAttr(srcRect, name)) / 1000 || 0;
  return {
    clipGeometry: shape.geom === 'ellipse' ? 'ellipse' : 'rect',
    cropPct: {
      left: pct('l'),
      top: pct('t'),
      right: pct('r'),
      bottom: pct('b')
    }
  };
}

/** Update a picture's OOXML source crop and rectangular/ellipse clipping geometry. */
export function setPictureCrop(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  crop: PictureCrop
): void {
  if (shape.type !== 'pic') return;
  const clamp = (value: number) =>
    Math.max(0, Math.min(99, Number.isFinite(value) ? value : 0));
  let left = clamp(crop.cropPct.left);
  let right = clamp(crop.cropPct.right);
  let top = clamp(crop.cropPct.top);
  let bottom = clamp(crop.cropPct.bottom);
  if (left + right >= 99.9) {
    const scale = 99.9 / (left + right);
    left *= scale;
    right *= scale;
  }
  if (top + bottom >= 99.9) {
    const scale = 99.9 / (top + bottom);
    top *= scale;
    bottom *= scale;
  }

  const spPr = shape.spPr || ensureChild(shape.node, 'p:spPr');
  shape.spPr = spPr;
  let geometry = child(spPr, 'a:prstGeom');
  if (!geometry) {
    geometry = el('a:prstGeom', { prst: crop.clipGeometry }, [el('a:avLst')]);
    childrenOf(spPr).push(geometry);
  }
  setAttr(geometry, 'prst', crop.clipGeometry);
  shape.geom = crop.clipGeometry;

  const blipFill = ensureChild(shape.node, 'p:blipFill');
  let srcRect = child(blipFill, 'a:srcRect');
  if (!srcRect) {
    srcRect = el('a:srcRect');
    const kids = childrenOf(blipFill);
    const blipIndex = kids.findIndex((node) => tagOf(node) === 'a:blip');
    kids.splice(blipIndex < 0 ? 0 : blipIndex + 1, 0, srcRect);
  }
  const values = { l: left, t: top, r: right, b: bottom };
  for (const [name, value] of Object.entries(values))
    setAttr(srcRect, name, String(Math.round(value * 1000)));
  markDirty(deck, slide);
}

/**
 * Replace a shape's text, run-fragmentation-safe: the first run's a:rPr is kept
 * as canonical formatting; the value goes into one run per line.
 */
export function setShapeText(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  value: string
): void {
  const txBody = shape.text?.node || child(shape.node, 'p:txBody');
  if (!txBody) return;

  const firstRun = shape.text?.paragraphs.flatMap((p) => p.runs)[0];
  const rPrTemplate = firstRun?.rPr
    ? deepClone(firstRun.rPr)
    : el('a:rPr', { lang: 'en-US' });

  const kids = childrenOf(txBody);
  for (let i = kids.length - 1; i >= 0; i--) {
    if (tagOf(kids[i]) === 'a:p') kids.splice(i, 1);
  }
  for (const line of value.split('\n')) {
    const rPr = deepClone(rPrTemplate);
    kids.push(
      el('a:p', undefined, [
        el('a:r', undefined, [rPr, el('a:t', undefined, [textNode(line)])])
      ])
    );
  }
  refreshShapeText(shape);
  markDirty(deck, slide);
}

export interface RichRun {
  text: string;
  break?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sizePt?: number;
  color?: string;
  highlight?: string;
  baselinePct?: number;
  font?: string;
  source?: { paragraph: number; run: number };
  styleChanged?: boolean;
  link?: { paragraph: number; run: number } | null;
}
export interface RichPara {
  align?: 'l' | 'ctr' | 'r' | 'just';
  runs: RichRun[];
  sourceParagraph?: number;
  level?: number;
  marginLeftEMU?: number;
  indentEMU?: number;
  bulletRemoved?: boolean;
}

/** Replace a shape's text preserving per-run formatting (rich-text commit). */
export function setShapeRichText(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  paras: RichPara[]
): void {
  const txBody = shape.text?.node || child(shape.node, 'p:txBody');
  if (!txBody) return;

  // Preserve each original paragraph's a:pPr (bullet, marL/indent, level, spacing)
  // so editing a bulleted line keeps its bullet. New lines beyond the original
  // count inherit the last paragraph's pPr (PowerPoint's own continue-bullet rule).
  const origPPrs = (shape.text?.paragraphs ?? []).map((p) =>
    child(p.node, 'a:pPr')
  );
  const origEndProps = (shape.text?.paragraphs ?? []).map((p) =>
    child(p.node, 'a:endParaRPr')
  );
  const origRuns = (shape.text?.paragraphs ?? []).map((p) => p.runs);

  const kids = childrenOf(txBody);
  for (let i = kids.length - 1; i >= 0; i--)
    if (tagOf(kids[i]) === 'a:p') kids.splice(i, 1);

  paras.forEach((para, pi) => {
    const pKids: ONode[] = [];
    // clone the matching original pPr (or the last one for added lines); override algn
    const srcIndex = para.sourceParagraph ?? pi;
    const srcPPr = origPPrs.length
      ? origPPrs[Math.min(srcIndex, origPPrs.length - 1)]
      : undefined;
    const pPr = srcPPr
      ? deepClone(srcPPr)
      : para.align || para.level !== undefined || para.bulletRemoved
      ? el('a:pPr', {})
      : undefined;
    if (pPr) {
      if (para.align) setAttr(pPr, 'algn', para.align);
      if (para.level !== undefined) setAttr(pPr, 'lvl', String(para.level));
      if (para.marginLeftEMU !== undefined)
        setAttr(pPr, 'marL', String(para.marginLeftEMU));
      if (para.indentEMU !== undefined)
        setAttr(pPr, 'indent', String(para.indentEMU));
      if (para.bulletRemoved) {
        setAttr(pPr, 'lvl', '0');
        setAttr(pPr, 'marL', '0');
        setAttr(pPr, 'indent', '0');
        const pPrKids = childrenOf(pPr);
        const bulletTags = new Set([
          'a:buNone',
          'a:buChar',
          'a:buAutoNum',
          'a:buBlip'
        ]);
        const oldIndex = pPrKids.findIndex((node) =>
          bulletTags.has(tagOf(node) || '')
        );
        for (let i = pPrKids.length - 1; i >= 0; i--)
          if (bulletTags.has(tagOf(pPrKids[i]) || '')) pPrKids.splice(i, 1);
        const insertAt =
          oldIndex >= 0
            ? oldIndex
            : pPrKids.findIndex((node) =>
                ['a:tabLst', 'a:defRPr', 'a:extLst'].includes(tagOf(node) || '')
              );
        pPrKids.splice(
          insertAt < 0 ? pPrKids.length : insertAt,
          0,
          el('a:buNone')
        );
      }
      pKids.push(pPr);
    }
    const runs = para.runs.length ? para.runs : [{ text: '' }];
    for (const r of runs) {
      const source = r.source && origRuns[r.source.paragraph]?.[r.source.run];
      const linkFrom = r.link
        ? origRuns[r.link.paragraph]?.[r.link.run]?.node
        : undefined;
      if (r.break) {
        const br =
          source && tagOf(source.node) === 'a:br'
            ? deepClone(source.node)
            : el('a:br');
        if (r.link !== undefined) setRunLink(br, linkFrom);
        pKids.push(br);
        continue;
      }
      const runNode = source ? deepClone(source.node) : el('a:r');
      if (!source || r.styleChanged !== false) {
        const rPr = child(runNode, 'a:rPr') || el('a:rPr', { lang: 'en-US' });
        if (!child(runNode, 'a:rPr')) childrenOf(runNode).unshift(rPr);
        applyRunStyle(rPr, {
          bold: r.bold,
          italic: r.italic,
          underline: r.underline,
          strike: r.strike,
          sizePt: r.sizePt,
          color: r.color,
          highlight: r.highlight ?? null,
          baselinePct: r.baselinePct ?? 0,
          font: r.font
        });
      }
      if (r.link !== undefined) setRunLink(runNode, linkFrom);
      const t = child(runNode, 'a:t') || el('a:t');
      if (!child(runNode, 'a:t')) childrenOf(runNode).push(t);
      childrenOf(t).splice(0, childrenOf(t).length, textNode(r.text));
      pKids.push(runNode);
    }
    const endProps = origEndProps.length
      ? origEndProps[Math.min(srcIndex, origEndProps.length - 1)]
      : undefined;
    if (endProps) pKids.push(deepClone(endProps));
    kids.push(el('a:p', undefined, pKids));
  });
  refreshShapeText(shape);
  markDirty(deck, slide);
}

function newTextBoxNode(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  value: string
): ONode {
  return el('p:sp', undefined, [
    el('p:nvSpPr', undefined, [
      el('p:cNvPr', { id: String(id), name: `TextBox ${id}` }),
      el('p:cNvSpPr', { txBox: '1' }),
      el('p:nvPr')
    ]),
    el('p:spPr', undefined, [
      el('a:xfrm', undefined, [
        el('a:off', { x: String(Math.round(x)), y: String(Math.round(y)) }),
        el('a:ext', { cx: String(Math.round(cx)), cy: String(Math.round(cy)) })
      ]),
      el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')]),
      el('a:noFill')
    ]),
    el('p:txBody', undefined, [
      el('a:bodyPr', { wrap: 'square', rtlCol: '0' }),
      el('a:lstStyle'),
      el('a:p', undefined, [
        el('a:r', undefined, [
          el('a:rPr', { lang: 'en-US', sz: String(ptToSz(18)) }),
          el('a:t', undefined, [textNode(value)])
        ])
      ])
    ])
  ]);
}

function newAutoShapeNode(
  id: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  geom: string,
  fillHex: string
): ONode {
  return el('p:sp', undefined, [
    el('p:nvSpPr', undefined, [
      el('p:cNvPr', { id: String(id), name: `Shape ${id}` }),
      el('p:cNvSpPr'),
      el('p:nvPr')
    ]),
    el('p:spPr', undefined, [
      el('a:xfrm', undefined, [
        el('a:off', { x: String(Math.round(x)), y: String(Math.round(y)) }),
        el('a:ext', { cx: String(Math.round(cx)), cy: String(Math.round(cy)) })
      ]),
      el('a:prstGeom', { prst: geom }, [el('a:avLst')]),
      el('a:solidFill', undefined, [el('a:srgbClr', { val: fillHex })])
    ]),
    el('p:txBody', undefined, [el('a:bodyPr'), el('a:lstStyle'), el('a:p')])
  ]);
}

function appendShape(deck: Deck, slide: Slide, node: ONode): Shape {
  childrenOf(slide.spTree).push(node);
  const shape = readShapeNode(node)!;
  slide.shapes.push(shape);
  markDirty(deck, slide);
  return shape;
}

export function addTextBox(
  deck: Deck,
  slide: Slide,
  x: number,
  y: number,
  cx: number,
  cy: number,
  value = 'Text'
): Shape {
  return appendShape(
    deck,
    slide,
    newTextBoxNode(nextShapeId(slide), x, y, cx, cy, value)
  );
}

export function addAutoShape(
  deck: Deck,
  slide: Slide,
  geom: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  fillHex = '4472C4'
): Shape {
  return appendShape(
    deck,
    slide,
    newAutoShapeNode(nextShapeId(slide), x, y, cx, cy, geom, fillHex)
  );
}

/** Shapes carrying a slide-number field (a:fld type=slidenum). */
export function slideNumberShapes(slide: Slide): Shape[] {
  return slide.shapes.filter((shape) => {
    const fld = descendant(shape.node, 'a:fld');
    return !!fld && getAttr(fld, 'type') === 'slidenum';
  });
}

export function deleteShape(deck: Deck, slide: Slide, shape: Shape): void {
  const kids = childrenOf(slide.spTree);
  const idx = kids.indexOf(shape.node);
  if (idx >= 0) kids.splice(idx, 1);
  const si = slide.shapes.indexOf(shape);
  if (si >= 0) slide.shapes.splice(si, 1);
  markDirty(deck, slide);
}

// ---- text styling ----
export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string;
  sizePt?: number;
  color?: string; // hex, no '#'
  highlight?: string | null; // hex, no '#'; null removes highlighting
  baselinePct?: number; // positive = superscript, negative = subscript
}

export interface TextRange {
  paragraph: number;
  start: number;
  end: number;
}

function ensureRPr(runNode: ONode): ONode {
  let rPr = child(runNode, 'a:rPr');
  if (!rPr) {
    rPr = el('a:rPr', { lang: 'en-US' });
    childrenOf(runNode).unshift(rPr);
  }
  return rPr;
}

const LINK_TAGS = ['a:hlinkClick', 'a:hlinkMouseOver'];
const linksOf = (runNode: ONode | undefined) =>
  childrenOf(child(runNode ?? {}, 'a:rPr') ?? {}).filter((kid) =>
    LINK_TAGS.includes(tagOf(kid) || '')
  );

/** Give a run the link of another run, or no link when there is none to copy */
function setRunLink(runNode: ONode, from: ONode | undefined): void {
  const links = linksOf(from);
  if (JSON.stringify(linksOf(runNode)) === JSON.stringify(links)) return;
  const kids = childrenOf(ensureRPr(runNode));
  const kept = kids.filter((kid) => !LINK_TAGS.includes(tagOf(kid) || ''));
  const at = kept.findIndex((kid) =>
    ['a:rtl', 'a:extLst'].includes(tagOf(kid) || '')
  );
  kept.splice(at < 0 ? kept.length : at, 0, ...links.map(deepClone));
  kids.splice(0, kids.length, ...kept);
}

const CELL_LINES = [
  'a:lnL',
  'a:lnR',
  'a:lnT',
  'a:lnB',
  'a:lnTlToBr',
  'a:lnBlToTr',
  'a:cell3D'
];

/** Gives a cell one fill, after its borders as the schema orders them */
function setCellFill(pr: ONode, color: string): void {
  const kids = childrenOf(pr);
  for (let i = kids.length - 1; i >= 0; i--)
    if (FILLS.includes(tagOf(kids[i]) as string)) kids.splice(i, 1);
  const lines = kids.filter((kid) => CELL_LINES.includes(tagOf(kid) as string));
  const at = lines.length ? kids.indexOf(lines[lines.length - 1]) + 1 : 0;
  kids.splice(
    at,
    0,
    el('a:solidFill', undefined, [el('a:srgbClr', { val: color })])
  );
}

export const FILLS = [
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:blipFill',
  'a:pattFill',
  'a:grpFill'
];
// The order a:rPr children must keep, a fill being one choice
const RUN_PROPERTY_ORDER = [
  ['a:ln'],
  FILLS,
  ['a:effectLst', 'a:effectDag'],
  ['a:highlight'],
  ['a:uLnTx', 'a:uLn'],
  ['a:uFillTx', 'a:uFill'],
  ['a:latin'],
  ['a:ea'],
  ['a:cs'],
  ['a:sym'],
  ['a:hlinkClick'],
  ['a:hlinkMouseOver'],
  ['a:rtl'],
  ['a:extLst']
];
const runPropertyRank = (node: ONode) =>
  RUN_PROPERTY_ORDER.findIndex((tags) => tags.includes(tagOf(node) || ''));

/** Put a run property in its place, replacing the ones it stands for */
function putRunProperty(rPr: ONode, replaces: string[], node?: ONode): void {
  const kids = childrenOf(rPr);
  const kept = kids.filter((kid) => !replaces.includes(tagOf(kid) || ''));
  if (node) {
    const at = kept.findIndex(
      (kid) => runPropertyRank(kid) > runPropertyRank(node)
    );
    kept.splice(at < 0 ? kept.length : at, 0, node);
  }
  kids.splice(0, kids.length, ...kept);
}

function applyRunStyle(rPr: ONode, s: TextStyle): void {
  const bool = (name: string, v: boolean) => setAttr(rPr, name, v ? '1' : '0');
  if (s.bold !== undefined) bool('b', s.bold);
  if (s.italic !== undefined) bool('i', s.italic);
  if (s.underline !== undefined)
    setAttr(rPr, 'u', s.underline ? 'sng' : 'none');
  if (s.strike !== undefined)
    setAttr(rPr, 'strike', s.strike ? 'sngStrike' : 'noStrike');
  if (s.sizePt !== undefined) setAttr(rPr, 'sz', String(ptToSz(s.sizePt)));
  if (s.color !== undefined)
    putRunProperty(
      rPr,
      FILLS,
      el('a:solidFill', undefined, [
        el('a:srgbClr', { val: s.color.replace('#', '').toUpperCase() })
      ])
    );
  if (s.highlight !== undefined)
    putRunProperty(
      rPr,
      ['a:highlight'],
      s.highlight
        ? el('a:highlight', undefined, [
            el('a:srgbClr', { val: s.highlight.replace('#', '').toUpperCase() })
          ])
        : undefined
    );
  if (s.baselinePct !== undefined) {
    if (s.baselinePct)
      setAttr(rPr, 'baseline', String(Math.round(s.baselinePct * 1000)));
    else removeAttr(rPr, 'baseline');
  }
  if (s.font !== undefined) {
    const latin = child(rPr, 'a:latin');
    if (!latin) putRunProperty(rPr, [], el('a:latin', { typeface: s.font }));
    else setAttr(latin, 'typeface', s.font);
  }
}

/** Apply text styling to every run of a shape (shape-level, not per-selection). */
export function setTextStyle(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  s: TextStyle
): void {
  if (!shape.text) return;
  for (const p of shape.text.paragraphs)
    for (const r of p.runs) applyRunStyle(ensureRPr(r.node), s);
  refreshShapeText(shape);
  markDirty(deck, slide);
}

/** Update one existing run from the JSON editor without rebuilding its XML siblings. */
export function setTextRunValue(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  paragraphIndex: number,
  runIndex: number,
  value: string | undefined,
  style: TextStyle
): void {
  const run = shape.text?.paragraphs[paragraphIndex]?.runs[runIndex];
  if (!run || tagOf(run.node) !== 'a:r') return;
  if (value !== undefined) {
    const text = ensureChild(run.node, 'a:t');
    childrenOf(text).splice(0, childrenOf(text).length, textNode(value));
  }
  if (Object.keys(style).length) applyRunStyle(ensureRPr(run.node), style);
  refreshShapeText(shape);
  markDirty(deck, slide);
}

export function setParagraphAlignAt(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  paragraphIndex: number,
  align: 'l' | 'ctr' | 'r' | 'just'
): void {
  const paragraph = shape.text?.paragraphs[paragraphIndex];
  if (!paragraph) return;
  const pPr = child(paragraph.node, 'a:pPr') || el('a:pPr');
  if (!child(paragraph.node, 'a:pPr')) childrenOf(paragraph.node).unshift(pPr);
  setAttr(pPr, 'algn', align);
  refreshShapeText(shape);
  markDirty(deck, slide);
}

/** Set a solid fill, or clear the explicit fill (null) back to inherited. */
export function setShapeFillColor(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  color: string | null
): void {
  if (shape.type !== 'shape' && shape.type !== 'text') return;
  const spPr = shape.spPr || ensureChild(shape.node, 'p:spPr');
  const kids = childrenOf(spPr);
  const fillTags = new Set([
    'a:noFill',
    'a:solidFill',
    'a:gradFill',
    'a:blipFill',
    'a:pattFill',
    'a:grpFill'
  ]);
  const oldIndex = kids.findIndex((node) => fillTags.has(tagOf(node) || ''));
  for (let i = kids.length - 1; i >= 0; i--)
    if (fillTags.has(tagOf(kids[i]) || '')) kids.splice(i, 1);
  if (color === null) {
    shape.spPr = spPr;
    shape.fillColor = undefined;
    markDirty(deck, slide);
    return;
  }
  const insertAt =
    oldIndex >= 0 ? oldIndex : kids.findIndex((node) => tagOf(node) === 'a:ln');
  kids.splice(
    insertAt < 0 ? kids.length : insertAt,
    0,
    el('a:solidFill', undefined, [el('a:srgbClr', { val: color })])
  );
  shape.spPr = spPr;
  shape.fillColor = color;
  markDirty(deck, slide);
}

/** Recolor a line/connector: its color is the stroke (`a:ln`), not a fill.
 *  Template lines already carry an `a:ln`; the fill is its first child. */
export function setShapeLineColor(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  color: string
): void {
  const spPr = shape.spPr || ensureChild(shape.node, 'p:spPr');
  const ln = child(spPr, 'a:ln') || ensureChild(spPr, 'a:ln');
  const kids = childrenOf(ln);
  const fillTags = new Set([
    'a:noFill',
    'a:solidFill',
    'a:gradFill',
    'a:pattFill'
  ]);
  for (let i = kids.length - 1; i >= 0; i--)
    if (fillTags.has(tagOf(kids[i]) || '')) kids.splice(i, 1);
  // Per the schema the line fill is the first child of a:ln.
  kids.unshift(el('a:solidFill', undefined, [el('a:srgbClr', { val: color })]));
  shape.spPr = spPr;
  markDirty(deck, slide);
}

function cloneRunText(runNode: ONode, value: string): ONode {
  const copy = deepClone(runNode);
  const t = child(copy, 'a:t') || ensureChild(copy, 'a:t');
  childrenOf(t).splice(0, childrenOf(t).length, textNode(value));
  return copy;
}

/** Apply formatting only to selected character offsets, splitting DrawingML runs as needed. */
export function setTextRangeStyle(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  ranges: TextRange[],
  style: TextStyle
): boolean {
  if (!shape.text) return false;
  let changed = false;
  for (const range of ranges) {
    const paragraph = shape.text.paragraphs[range.paragraph];
    if (!paragraph || range.start >= range.end) continue;
    const kids = childrenOf(paragraph.node);
    let offset = 0;
    for (const run of paragraph.runs) {
      const start = offset;
      const end = start + run.text.length;
      offset = end;
      if (tagOf(run.node) !== 'a:r' || range.end <= start || range.start >= end)
        continue;
      const from = Math.max(0, range.start - start);
      const to = Math.min(run.text.length, range.end - start);
      const index = kids.indexOf(run.node);
      if (index < 0 || from >= to) continue;
      if (from === 0 && to === run.text.length)
        applyRunStyle(ensureRPr(run.node), style);
      else {
        const pieces: ONode[] = [];
        if (from > 0)
          pieces.push(cloneRunText(run.node, run.text.slice(0, from)));
        const selected = cloneRunText(run.node, run.text.slice(from, to));
        applyRunStyle(ensureRPr(selected), style);
        pieces.push(selected);
        if (to < run.text.length)
          pieces.push(cloneRunText(run.node, run.text.slice(to)));
        kids.splice(index, 1, ...pieces);
      }
      changed = true;
    }
  }
  if (changed) {
    refreshShapeText(shape);
    markDirty(deck, slide);
  }
  return changed;
}

export function setParagraphAlign(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  align: 'l' | 'ctr' | 'r' | 'just'
): void {
  if (!shape.text) return;
  for (const p of shape.text.paragraphs) {
    let pPr = child(p.node, 'a:pPr');
    if (!pPr) {
      pPr = el('a:pPr');
      childrenOf(p.node).unshift(pPr);
    }
    setAttr(pPr, 'algn', align);
  }
  refreshShapeText(shape);
  markDirty(deck, slide);
}

export function setParagraphBullet(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  bullet: Bullet,
  paragraphIndexes?: number[]
): void {
  if (!shape.text) return;
  const selected = paragraphIndexes ? new Set(paragraphIndexes) : null;
  shape.text.paragraphs.forEach((paragraph, index) => {
    if (selected && !selected.has(index)) return;
    const pPr = child(paragraph.node, 'a:pPr') || el('a:pPr');
    if (!child(paragraph.node, 'a:pPr'))
      childrenOf(paragraph.node).unshift(pPr);
    const kids = childrenOf(pPr);
    const bulletTags = new Set([
      'a:buNone',
      'a:buChar',
      'a:buAutoNum',
      'a:buBlip',
      'a:buFont',
      'a:buFontTx'
    ]);
    const oldIndex = kids.findIndex((node) =>
      bulletTags.has(tagOf(node) || '')
    );
    for (let i = kids.length - 1; i >= 0; i--)
      if (bulletTags.has(tagOf(kids[i]) || '')) kids.splice(i, 1);
    const additions: ONode[] = [];
    if (bullet.kind === 'none') additions.push(el('a:buNone'));
    else if (bullet.kind === 'char') {
      if (bullet.font)
        additions.push(el('a:buFont', { typeface: bullet.font }));
      additions.push(el('a:buChar', { char: bullet.char || '•' }));
    } else {
      if (bullet.font)
        additions.push(el('a:buFont', { typeface: bullet.font }));
      additions.push(
        el('a:buAutoNum', {
          type: bullet.scheme || 'arabicPeriod',
          ...(bullet.startAt ? { startAt: String(bullet.startAt) } : {})
        })
      );
    }
    const insertAt =
      oldIndex >= 0
        ? oldIndex
        : kids.findIndex((node) =>
            ['a:tabLst', 'a:defRPr', 'a:extLst'].includes(tagOf(node) || '')
          );
    kids.splice(insertAt < 0 ? kids.length : insertAt, 0, ...additions);
  });
  refreshShapeText(shape);
  markDirty(deck, slide);
}

// ---- slide background ----
export type BgFill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; color1: string; color2: string; angleDeg: number };

export function setSlideBackground(
  deck: Deck,
  slide: Slide,
  fill: BgFill
): void {
  const cSld = child(xmlRoot(slide.raw), 'p:cSld');
  if (!cSld) return;
  const kids = childrenOf(cSld);
  const existing = kids.findIndex((k) => tagOf(k) === 'p:bg');
  if (existing >= 0) kids.splice(existing, 1);
  const fillEl =
    fill.type === 'solid'
      ? el('a:solidFill', undefined, [el('a:srgbClr', { val: fill.color })])
      : el('a:gradFill', undefined, [
          el('a:gsLst', undefined, [
            el('a:gs', { pos: '0' }, [el('a:srgbClr', { val: fill.color1 })]),
            el('a:gs', { pos: '100000' }, [
              el('a:srgbClr', { val: fill.color2 })
            ])
          ]),
          el('a:lin', {
            ang: String(Math.round(fill.angleDeg * 60000)),
            scaled: '1'
          })
        ]);
  kids.unshift(
    el('p:bg', undefined, [
      el('p:bgPr', undefined, [fillEl, el('a:effectLst')])
    ])
  );
  markDirty(deck, slide);
}

const IMAGE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/** Set an image (blipFill) as the slide background: adds a media part + rel + content type. */
export function setSlideBackgroundImage(
  deck: Deck,
  slide: Slide,
  bytes: Uint8Array,
  ext: string
): void {
  const cSld = child(xmlRoot(slide.raw), 'p:cSld');
  if (!cSld) return;
  const pkg = deck.pkg;
  const e = ext.toLowerCase().replace('jpeg', 'jpg');
  const ct =
    e === 'jpg'
      ? 'image/jpeg'
      : e === 'gif'
      ? 'image/gif'
      : e === 'svg'
      ? 'image/svg+xml'
      : 'image/png';
  const mediaPath = pkg.nextMediaPath(e);
  pkg.setBinaryPart(mediaPath, bytes);
  pkg.ensureDefaultContentType(e, ct);
  const rid = pkg.addRelationship(
    slide.path,
    IMAGE_REL,
    `../media/${mediaPath.split('/').pop()}`
  );
  const kids = childrenOf(cSld);
  const existing = kids.findIndex((k) => tagOf(k) === 'p:bg');
  if (existing >= 0) kids.splice(existing, 1);
  const bg = el('p:bg', undefined, [
    el('p:bgPr', undefined, [
      el('a:blipFill', undefined, [
        el('a:blip', { 'r:embed': rid }),
        el('a:stretch', undefined, [el('a:fillRect')])
      ]),
      el('a:effectLst')
    ])
  ]);
  kids.unshift(bg);
  markDirty(deck, slide);
}

// ---- z-order ----
export function reorderShape(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  op: 'front' | 'back' | 'forward' | 'backward'
): void {
  const kids = childrenOf(slide.spTree);
  const i = kids.indexOf(shape.node);
  if (i < 0) return;
  const firstShape = kids.findIndex((k) => SHAPE_TAGS.has(tagOf(k) || ''));
  kids.splice(i, 1);
  let t: number;
  switch (op) {
    case 'front':
      t = kids.length;
      break;
    case 'back':
      t = firstShape;
      break;
    case 'forward':
      t = i + 1;
      break;
    default:
      t = i - 1;
      break;
  }
  t = Math.max(firstShape, Math.min(t, kids.length));
  kids.splice(t, 0, shape.node);
  slide.shapes.sort((a, b) => kids.indexOf(a.node) - kids.indexOf(b.node));
  markDirty(deck, slide);
}

// ---- insert image ----
export function insertImage(
  deck: Deck,
  slide: Slide,
  bytes: Uint8Array,
  ext: string,
  x: number,
  y: number,
  cx: number,
  cy: number
): Shape {
  const pkg = deck.pkg;
  const e = ext.toLowerCase().replace('jpeg', 'jpg');
  const ct =
    e === 'jpg'
      ? 'image/jpeg'
      : e === 'gif'
      ? 'image/gif'
      : e === 'svg'
      ? 'image/svg+xml'
      : 'image/png';
  const mediaPath = pkg.nextMediaPath(e);
  pkg.setBinaryPart(mediaPath, bytes);
  pkg.ensureDefaultContentType(e, ct);
  const rid = pkg.addRelationship(
    slide.path,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
    `../media/${mediaPath.split('/').pop()}`
  );
  const id = nextShapeId(slide);
  const node = el('p:pic', undefined, [
    el('p:nvPicPr', undefined, [
      el('p:cNvPr', { id: String(id), name: `Picture ${id}` }),
      el('p:cNvPicPr', undefined, [el('a:picLocks', { noChangeAspect: '1' })]),
      el('p:nvPr')
    ]),
    el('p:blipFill', undefined, [
      el('a:blip', { 'r:embed': rid }),
      el('a:stretch', undefined, [el('a:fillRect')])
    ]),
    el('p:spPr', undefined, [
      el('a:xfrm', undefined, [
        el('a:off', { x: String(Math.round(x)), y: String(Math.round(y)) }),
        el('a:ext', { cx: String(Math.round(cx)), cy: String(Math.round(cy)) })
      ]),
      el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])
    ])
  ]);
  childrenOf(slide.spTree).push(node);
  const url =
    typeof URL !== 'undefined' && URL.createObjectURL
      ? trackObjectUrl(
          deck.pkg,
          URL.createObjectURL(new Blob([bytes as BlobPart], { type: ct }))
        )
      : undefined;
  const shape = readShapeNode(node, { imageSrc: () => url })!;
  slide.shapes.push(shape);
  markDirty(deck, slide);
  return shape;
}

// ---- insert table ----
export function insertTable(
  deck: Deck,
  slide: Slide,
  rows: number,
  cols: number,
  x: number,
  y: number,
  cx: number,
  cy: number
): Shape {
  const id = nextShapeId(slide);
  const colW = Math.floor(cx / cols);
  const rowH = Math.floor(cy / rows);
  const gridCols = Array.from({ length: cols }, () =>
    el('a:gridCol', { w: String(colW) })
  );
  const trs = Array.from({ length: rows }, () =>
    el('a:tr', { h: String(rowH) }, Array.from({ length: cols }, blankCell))
  );
  const tbl = el('a:tbl', undefined, [
    el('a:tblPr', { firstRow: '1', bandRow: '1' }),
    el('a:tblGrid', undefined, gridCols),
    ...trs
  ]);
  const node = el('p:graphicFrame', undefined, [
    el('p:nvGraphicFramePr', undefined, [
      el('p:cNvPr', { id: String(id), name: `Table ${id}` }),
      el('p:cNvGraphicFramePr'),
      el('p:nvPr')
    ]),
    el('p:xfrm', undefined, [
      el('a:off', { x: String(Math.round(x)), y: String(Math.round(y)) }),
      el('a:ext', { cx: String(Math.round(cx)), cy: String(Math.round(cy)) })
    ]),
    el('a:graphic', undefined, [
      el(
        'a:graphicData',
        { uri: 'http://schemas.openxmlformats.org/drawingml/2006/table' },
        [tbl]
      )
    ])
  ]);
  childrenOf(slide.spTree).push(node);
  const shape = readShapeNode(node)!;
  slide.shapes.push(shape);
  markDirty(deck, slide);
  return shape;
}

// ---- table editing ----
function blankCell(): ONode {
  return el('a:tc', undefined, [
    el('a:txBody', undefined, [el('a:bodyPr'), el('a:lstStyle'), el('a:p')]),
    // The SVG renderer displays an unfilled cell as white. Persist that same
    // background explicitly so PowerPoint does not treat a newly inserted
    // table as transparent against the slide background.
    el('a:tcPr', undefined, [
      el('a:solidFill', undefined, [el('a:srgbClr', { val: 'FFFFFF' })])
    ])
  ]);
}

// PowerPoint tells rows and columns apart by the ids in their extensions, so a copy drops them
function withoutIds(node: ONode): ONode {
  const kids = childrenOf(node);
  for (let i = kids.length - 1; i >= 0; i--)
    if (tagOf(kids[i]) === 'a:extLst') kids.splice(i, 1);
  return node;
}

// A copied look never carries a merge
function unmerged(cell: ONode): ONode {
  for (const mark of ['gridSpan', 'rowSpan', 'hMerge', 'vMerge'])
    removeAttr(cell, mark);
  return cell;
}

function syncTableFrame(shape: Shape): void {
  const cols = tableColumns(shape);
  const rows = tableRows(shape);
  const cx = cols.reduce((sum, c) => sum + (Number(getAttr(c, 'w')) || 0), 0);
  const cy = rows.reduce((sum, r) => sum + (Number(getAttr(r, 'h')) || 0), 0);
  const xfrm = child(shape.node, 'p:xfrm');
  const ext = xfrm && ensureChild(xfrm, 'a:ext');
  if (ext) {
    setAttr(ext, 'cx', String(cx));
    setAttr(ext, 'cy', String(cy));
  }
  if (shape.xfrm) shape.xfrm = { ...shape.xfrm, cx, cy };
}

export function setTableCellText(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  row: number,
  col: number,
  value: string
): void {
  const cell = tableCell(shape, row, col);
  if (!cell) return;
  let body = child(cell, 'a:txBody');
  if (!body) {
    body = el('a:txBody', undefined, [el('a:bodyPr'), el('a:lstStyle')]);
    childrenOf(cell).unshift(body);
  }
  const oldRPr = descendant(cell, 'a:rPr') || descendant(cell, 'a:endParaRPr');
  const kids = childrenOf(body);
  const oldPPrs = children(body, 'a:p').map((p) => child(p, 'a:pPr'));
  for (let i = kids.length - 1; i >= 0; i--)
    if (tagOf(kids[i]) === 'a:p') kids.splice(i, 1);
  for (const [i, line] of value.replace(/\r/g, '').split('\n').entries()) {
    const rPr = oldRPr
      ? deepClone(oldRPr)
      : el('a:rPr', { lang: 'en-US', sz: String(ptToSz(12)) });
    // Each line keeps the paragraph look of the line it replaces, bullets included
    const pPr = oldPPrs[Math.min(i, oldPPrs.length - 1)];
    kids.push(
      el('a:p', undefined, [
        ...(pPr ? [deepClone(pPr)] : []),
        el('a:r', undefined, [rPr, el('a:t', undefined, [textNode(line)])])
      ])
    );
  }
  markDirty(deck, slide);
}

/** Plain JSON edits keep a simple cell's existing run properties and links. */
export function tableCellIsPlainEditable(
  shape: Shape,
  row: number,
  col: number
): boolean {
  const cell = tableCell(shape, row, col);
  const body = cell && child(cell, 'a:txBody');
  const paragraphs = body ? children(body, 'a:p') : [];
  if (paragraphs.length > 1) return false;
  const textNodes = paragraphs[0]
    ? childrenOf(paragraphs[0]).filter((node) =>
        ['a:r', 'a:fld', 'a:br'].includes(tagOf(node) || '')
      )
    : [];
  return (
    textNodes.length <= 1 &&
    (!textNodes.length || tagOf(textNodes[0]) === 'a:r')
  );
}

export function setTableCellPlainText(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  row: number,
  col: number,
  value: string
): void {
  const cell = tableCell(shape, row, col);
  if (!cell || !tableCellIsPlainEditable(shape, row, col)) return;
  if (value.includes('\n')) {
    setTableCellText(deck, slide, shape, row, col, value);
    return;
  }
  let body = child(cell, 'a:txBody');
  if (!body) {
    body = el('a:txBody', undefined, [el('a:bodyPr'), el('a:lstStyle')]);
    childrenOf(cell).unshift(body);
  }
  let paragraph = child(body, 'a:p');
  if (!paragraph) {
    paragraph = el('a:p');
    childrenOf(body).push(paragraph);
  }
  let run = child(paragraph, 'a:r');
  if (!run) {
    const inherited = descendant(cell, 'a:endParaRPr');
    const rPr = inherited
      ? deepClone(inherited)
      : el('a:rPr', { lang: 'en-US', sz: String(ptToSz(12)) });
    if (tagOf(rPr) === 'a:endParaRPr')
      rPr['a:rPr'] = rPr['a:endParaRPr'] as ONode['a:rPr'];
    delete rPr['a:endParaRPr'];
    run = el('a:r', undefined, [rPr]);
    const pKids = childrenOf(paragraph);
    const end = pKids.findIndex((node) => tagOf(node) === 'a:endParaRPr');
    pKids.splice(end < 0 ? pKids.length : end, 0, run);
  }
  const text = ensureChild(run, 'a:t');
  childrenOf(text).splice(0, childrenOf(text).length, textNode(value));
  markDirty(deck, slide);
}

/** Insert a row, in the look of another when asked */
export function addTableRow(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  atIndex?: number,
  like?: number
): void {
  const tbl = tableNode(shape);
  const rows = tableRows(shape);
  const cols = tableColumns(shape);
  if (!tbl) return;
  const neighbor =
    rows[Math.min(atIndex ?? rows.length - 1, rows.length - 1)] ??
    rows[rows.length - 1];
  const h = neighbor ? Number(getAttr(neighbor, 'h')) || 400000 : 400000;
  const source = like === undefined ? undefined : rows[like];
  const newRow = source
    ? withoutIds(deepClone(source))
    : el(
        'a:tr',
        { h: String(h) },
        Array.from({ length: Math.max(1, cols.length) }, blankCell)
      );
  tableCells(newRow).forEach(unmerged);
  const kids = childrenOf(tbl);
  if (atIndex !== undefined && rows[atIndex]) {
    kids.splice(kids.indexOf(rows[atIndex]), 0, newRow);
  } else {
    kids.push(newRow);
  }
  syncTableFrame(shape);
  markDirty(deck, slide);
}

/** Remove a row; `index` picks which (default: the last). */
export function removeTableRow(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  index?: number
): void {
  const tbl = tableNode(shape);
  const rows = tableRows(shape);
  if (!tbl || rows.length <= 1) return;
  const victim = rows[index ?? rows.length - 1];
  if (!victim) return;
  const kids = childrenOf(tbl);
  kids.splice(kids.indexOf(victim), 1);
  syncTableFrame(shape);
  markDirty(deck, slide);
}

/** Insert a column, in the look of another when asked */
export function addTableColumn(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  atIndex?: number,
  like?: number
): void {
  const tbl = tableNode(shape);
  const cols = tableColumns(shape);
  if (!tbl) return;
  const neighbor =
    cols[Math.min(atIndex ?? cols.length - 1, cols.length - 1)] ??
    cols[cols.length - 1];
  const w = neighbor ? Number(getAttr(neighbor, 'w')) || 800000 : 800000;
  const grid = child(tbl, 'a:tblGrid');
  if (!grid) return;
  const gridKids = childrenOf(grid);
  const source = like === undefined ? undefined : cols[like];
  const newCol = source
    ? withoutIds(deepClone(source))
    : el('a:gridCol', { w: String(w) });
  if (atIndex !== undefined && cols[atIndex]) {
    gridKids.splice(gridKids.indexOf(cols[atIndex]), 0, newCol);
  } else {
    gridKids.push(newCol);
  }
  for (const row of tableRows(shape)) {
    const cells = tableCells(row);
    const rowKids = childrenOf(row);
    const likeCell = like === undefined ? undefined : cells[like];
    const cell = likeCell ? unmerged(deepClone(likeCell)) : blankCell();
    // A row's cells come before its extensions
    const next =
      atIndex !== undefined && cells[atIndex]
        ? cells[atIndex]
        : rowKids.find((node) => tagOf(node) === 'a:extLst');
    if (next) rowKids.splice(rowKids.indexOf(next), 0, cell);
    else rowKids.push(cell);
  }
  syncTableFrame(shape);
  markDirty(deck, slide);
}

/** Remove a column; `index` picks which (default: the last). */
export function removeTableColumn(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  index?: number
): void {
  const tbl = tableNode(shape);
  const cols = tableColumns(shape);
  if (!tbl || cols.length <= 1) return;
  const grid = child(tbl, 'a:tblGrid');
  if (!grid) return;
  const victimIndex = index ?? cols.length - 1;
  const victim = cols[victimIndex];
  if (!victim) return;
  const gridKids = childrenOf(grid);
  gridKids.splice(gridKids.indexOf(victim), 1);
  for (const row of tableRows(shape)) {
    const cells = tableCells(row);
    const cell = cells[victimIndex];
    if (cell) childrenOf(row).splice(childrenOf(row).indexOf(cell), 1);
  }
  syncTableFrame(shape);
  markDirty(deck, slide);
}

export function setTableColumnWidth(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  index: number,
  width: number
): void {
  const col = tableColumns(shape)[index];
  if (!col) return;
  setAttr(col, 'w', String(Math.max(90000, Math.round(width))));
  syncTableFrame(shape);
  markDirty(deck, slide);
}

/** Spread a width over the columns: a trailing run of equal columns shares what leading columns leave, else every column scales */
export function fitTableColumns(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  width: number
): void {
  const cols = tableColumns(shape);
  if (!cols.length) return;
  const widths = cols.map((col) => Number(getAttr(col, 'w')) || 0);
  const last = widths[widths.length - 1];
  // Columns within 1% of each other count as equal, as hand-dragged ones rarely match exactly
  let run = 1;
  while (
    run < widths.length &&
    Math.abs(widths[widths.length - run - 1] - last) <= last / 100
  )
    run++;
  const lead = widths.slice(0, widths.length - run);
  const share = Math.floor((width - lead.reduce((a, b) => a + b, 0)) / run);
  const total = widths.reduce((a, b) => a + b, 0);
  const narrowest = 90000;
  const scaled = widths.map((w) => Math.floor((w * width) / (total || 1)));
  // No column goes narrower than the editor allows, the wider ones give up the difference
  const short = scaled.reduce((sum, w) => sum + Math.max(0, narrowest - w), 0);
  const roomy = scaled.filter((w) => w > narrowest).reduce((a, b) => a + b, 0);
  const fitted =
    run >= 2 && share >= narrowest
      ? [...lead, ...Array.from({ length: run }, () => share)]
      : scaled.map((w) =>
          w <= narrowest || !roomy
            ? Math.max(w, narrowest)
            : Math.floor(w - (short * w) / roomy)
        );
  fitted[fitted.length - 1] += width - fitted.reduce((a, b) => a + b, 0);
  cols.forEach((col, i) => setAttr(col, 'w', String(fitted[i])));
  syncTableFrame(shape);
  markDirty(deck, slide);
}

export function setTableRowHeight(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  index: number,
  height: number
): void {
  const row = tableRows(shape)[index];
  if (!row) return;
  setAttr(row, 'h', String(Math.max(90000, Math.round(height))));
  syncTableFrame(shape);
  markDirty(deck, slide);
}

export function snapTableRowsToContent(
  deck: Deck,
  slide: Slide,
  shape: Shape
): void {
  const cols = tableColumns(shape);
  tableRows(shape).forEach((row) => {
    let needed = 180000;
    tableCells(row).forEach((cell, i) => {
      const width = Number(cols[i] && getAttr(cols[i], 'w')) || 800000;
      const rPr = descendant(cell, 'a:rPr');
      const fontPt = Number(rPr && getAttr(rPr, 'sz')) / 100 || 12;
      const charsPerLine = Math.max(
        1,
        Math.floor((width - 180000) / (fontPt * 6350))
      );
      const lines = tableCellText(cell)
        .split('\n')
        .reduce(
          (n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)),
          0
        );
      needed = Math.max(
        needed,
        Math.ceil(lines * fontPt * 1.28 * 12700 + 120000)
      );
    });
    setAttr(row, 'h', String(needed));
  });
  syncTableFrame(shape);
  markDirty(deck, slide);
}

export function snapTableColumnToContent(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  index: number
): void {
  const cells = tableRows(shape)
    .map((_, row) => tableCell(shape, row, index))
    .filter(Boolean) as ONode[];
  if (!cells.length) return;
  let needed = 180000;
  for (const cell of cells) {
    const rPr = descendant(cell, 'a:rPr');
    const fontPt = Number(rPr && getAttr(rPr, 'sz')) / 100 || 12;
    const longest = Math.max(
      1,
      ...tableCellText(cell)
        .split('\n')
        .map((line) => [...line].length)
    );
    needed = Math.max(needed, Math.ceil(longest * fontPt * 7000 + 180000));
  }
  setTableColumnWidth(deck, slide, shape, index, needed);
}

export function snapTableRowToContent(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  index: number
): void {
  const row = tableRows(shape)[index];
  if (!row) return;
  const cols = tableColumns(shape);
  let needed = 180000;
  tableCells(row).forEach((cell, i) => {
    const width = Number(cols[i] && getAttr(cols[i], 'w')) || 800000;
    const rPr = descendant(cell, 'a:rPr');
    const fontPt = Number(rPr && getAttr(rPr, 'sz')) / 100 || 12;
    const charsPerLine = Math.max(
      1,
      Math.floor((width - 180000) / (fontPt * 6350))
    );
    const lines = tableCellText(cell)
      .split('\n')
      .reduce(
        (count, line) =>
          count + Math.max(1, Math.ceil(line.length / charsPerLine)),
        0
      );
    needed = Math.max(
      needed,
      Math.ceil(lines * fontPt * 1.28 * 12700 + 120000)
    );
  });
  setTableRowHeight(deck, slide, shape, index, needed);
}

export interface TableCellRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}
export type TableBorderTarget =
  | 'all'
  | 'outside'
  | 'inside'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'none';

function normalizedTableRange(
  shape: Shape,
  range: TableCellRange
): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
  const rowCount = tableRows(shape).length;
  const colCount = tableColumns(shape).length;
  if (!rowCount || !colCount) return null;
  return {
    minRow: Math.max(0, Math.min(range.startRow, range.endRow)),
    maxRow: Math.min(rowCount - 1, Math.max(range.startRow, range.endRow)),
    minCol: Math.max(0, Math.min(range.startCol, range.endCol)),
    maxCol: Math.min(colCount - 1, Math.max(range.startCol, range.endCol))
  };
}

/** Merge a rectangular selection, retaining all selected text in the anchor cell. */
export function mergeTableCells(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  range: TableCellRange
): boolean {
  const bounds = normalizedTableRange(shape, range);
  if (
    !bounds ||
    (bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol)
  )
    return false;
  const cells: ONode[] = [];
  for (let row = bounds.minRow; row <= bounds.maxRow; row++)
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      const cell = tableCell(shape, row, col);
      if (
        !cell ||
        getAttr(cell, 'gridSpan') ||
        getAttr(cell, 'rowSpan') ||
        getAttr(cell, 'hMerge') ||
        getAttr(cell, 'vMerge')
      )
        return false;
      cells.push(cell);
    }
  const anchor = tableCell(shape, bounds.minRow, bounds.minCol)!;
  const text = cells
    .map(tableCellText)
    .filter((value) => value.length)
    .join('\n');
  const width = bounds.maxCol - bounds.minCol + 1;
  const height = bounds.maxRow - bounds.minRow + 1;
  if (width > 1) setAttr(anchor, 'gridSpan', String(width));
  if (height > 1) setAttr(anchor, 'rowSpan', String(height));
  removeAttr(anchor, 'hMerge');
  removeAttr(anchor, 'vMerge');
  for (let row = bounds.minRow; row <= bounds.maxRow; row++)
    for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
      if (row === bounds.minRow && col === bounds.minCol) continue;
      const cell = tableCell(shape, row, col)!;
      removeAttr(cell, 'gridSpan');
      removeAttr(cell, 'rowSpan');
      col > bounds.minCol
        ? setAttr(cell, 'hMerge', '1')
        : removeAttr(cell, 'hMerge');
      row > bounds.minRow
        ? setAttr(cell, 'vMerge', '1')
        : removeAttr(cell, 'vMerge');
      setTableCellText(deck, slide, shape, row, col, '');
    }
  setTableCellText(deck, slide, shape, bounds.minRow, bounds.minCol, text);
  markDirty(deck, slide);
  return true;
}

/** Unmerge every merged anchor intersecting the selection. */
export function unmergeTableCells(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  range: TableCellRange
): boolean {
  const bounds = normalizedTableRange(shape, range);
  if (!bounds) return false;
  const anchors: Array<{
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
  }> = [];
  for (let row = 0; row < tableRows(shape).length; row++)
    for (let col = 0; col < tableColumns(shape).length; col++) {
      const cell = tableCell(shape, row, col);
      if (!cell || getAttr(cell, 'hMerge') || getAttr(cell, 'vMerge')) continue;
      const rowSpan = Math.max(1, Number(getAttr(cell, 'rowSpan')) || 1);
      const colSpan = Math.max(1, Number(getAttr(cell, 'gridSpan')) || 1);
      if (rowSpan === 1 && colSpan === 1) continue;
      const intersects =
        row <= bounds.maxRow &&
        row + rowSpan - 1 >= bounds.minRow &&
        col <= bounds.maxCol &&
        col + colSpan - 1 >= bounds.minCol;
      if (intersects) anchors.push({ row, col, rowSpan, colSpan });
    }
  if (!anchors.length) return false;
  for (const anchor of anchors)
    for (let row = anchor.row; row < anchor.row + anchor.rowSpan; row++)
      for (let col = anchor.col; col < anchor.col + anchor.colSpan; col++) {
        const cell = tableCell(shape, row, col);
        if (!cell) continue;
        removeAttr(cell, 'gridSpan');
        removeAttr(cell, 'rowSpan');
        removeAttr(cell, 'hMerge');
        removeAttr(cell, 'vMerge');
      }
  markDirty(deck, slide);
  return true;
}

function selectedTableCells(
  shape: Shape,
  range?: TableCellRange
): {
  cell: ONode;
  row: number;
  col: number;
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}[] {
  const rows = tableRows(shape);
  const cols = tableColumns(shape);
  const minRow = Math.max(
    0,
    Math.min(range?.startRow ?? 0, range?.endRow ?? rows.length - 1)
  );
  const maxRow = Math.min(
    rows.length - 1,
    Math.max(range?.startRow ?? 0, range?.endRow ?? rows.length - 1)
  );
  const minCol = Math.max(
    0,
    Math.min(range?.startCol ?? 0, range?.endCol ?? cols.length - 1)
  );
  const maxCol = Math.min(
    cols.length - 1,
    Math.max(range?.startCol ?? 0, range?.endCol ?? cols.length - 1)
  );
  const result = [];
  for (let row = minRow; row <= maxRow; row++)
    for (let col = minCol; col <= maxCol; col++) {
      const cell = tableCell(shape, row, col);
      if (cell) result.push({ cell, row, col, minRow, maxRow, minCol, maxCol });
    }
  return result;
}

export function setTableCellRangeStyle(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  range: TableCellRange | undefined,
  style: TextStyle & { fill?: string }
): void {
  const normalizedStyle = {
    ...style,
    fill: style.fill?.toUpperCase(),
    color: style.color?.toUpperCase()
  };
  for (const { cell } of selectedTableCells(shape, range)) {
    if (normalizedStyle.fill) {
      let pr = child(cell, 'a:tcPr');
      if (!pr) {
        pr = el('a:tcPr');
        childrenOf(cell).push(pr);
      }
      setCellFill(pr, normalizedStyle.fill);
    }
    const textStyle: TextStyle = { ...normalizedStyle };
    delete (textStyle as TextStyle & { fill?: string }).fill;
    if (Object.keys(textStyle).length) {
      const properties = descendants(cell, 'a:rPr');
      if (properties.length)
        for (const rPr of properties) applyRunStyle(rPr, textStyle);
      else {
        const body = child(cell, 'a:txBody') || ensureChild(cell, 'a:txBody');
        const paragraph = child(body, 'a:p') || ensureChild(body, 'a:p');
        applyRunStyle(ensureChild(paragraph, 'a:endParaRPr'), textStyle);
      }
    }
  }
  markDirty(deck, slide);
}

export function setTableCellRangeAlign(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  range: TableCellRange | undefined,
  align?: 'l' | 'ctr' | 'r' | 'just',
  vertical?: 't' | 'ctr' | 'b'
): void {
  for (const { cell } of selectedTableCells(shape, range)) {
    let body = child(cell, 'a:txBody');
    if (!body) {
      body = el('a:txBody', undefined, [
        el('a:bodyPr'),
        el('a:lstStyle'),
        el('a:p')
      ]);
      childrenOf(cell).unshift(body);
    }
    if (vertical) setAttr(ensureChild(cell, 'a:tcPr'), 'anchor', vertical);
    if (align) {
      const paragraphs = children(body, 'a:p');
      if (!paragraphs.length) paragraphs.push(ensureChild(body, 'a:p'));
      for (const paragraph of paragraphs)
        setAttr(ensureChild(paragraph, 'a:pPr'), 'algn', align);
    }
  }
  markDirty(deck, slide);
}

export function setTableCellRangeBorders(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  range: TableCellRange | undefined,
  target: TableBorderTarget,
  color: string,
  widthPt: number,
  dash: 'solid' | 'dash' | 'dot'
): void {
  const dashValue = dash === 'dot' ? 'sysDot' : dash;
  // a:tcPr is a schema sequence: the ln* borders must precede the fill and
  // everything else, in lnL/lnT/lnR/lnB order - PowerPoint drops appended-at-
  // the-end borders as invalid.
  const LN_ORDER = ['a:lnL', 'a:lnT', 'a:lnR', 'a:lnB'];
  const insertLn = (pr: ONode, node: ONode, tag: string) => {
    const kids = childrenOf(pr);
    const myOrder = LN_ORDER.indexOf(tag);
    let at = 0;
    for (let i = 0; i < kids.length; i++) {
      const order = LN_ORDER.indexOf(tagOf(kids[i]) || '');
      if (order !== -1 && order < myOrder) at = i + 1;
    }
    kids.splice(at, 0, node);
  };
  for (const item of selectedTableCells(shape, range)) {
    let pr = child(item.cell, 'a:tcPr');
    if (!pr) {
      pr = el('a:tcPr');
      childrenOf(item.cell).push(pr);
    }
    const edges: Array<{ tag: string; applies: boolean }> = [
      {
        tag: 'a:lnL',
        applies:
          target === 'all' ||
          target === 'left' ||
          (target === 'outside' && item.col === item.minCol) ||
          (target === 'inside' && item.col > item.minCol)
      },
      {
        tag: 'a:lnT',
        applies:
          target === 'all' ||
          target === 'top' ||
          (target === 'outside' && item.row === item.minRow) ||
          (target === 'inside' && item.row > item.minRow)
      },
      {
        tag: 'a:lnR',
        applies:
          target === 'all' ||
          target === 'right' ||
          (target === 'outside' && item.col === item.maxCol) ||
          (target === 'inside' && item.col < item.maxCol)
      },
      {
        tag: 'a:lnB',
        applies:
          target === 'all' ||
          target === 'bottom' ||
          (target === 'outside' && item.row === item.maxRow) ||
          (target === 'inside' && item.row < item.maxRow)
      }
    ];
    for (const edge of edges) {
      if (!edge.applies && target !== 'none') continue;
      const old = child(pr, edge.tag);
      if (old) childrenOf(pr).splice(childrenOf(pr).indexOf(old), 1);
      insertLn(
        pr,
        target === 'none'
          ? el(edge.tag, { w: String(Math.round(widthPt * 12700)) }, [
              el('a:noFill')
            ])
          : el(edge.tag, { w: String(Math.round(widthPt * 12700)) }, [
              el('a:solidFill', undefined, [
                el('a:srgbClr', { val: color.toUpperCase() })
              ]),
              el('a:prstDash', { val: dashValue })
            ]),
        edge.tag
      );
    }
  }
  markDirty(deck, slide);
}

export function setTableStyle(
  deck: Deck,
  slide: Slide,
  shape: Shape,
  fill?: string,
  border?: string
): void {
  for (const row of tableRows(shape))
    for (const cell of tableCells(row)) {
      let pr = child(cell, 'a:tcPr');
      if (!pr) {
        pr = el('a:tcPr');
        childrenOf(cell).push(pr);
      }
      if (fill) {
        setCellFill(pr, fill);
      }
      if (border)
        for (const edge of ['a:lnL', 'a:lnT', 'a:lnR', 'a:lnB']) {
          const old = child(pr, edge);
          if (old) childrenOf(pr).splice(childrenOf(pr).indexOf(old), 1);
          childrenOf(pr).push(
            el(edge, { w: '12700' }, [
              el('a:solidFill', undefined, [el('a:srgbClr', { val: border })]),
              el('a:prstDash', { val: 'solid' })
            ])
          );
        }
    }
  markDirty(deck, slide);
}

// ---- insert slide number ----
export function insertSlideNumber(
  deck: Deck,
  slide: Slide,
  displayNumber: number
): Shape {
  const id = nextShapeId(slide);
  const cx = 900000;
  const cy = 400000;
  const size = deck.size;
  const x = size.cx - cx - 300000;
  const y = size.cy - cy - 200000;
  const node = el('p:sp', undefined, [
    el('p:nvSpPr', undefined, [
      el('p:cNvPr', { id: String(id), name: `Slide Number ${id}` }),
      el('p:cNvSpPr'),
      el('p:nvPr', undefined, [el('p:ph', { type: 'sldNum', sz: 'quarter' })])
    ]),
    el('p:spPr', undefined, [
      el('a:xfrm', undefined, [
        el('a:off', { x: String(x), y: String(y) }),
        el('a:ext', { cx: String(cx), cy: String(cy) })
      ]),
      el('a:prstGeom', { prst: 'rect' }, [el('a:avLst')])
    ]),
    el('p:txBody', undefined, [
      el('a:bodyPr'),
      el('a:lstStyle'),
      el('a:p', undefined, [
        el('a:pPr', { algn: 'r' }),
        el(
          'a:fld',
          { id: '{5F2E0F1A-4C9B-4A3E-9C11-000000000001}', type: 'slidenum' },
          [
            el('a:rPr', { lang: 'en-US' }),
            el('a:t', undefined, [textNode(String(displayNumber))])
          ]
        )
      ])
    ])
  ]);
  childrenOf(slide.spTree).push(node);
  const shape = readShapeNode(node)!;
  slide.shapes.push(shape);
  markDirty(deck, slide);
  return shape;
}
