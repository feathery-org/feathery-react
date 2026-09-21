// Faithful SVG renderer. The SVG viewBox IS the slide's EMU box, so shapes are
// placed in EMU directly — positions translate as-is, rotation is about-center,
// and real preset geometry / fills / text render as SVG primitives.
//
// The SVG tree is also the live editing surface (SvgSlide.tsx).

import {
  child,
  children,
  childrenOf,
  getAttr,
  descendant,
  tagOf,
  root as xmlRoot,
  type ONode
} from '../opc/xml';
import { OPCPackage } from '../opc/package';
import { trackObjectUrl } from '../opc/objectUrls';
import { featheryDoc } from '../../../../../utils/browser';
import { themeFonts, resolveFont, type ThemeFonts } from '../model/theme';
import { resolveListProps } from '../model/resolve';
import {
  tableCellAlign,
  tableCellBorderEdge,
  tableCellFill,
  tableCellFontSize,
  tableCellGridSpan,
  tableCellIsMergeContinuation,
  tableCellRowSpan,
  tableCellText,
  tableCellVerticalAlign,
  tableCells,
  tableColumns,
  tableRows
} from '../model/table';
import type { Deck, Slide, Shape, Run } from '../model/types';
import {
  readBodyProps,
  readParagraphProps,
  type Spacing
} from '../model/textLayout';
import {
  readChartData,
  type ChartData,
  type ChartSeries,
  type ChartTextStyle
} from '../model/chart';
import { effectiveSlideSize } from '../model/slideSize';
import { readShapeNode } from '../model/read';

let svgThemeFonts: ThemeFonts = { major: 'Helvetica', minor: 'Helvetica' };
// deck/slide context for inheritance resolution during a render pass. Rendering
// is fully synchronous, so setting this at every public entry point keeps
// concurrent editor instances from reading each other's context.
let curDeck: Deck | null = null;
let curSlide: Slide | null = null;

function setRenderContext(deck: Deck, slide: Slide): void {
  svgThemeFonts = themeFonts(deck, slide.path);
  curDeck = deck;
  curSlide = slide;
}

function clearRenderContext(): void {
  curDeck = null;
  curSlide = null;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const XHTML = 'http://www.w3.org/1999/xhtml';

// ---- theme colors (cached per package) ----
const themeCache = new WeakMap<OPCPackage, Record<string, string>>();
function themeColors(pkg: OPCPackage): Record<string, string> {
  let map = themeCache.get(pkg);
  if (map) return map;
  map = {
    tx1: '000000',
    bg1: 'FFFFFF',
    tx2: '44546A',
    bg2: 'E7E6E6',
    accent1: '4472C4',
    accent2: 'ED7D31',
    accent3: 'A5A5A5',
    accent4: 'FFC000',
    accent5: '5B9BD5',
    accent6: '70AD47',
    hlink: '0563C1',
    folHlink: '954F72'
  };
  try {
    if (!pkg.hasPart('ppt/theme/theme1.xml')) {
      themeCache.set(pkg, map);
      return map;
    }
    const root = pkg
      .tree('ppt/theme/theme1.xml')
      .find((n) => Object.keys(n).some((k) => k.endsWith('theme')));
    const scheme = root && descendant(root, 'a:clrScheme');
    if (scheme) {
      const pick = (tag: string, key: string) => {
        const n = child(scheme, tag);
        if (!n) return;
        const srgb = child(n, 'a:srgbClr');
        const sys = child(n, 'a:sysClr');
        // sysClr @val is a system-color NAME (e.g. "window"); the resolved hex is @lastClr
        const val = srgb
          ? getAttr(srgb, 'val')
          : sys
          ? getAttr(sys, 'lastClr') || getAttr(sys, 'val')
          : undefined;
        if (val) map![key] = val.toUpperCase();
      };
      pick('a:dk1', 'tx1');
      pick('a:lt1', 'bg1');
      pick('a:dk2', 'tx2');
      pick('a:lt2', 'bg2');
      pick('a:accent1', 'accent1');
      pick('a:accent2', 'accent2');
      pick('a:accent3', 'accent3');
      pick('a:accent4', 'accent4');
      pick('a:accent5', 'accent5');
      pick('a:accent6', 'accent6');
    }
  } catch {
    /* keep defaults */
  }
  themeCache.set(pkg, map);
  return map;
}

const SCHEME_ALIAS: Record<string, string> = {
  tx1: 'tx1',
  dk1: 'tx1',
  bg1: 'bg1',
  lt1: 'bg1',
  tx2: 'tx2',
  dk2: 'tx2',
  bg2: 'bg2',
  lt2: 'bg2',
  phClr: 'accent1'
};

/** Resolve an a:solidFill / color container to a hex string, applying lumMod/lumOff/shade/tint.
 *  phClr (a theme placeholder color) is substituted when a schemeClr val="phClr" is hit. */
function resolveColor(
  colorParent: ONode | undefined,
  pkg: OPCPackage,
  phClr?: string
): string | undefined {
  if (!colorParent) return undefined;
  const srgb = child(colorParent, 'a:srgbClr');
  const scheme = child(colorParent, 'a:schemeClr');
  const sys = child(colorParent, 'a:sysClr');
  let hex: string | undefined;
  let node: ONode | undefined;
  if (srgb) {
    hex = getAttr(srgb, 'val');
    node = srgb;
  } else if (scheme) {
    const name = getAttr(scheme, 'val') || 'tx1';
    hex =
      name === 'phClr' && phClr
        ? phClr.replace('#', '')
        : themeColors(pkg)[SCHEME_ALIAS[name] || name];
    node = scheme;
  } else if (sys) {
    hex = getAttr(sys, 'lastClr') || getAttr(sys, 'val');
    node = sys;
  }
  if (!hex) return undefined;
  hex = hex.replace('#', '');
  // luminance modulation
  const mod = node && child(node, 'a:lumMod');
  const off = node && child(node, 'a:lumOff');
  const shade = node && child(node, 'a:shade');
  const tint = node && child(node, 'a:tint');
  const pct = (n: ONode | undefined) =>
    n ? Number(getAttr(n, 'val')) / 100000 : undefined;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16));
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const lm = pct(mod);
  const lo = pct(off);
  const sh = pct(shade);
  const tn = pct(tint);
  if (lm !== undefined) {
    r *= lm;
    g *= lm;
    b *= lm;
  }
  if (lo !== undefined) {
    r += 255 * lo;
    g += 255 * lo;
    b += 255 * lo;
  }
  if (sh !== undefined) {
    r *= sh;
    g *= sh;
    b *= sh;
  }
  if (tn !== undefined) {
    r = r * tn + 255 * (1 - tn);
    g = g * tn + 255 * (1 - tn);
    b = b * tn + 255 * (1 - tn);
  }
  return (
    '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
  );
}

// ---- geometry ----
function geometryEl(
  shape: Shape,
  w: number,
  h: number,
  fill: string,
  stroke: string | undefined,
  strokeW: number
): SVGElement {
  const prst = shape.geom || 'rect';
  const mk = (tag: string) => featheryDoc().createElementNS(SVGNS, tag);
  const setStroke = (e: SVGElement) => {
    e.setAttribute('fill', fill);
    if (stroke) {
      e.setAttribute('stroke', stroke);
      e.setAttribute('stroke-width', String(strokeW));
    }
  };
  let e: SVGElement;
  switch (prst) {
    case 'ellipse':
    case 'circle': {
      e = mk('ellipse');
      e.setAttribute('cx', String(w / 2));
      e.setAttribute('cy', String(h / 2));
      e.setAttribute('rx', String(w / 2));
      e.setAttribute('ry', String(h / 2));
      break;
    }
    case 'roundRect': {
      e = mk('rect');
      e.setAttribute('width', String(w));
      e.setAttribute('height', String(h));
      e.setAttribute('rx', String(Math.min(w, h) * 0.1667));
      break;
    }
    case 'triangle': {
      e = mk('polygon');
      e.setAttribute('points', `${w / 2},0 ${w},${h} 0,${h}`);
      break;
    }
    case 'diamond': {
      e = mk('polygon');
      e.setAttribute(
        'points',
        `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`
      );
      break;
    }
    case 'rightArrow': {
      e = mk('polygon');
      e.setAttribute(
        'points',
        `0,${h * 0.25} ${w * 0.62},${h * 0.25} ${w * 0.62},0 ${w},${h / 2} ${
          w * 0.62
        },${h} ${w * 0.62},${h * 0.75} 0,${h * 0.75}`
      );
      break;
    }
    case 'chevron': {
      e = mk('polygon');
      e.setAttribute(
        'points',
        `0,0 ${w * 0.62},0 ${w},${h / 2} ${w * 0.62},${h} 0,${h} ${w * 0.38},${
          h / 2
        }`
      );
      break;
    }
    case 'pentagon':
    case 'hexagon':
    case 'star5': {
      const count = prst === 'pentagon' ? 5 : prst === 'hexagon' ? 6 : 10;
      const points = Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + (Math.PI * 2 * i) / count;
        const radius = prst === 'star5' && i % 2 ? 0.22 : 0.48;
        return `${w / 2 + Math.cos(angle) * w * radius},${
          h / 2 + Math.sin(angle) * h * radius
        }`;
      });
      e = mk('polygon');
      e.setAttribute('points', points.join(' '));
      break;
    }
    case 'donut': {
      e = mk('path');
      const rx = w / 2;
      const ry = h / 2;
      const irx = rx * 0.5;
      const iry = ry * 0.5;
      e.setAttribute(
        'd',
        `M ${rx} 0 A ${rx} ${ry} 0 1 1 ${rx} ${h} A ${rx} ${ry} 0 1 1 ${rx} 0 Z M ${rx} ${
          ry - iry
        } A ${irx} ${iry} 0 1 0 ${rx} ${ry + iry} A ${irx} ${iry} 0 1 0 ${rx} ${
          ry - iry
        } Z`
      );
      e.setAttribute('fill-rule', 'evenodd');
      e.setAttribute('clip-rule', 'evenodd');
      break;
    }
    case 'cube': {
      e = mk('path');
      e.setAttribute(
        'd',
        `M 0 ${h * 0.25} L ${w * 0.25} 0 L ${w} 0 L ${w} ${h * 0.75} L ${
          w * 0.75
        } ${h} L 0 ${h} Z M 0 ${h * 0.25} L ${w * 0.75} ${
          h * 0.25
        } L ${w} 0 M ${w * 0.75} ${h * 0.25} L ${w * 0.75} ${h}`
      );
      break;
    }
    case 'cloud': {
      e = mk('path');
      e.setAttribute(
        'd',
        `M ${w * 0.18} ${h * 0.78} C ${w * 0.02} ${h * 0.78},0 ${h * 0.48},${
          w * 0.17
        } ${h * 0.42} C ${w * 0.16} ${h * 0.18},${w * 0.42} ${h * 0.08},${
          w * 0.56
        } ${h * 0.27} C ${w * 0.72} ${h * 0.08},${w * 0.96} ${h * 0.22},${
          w * 0.9
        } ${h * 0.48} C ${w * 1.06} ${h * 0.56},${w * 0.96} ${h * 0.82},${
          w * 0.78
        } ${h * 0.79} Z`
      );
      break;
    }
    case 'line':
    case 'straightConnector1': {
      e = mk('line');
      e.setAttribute('x1', '0');
      e.setAttribute('y1', '0');
      e.setAttribute('x2', String(w));
      e.setAttribute('y2', String(h));
      e.setAttribute('stroke', stroke || fill);
      e.setAttribute('stroke-width', String(strokeW || 12700));
      return e;
    }
    default: {
      e = mk('rect');
      e.setAttribute('width', String(w));
      e.setAttribute('height', String(h));
    }
  }
  setStroke(e);
  return e;
}

// ---- fills ----
// Gradient/definition ids must be unique document-wide: url(#id) resolves against
// the whole HTML document, so two mounted editors need disjoint id namespaces.
let svgSeq = 0;
let gradSeq = 0;

function defsIdPrefix(defs: SVGDefsElement): string {
  return (defs.ownerSVGElement as SVGSVGElement | null)?.dataset.svgUid ?? '';
}
function upsertDefinition(defs: SVGDefsElement, next: SVGElement): SVGElement {
  const id = next.id;
  const current = id
    ? Array.from(defs.children).find((candidate) => candidate.id === id)
    : undefined;
  if (current) return patchDomNode(current, next) as SVGElement;
  defs.appendChild(next);
  return next;
}

function gradientPaint(
  grad: ONode,
  pkg: OPCPackage,
  defs: SVGDefsElement,
  phClr?: string,
  stableId?: string
): string {
  const gsLst = child(grad, 'a:gsLst');
  const lin = child(grad, 'a:lin');
  const ang = lin ? Number(getAttr(lin, 'ang')) / 60000 : 90;
  const grEl = featheryDoc().createElementNS(SVGNS, 'linearGradient');
  const id = defsIdPrefix(defs) + (stableId || `grad-${gradSeq++}`);
  grEl.setAttribute('id', id);
  grEl.setAttribute('gradientUnits', 'objectBoundingBox');
  const rad = (ang * Math.PI) / 180;
  grEl.setAttribute('x1', String(0.5 - Math.cos(rad) / 2));
  grEl.setAttribute('y1', String(0.5 - Math.sin(rad) / 2));
  grEl.setAttribute('x2', String(0.5 + Math.cos(rad) / 2));
  grEl.setAttribute('y2', String(0.5 + Math.sin(rad) / 2));
  for (const gs of children(gsLst || grad, 'a:gs')) {
    const stop = featheryDoc().createElementNS(SVGNS, 'stop');
    stop.setAttribute(
      'offset',
      String(Number(getAttr(gs, 'pos')) / 100000 || 0)
    );
    stop.setAttribute('stop-color', resolveColor(gs, pkg, phClr) || '#000');
    const opacity = colorOpacity(gs);
    if (opacity !== undefined)
      stop.setAttribute('stop-opacity', String(opacity));
    grEl.appendChild(stop);
  }
  upsertDefinition(defs, grEl);
  return `url(#${id})`;
}

/** Paint string for a fill element (a:solidFill / a:gradFill / a:noFill). */
function paintFromFillElement(
  fillEl: ONode | undefined,
  pkg: OPCPackage,
  defs: SVGDefsElement,
  phClr?: string,
  stableId?: string
): string {
  if (!fillEl) return 'none';
  switch (tagOf(fillEl)) {
    case 'a:solidFill':
      return resolveColor(fillEl, pkg, phClr) || 'none';
    case 'a:gradFill':
      return gradientPaint(fillEl, pkg, defs, phClr, stableId);
    default:
      return 'none';
  }
}

/** Paint string for any fill container (a node whose child is a:solidFill / a:gradFill / a:noFill). */
function fillPaint(
  container: ONode | undefined,
  pkg: OPCPackage,
  defs: SVGDefsElement,
  phClr?: string,
  stableId?: string
): string {
  if (!container) return 'none';
  if (child(container, 'a:noFill')) return 'none';
  const solid = child(container, 'a:solidFill');
  if (solid) return resolveColor(solid, pkg, phClr) || 'none';
  const grad = child(container, 'a:gradFill');
  if (grad) return gradientPaint(grad, pkg, defs, phClr, stableId);
  return 'none';
}

function shapeFill(
  shape: Shape,
  pkg: OPCPackage,
  defs: SVGDefsElement,
  key: string
): string {
  return fillPaint(shape.spPr, pkg, defs, undefined, `shape-gradient-${key}`);
}

interface LineEnd {
  type?: string;
  width?: string;
  length?: string;
}
interface ShapeStroke {
  color?: string;
  width: number;
  opacity?: number;
  dash?: string;
  cap?: string;
  compound?: string;
  alignment?: string;
  head?: LineEnd;
  tail?: LineEnd;
}
function colorOpacity(container: ONode | undefined): number | undefined {
  if (!container) return undefined;
  const color =
    child(container, 'a:srgbClr') ||
    child(container, 'a:schemeClr') ||
    child(container, 'a:sysClr') ||
    child(container, 'a:prstClr');
  if (!color) return undefined;
  const alpha = child(color, 'a:alpha');
  const mod = child(color, 'a:alphaMod');
  const off = child(color, 'a:alphaOff');
  let value = alpha ? Number(getAttr(alpha, 'val')) / 100000 : 1;
  if (mod) value *= Number(getAttr(mod, 'val')) / 100000;
  if (off) value += Number(getAttr(off, 'val')) / 100000;
  return Math.max(0, Math.min(1, value));
}

function shapeFillOpacity(shape: Shape): number | undefined {
  return colorOpacity(shape.spPr && child(shape.spPr, 'a:solidFill'));
}

function shapeStroke(shape: Shape, pkg: OPCPackage): ShapeStroke {
  const ln = shape.spPr && child(shape.spPr, 'a:ln');
  if (!ln) return { width: 0 };
  if (child(ln, 'a:noFill')) return { width: 0 };
  const w = Number(getAttr(ln, 'w')) || 9525;
  const solid = child(ln, 'a:solidFill');
  const color = resolveColor(solid, pkg);
  const dash = getAttr(child(ln, 'a:prstDash') || {}, 'val');
  const end = (tag: string): LineEnd | undefined => {
    const node = child(ln, tag);
    return node
      ? {
          type: getAttr(node, 'type'),
          width: getAttr(node, 'w'),
          length: getAttr(node, 'len')
        }
      : undefined;
  };
  return {
    color,
    width: w,
    opacity: colorOpacity(solid),
    dash,
    cap: getAttr(ln, 'cap'),
    compound: getAttr(ln, 'cmpd'),
    alignment: getAttr(ln, 'algn'),
    head: end('a:headEnd'),
    tail: end('a:tailEnd')
  };
}

function applyLineStyle(
  el: SVGElement,
  style: ShapeStroke,
  defs: SVGDefsElement,
  key: string
): void {
  const dash: Record<string, number[]> = {
    dash: [4, 3],
    lgDash: [8, 3],
    sysDash: [3, 1],
    sysDot: [1, 1],
    sysDashDot: [3, 1, 1, 1],
    dot: [1, 3],
    dashDot: [4, 3, 1, 3],
    lgDashDot: [8, 3, 1, 3],
    lgDashDotDot: [8, 3, 1, 3, 1, 3]
  };
  if (style.dash && style.dash !== 'solid')
    el.setAttribute(
      'stroke-dasharray',
      (dash[style.dash] || dash.dash)
        .map((part) => part * style.width)
        .join(' ')
    );
  if (style.cap)
    el.setAttribute(
      'stroke-linecap',
      style.cap === 'rnd' ? 'round' : style.cap === 'sq' ? 'square' : 'butt'
    );
  if (style.opacity !== undefined)
    el.setAttribute('stroke-opacity', String(style.opacity));
  const marker = (where: 'head' | 'tail', end?: LineEnd) => {
    const type = end?.type;
    if (!type || type === 'none') return;
    const id = `${defsIdPrefix(defs)}line-${key}-${where}`;
    const m = featheryDoc().createElementNS(SVGNS, 'marker');
    const scale = end?.width === 'sm' ? 3.2 : end?.width === 'lg' ? 5.4 : 4.2;
    const length =
      end?.length === 'sm' ? 0.72 : end?.length === 'lg' ? 1.35 : 1;
    m.setAttribute('id', id);
    m.setAttribute('viewBox', '0 0 10 10');
    m.setAttribute('markerWidth', String(scale * length));
    m.setAttribute('markerHeight', String(scale));
    m.setAttribute('refX', '9');
    m.setAttribute('refY', '5');
    m.setAttribute('orient', 'auto-start-reverse');
    m.setAttribute('markerUnits', 'strokeWidth');
    const mark = featheryDoc().createElementNS(
      SVGNS,
      type === 'oval' ? 'ellipse' : 'path'
    );
    if (type === 'oval') {
      mark.setAttribute('cx', '6');
      mark.setAttribute('cy', '5');
      mark.setAttribute('rx', '3.5');
      mark.setAttribute('ry', '3.5');
    } else if (type === 'diamond')
      mark.setAttribute('d', 'M 1 5 L 5 1 L 9 5 L 5 9 Z');
    else if (type === 'stealth')
      mark.setAttribute('d', 'M 0 0 L 10 5 L 0 10 L 3.2 5 Z');
    else if (type === 'arrow') mark.setAttribute('d', 'M 1 1 L 9 5 L 1 9');
    else mark.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
    const open = type === 'arrow';
    mark.setAttribute('fill', open ? 'none' : style.color || '#000');
    if (open) {
      mark.setAttribute('stroke', style.color || '#000');
      mark.setAttribute('stroke-width', '1.4');
    }
    if (style.opacity !== undefined)
      mark.setAttribute('opacity', String(style.opacity));
    m.appendChild(mark);
    upsertDefinition(defs, m);
    el.setAttribute(
      where === 'head' ? 'marker-start' : 'marker-end',
      `url(#${id})`
    );
  };
  marker('head', style.head);
  marker('tail', style.tail);
}

function applyOuterShadow(
  el: SVGElement,
  shape: Shape,
  pkg: OPCPackage,
  defs: SVGDefsElement,
  key: string
): void {
  const effect = shape.spPr && child(shape.spPr, 'a:effectLst');
  const shadow = effect && child(effect, 'a:outerShdw');
  if (!shadow) return;
  const filter = featheryDoc().createElementNS(SVGNS, 'filter');
  const id = `${defsIdPrefix(defs)}shadow-${key}`;
  filter.setAttribute('id', id);
  filter.setAttribute('x', '-50%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%');
  filter.setAttribute('height', '200%');
  const drop = featheryDoc().createElementNS(SVGNS, 'feDropShadow');
  const dist = Number(getAttr(shadow, 'dist')) || 0;
  const dir = (((Number(getAttr(shadow, 'dir')) || 0) / 60000) * Math.PI) / 180;
  drop.setAttribute('dx', String(Math.cos(dir) * dist));
  drop.setAttribute('dy', String(Math.sin(dir) * dist));
  drop.setAttribute(
    'stdDeviation',
    String((Number(getAttr(shadow, 'blurRad')) || 0) / 2)
  );
  drop.setAttribute('flood-color', resolveColor(shadow, pkg) || '#000000');
  const colorNode = child(shadow, 'a:srgbClr') || child(shadow, 'a:schemeClr');
  const alpha = colorNode && child(colorNode, 'a:alpha');
  if (alpha)
    drop.setAttribute(
      'flood-opacity',
      String(Number(getAttr(alpha, 'val')) / 100000)
    );
  filter.appendChild(drop);
  upsertDefinition(defs, filter);
  el.setAttribute('filter', `url(#${id})`);
}

// ---- text (foreignObject for real HTML layout) ----
// Text is laid out at real px sizes inside a <g transform="scale(EMU_PER_PX)">, so
// the HTML box stays in normal px (18pt -> 24px) — below the browser's ~10000px
// font-size clamp — then the scale blows it up into the slide's EMU space.
const EMU_PER_PX = 9525;
const ptToCssPx = (pt: number) => (pt * 96) / 72;

interface ParaDefault {
  sizePt?: number;
  color?: string;
  font?: string;
  bold?: boolean;
  italic?: boolean;
}
// A run's own props win; otherwise fall back to the paragraph's inherited default
// (from the placeholder list style), then the built-in default.
function runStyle(r: Run, def?: ParaDefault, fontScale = 1): string {
  const parts = [
    `font-size:${ptToCssPx(r.sizePt ?? def?.sizePt ?? 18) * fontScale}px`,
    `color:#${(r.color ?? def?.color ?? '000000').replace('#', '')}`,
    `font-family:'${resolveFont(
      r.font ?? def?.font,
      svgThemeFonts
    )}',Helvetica,Arial,sans-serif`
  ];
  if (r.bold ?? def?.bold) parts.push('font-weight:700');
  if (r.italic ?? def?.italic) parts.push('font-style:italic');
  const decorations = [
    r.underline ? 'underline' : '',
    r.strike ? 'line-through' : ''
  ].filter(Boolean);
  if (decorations.length)
    parts.push(`text-decoration:${decorations.join(' ')}`);
  if (r.highlight)
    parts.push(`background-color:#${r.highlight.replace('#', '')}`);
  if (r.baselinePct) parts.push(`vertical-align:${r.baselinePct}%`);
  return parts.join(';');
}

function spacingCss(
  value: Spacing | undefined,
  baseFontPx: number
): string | undefined {
  if (!value) return undefined;
  return `${
    value.kind === 'points'
      ? ptToCssPx(value.valPt)
      : (baseFontPx * value.valPct) / 100
  }px`;
}

/** Draw a DrawingML table as real SVG cells plus small HTML text boxes. The
 * foreignObjects use the same EMU-to-px scale as ordinary text, which keeps
 * wrapping and double-click editing stable at any zoom. */
function tableGroup(shape: Shape, pkg: OPCPackage): SVGGElement {
  const g = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
  const cols = tableColumns(shape);
  const rows = tableRows(shape);
  const columnWidths = cols.map(
    (column) =>
      Number(getAttr(column, 'w')) ||
      (shape.xfrm?.cx || 0) / Math.max(cols.length, 1)
  );
  const rowHeights = rows.map(
    (row) =>
      Number(getAttr(row, 'h')) ||
      (shape.xfrm?.cy || 0) / Math.max(rows.length, 1)
  );
  const columnOffsets = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0)
  );
  let y = 0;
  rows.forEach((row, rowIndex) => {
    const rowHeight = rowHeights[rowIndex];
    let x = 0;
    tableCells(row).forEach((cell, colIndex) => {
      if (tableCellIsMergeContinuation(cell)) return;
      x = columnOffsets[colIndex] ?? x;
      const gridSpan = tableCellGridSpan(cell);
      const rowSpan = tableCellRowSpan(cell);
      const w =
        columnWidths
          .slice(colIndex, colIndex + gridSpan)
          .reduce((sum, width) => sum + width, 0) ||
        columnWidths[colIndex] ||
        0;
      const h =
        rowHeights
          .slice(rowIndex, rowIndex + rowSpan)
          .reduce((sum, height) => sum + height, 0) || rowHeight;
      const rect = featheryDoc().createElementNS(SVGNS, 'rect');
      rect.dataset.tableCellBg = '';
      rect.dataset.row = String(rowIndex);
      rect.dataset.col = String(colIndex);
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(w));
      rect.setAttribute('height', String(h));
      rect.setAttribute('fill', `#${tableCellFill(cell) || 'FFFFFF'}`);
      g.appendChild(rect);
      const lines: Array<{
        edge: 'L' | 'T' | 'R' | 'B';
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      }> = [
        { edge: 'L', x1: x, y1: y, x2: x, y2: y + h },
        { edge: 'T', x1: x, y1: y, x2: x + w, y2: y },
        { edge: 'R', x1: x + w, y1: y, x2: x + w, y2: y + h },
        { edge: 'B', x1: x, y1: y + h, x2: x + w, y2: y + h }
      ];
      for (const spec of lines) {
        const border = tableCellBorderEdge(cell, spec.edge);
        if (border.none) continue;
        const line = featheryDoc().createElementNS(SVGNS, 'line');
        line.setAttribute('x1', String(spec.x1));
        line.setAttribute('y1', String(spec.y1));
        line.setAttribute('x2', String(spec.x2));
        line.setAttribute('y2', String(spec.y2));
        line.setAttribute('stroke', `#${border.color || '8896A8'}`);
        line.setAttribute('stroke-width', String(border.widthEMU));
        if (border.dash !== 'solid')
          line.setAttribute(
            'stroke-dasharray',
            border.dash === 'sysDot'
              ? `${border.widthEMU} ${border.widthEMU * 2}`
              : `${border.widthEMU * 4} ${border.widthEMU * 3}`
          );
        g.appendChild(line);
      }

      const textG = featheryDoc().createElementNS(SVGNS, 'g');
      textG.setAttribute('transform', `scale(${EMU_PER_PX})`);
      const fo = featheryDoc().createElementNS(SVGNS, 'foreignObject');
      fo.setAttribute('x', String(x / EMU_PER_PX));
      fo.setAttribute('y', String(y / EMU_PER_PX));
      fo.setAttribute('width', String(w / EMU_PER_PX));
      fo.setAttribute('height', String(h / EMU_PER_PX));
      const div = featheryDoc().createElementNS(XHTML, 'div') as HTMLDivElement;
      const rPr = descendant(cell, 'a:rPr') || descendant(cell, 'a:endParaRPr');
      const fontPt = tableCellFontSize(cell) || 12;
      const color =
        resolveColor(rPr && child(rPr, 'a:solidFill'), pkg) || '#000000';
      const bold = rPr && getAttr(rPr, 'b') === '1' ? 'font-weight:700;' : '';
      const italic =
        rPr && getAttr(rPr, 'i') === '1' ? 'font-style:italic;' : '';
      const decoration = [
        rPr && getAttr(rPr, 'u') && getAttr(rPr, 'u') !== 'none'
          ? 'underline'
          : '',
        rPr && getAttr(rPr, 'strike') && getAttr(rPr, 'strike') !== 'noStrike'
          ? 'line-through'
          : ''
      ]
        .filter(Boolean)
        .join(' ');
      const cellAlign = tableCellAlign(cell);
      const cellVertical = tableCellVerticalAlign(cell);
      const textAlign =
        cellAlign === 'ctr'
          ? 'center'
          : cellAlign === 'r'
          ? 'right'
          : cellAlign === 'just'
          ? 'justify'
          : 'left';
      const justifyContent =
        cellVertical === 'ctr'
          ? 'center'
          : cellVertical === 'b'
          ? 'flex-end'
          : 'flex-start';
      div.dataset.tableCell = '';
      div.dataset.row = String(rowIndex);
      div.dataset.col = String(colIndex);
      div.style.cssText = `box-sizing:border-box;width:${
        w / EMU_PER_PX
      }px;height:${
        h / EMU_PER_PX
      }px;padding:5px 7px;overflow:hidden;white-space:pre-wrap;word-break:break-word;line-height:1.2;font-size:${ptToCssPx(
        fontPt
      )}px;color:${color};text-align:${textAlign};display:flex;flex-direction:column;justify-content:${justifyContent};${bold}${italic}${
        decoration ? `text-decoration:${decoration};` : ''
      }`;
      div.textContent = tableCellText(cell);
      fo.appendChild(div);
      textG.appendChild(fo);
      g.appendChild(textG);
      x += w;
    });
    y += rowHeight;
  });
  return g;
}

// Bullets are often authored in a symbol font (Wingdings/Symbol) where the char
// is a bullet only IN THAT FONT; rendered in a normal/emoji font the codepoint
// becomes a wrong glyph (a calendar, etc.). Map those to a clean Unicode bullet.
const SAFE_BULLETS = new Set([
  '•',
  '◦',
  '▪',
  '‣',
  '·',
  '–',
  '-',
  '*',
  'o',
  '●',
  '■',
  '◆',
  '➤',
  '➢',
  '→',
  '⇒',
  '›',
  '»',
  '✓'
]);
// A few common Wingdings/Symbol bullet codepoints → Unicode.
const SYMBOL_BULLET: Record<string, string> = {
  '§': '▪', // Wingdings § → small filled square
  l: '●', // Wingdings l → filled circle
  n: '■', // Wingdings n → filled square
  u: '◆', // Wingdings u → filled diamond
  v: '•',
  ü: '✓' // Wingdings ü → check
};
export function bulletGlyph(
  char: string | undefined,
  font: string | undefined
): string {
  const ch = (char || '•')
    .replace(/&#x([0-9a-f]+);/gi, (_, value) =>
      String.fromCodePoint(parseInt(value, 16))
    )
    .replace(/&#([0-9]+);/g, (_, value) =>
      String.fromCodePoint(parseInt(value, 10))
    );
  // Modern producers often store the intended Unicode glyph while retaining a
  // legacy Wingdings font declaration. Preserve an already-safe glyph first.
  if (SAFE_BULLETS.has(ch)) return ch;
  // symbol-font bullets: map the few common ones, default everything else to a bullet
  if (/wingding|webding|symbol/i.test(font || ''))
    return SYMBOL_BULLET[ch] || '•';
  // otherwise only keep a known bullet glyph; any other codepoint (a symbol char
  // like "§", or an emoji) would render as itself, so normalize it to "•"
  return SAFE_BULLETS.has(ch) ? ch : '•';
}

function alphaNumber(value: number, upper: boolean): string {
  let n = Math.max(1, Math.floor(value));
  let result = '';
  while (n) {
    n -= 1;
    result = String.fromCharCode((upper ? 65 : 97) + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

function romanNumber(value: number, upper: boolean): string {
  let n = Math.max(1, Math.floor(value));
  const pairs: Array<[number, string]> = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i']
  ];
  let result = '';
  for (const [amount, glyph] of pairs)
    while (n >= amount) {
      result += glyph;
      n -= amount;
    }
  return upper ? result.toUpperCase() : result;
}

export function autoNumberGlyph(
  value: number,
  scheme = 'arabicPeriod'
): string {
  const upper = /Uc/.test(scheme);
  const token = /^alpha/.test(scheme)
    ? alphaNumber(value, upper)
    : /^roman/.test(scheme)
    ? romanNumber(value, upper)
    : String(value);
  if (/ParenBoth$/.test(scheme)) return `(${token})`;
  if (/ParenR$/.test(scheme)) return `${token})`;
  if (/Period$/.test(scheme)) return `${token}.`;
  return token;
}

function textForeign(shape: Shape, w: number, h: number): SVGGElement | null {
  if (!shape.text || !shape.text.paragraphs.length) return null;
  const body = readBodyProps(shape.text.node);
  const anchor = body.anchor || 't';
  const justify =
    anchor === 'ctr'
      ? 'center'
      : anchor === 'b'
      ? 'flex-end'
      : anchor === 'just'
      ? 'space-between'
      : anchor === 'dist'
      ? 'space-around'
      : 'flex-start';
  const fontScale =
    body.autofit?.type === 'normal'
      ? Math.max(0.01, (body.autofit.fontScalePct ?? 100) / 100)
      : 1;
  const px = (emu: number) => emu / EMU_PER_PX;
  const insetL = px(body.insetsEMU?.l ?? 91440);
  const insetT = px(body.insetsEMU?.t ?? 45720);
  const insetR = px(body.insetsEMU?.r ?? 91440);
  const insetB = px(body.insetsEMU?.b ?? 45720);

  const g = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
  g.setAttribute('transform', `scale(${EMU_PER_PX})`);
  g.dataset.text = ''; // marker so the editor can hide the rendered text while editing
  const fo = featheryDoc().createElementNS(SVGNS, 'foreignObject');
  fo.setAttribute('x', '0');
  fo.setAttribute('y', '0');
  fo.setAttribute('width', String(px(w)));
  fo.setAttribute('height', String(px(h)));
  // DrawingML defaults vertical overflow to visible when vertOverflow is absent.
  // Wrapping controls line breaks, not whether those lines can extend past the box.
  const allowOverflow =
    body.verticalOverflow !== 'clip' && body.verticalOverflow !== 'ellipsis';
  fo.style.overflow = allowOverflow ? 'visible' : 'hidden';

  const div = featheryDoc().createElementNS(XHTML, 'div') as HTMLDivElement;
  div.dataset.textbody = ''; // the in-place editing surface (contentEditable is toggled on this)
  div.style.cssText =
    `width:${px(w)}px;height:${px(
      h
    )}px;display:flex;flex-direction:column;justify-content:${justify};` +
    `box-sizing:border-box;padding:${insetT}px ${insetR}px ${insetB}px ${insetL}px;overflow:${
      allowOverflow ? 'visible' : 'hidden'
    };line-height:1.2;outline:none;`;

  const autoNumbers = new Map<string, number>();
  for (const [paragraphIndex, p] of shape.text.paragraphs.entries()) {
    // Resolve what the paragraph inherits from the placeholder's list style
    // (layout -> master) when its own pPr is silent: bullets + default run props.
    const inherited =
      curDeck && curSlide
        ? resolveListProps(curDeck, curSlide, shape, p.level ?? 0)
        : {};
    const paraProps = readParagraphProps(p.node);
    const bullet = p.bullet ?? inherited.bullet;
    const paraDef = inherited.defRPr;

    const pDiv = featheryDoc().createElementNS(XHTML, 'div') as HTMLDivElement;
    pDiv.dataset.sourceParagraph = String(paragraphIndex);
    pDiv.dataset.level = String(p.level ?? 0);
    pDiv.dataset.baseMarLEmu = String(p.marLEmu ?? inherited.marLEmu ?? 0);
    pDiv.dataset.baseIndentEmu = String(
      p.indentEmu ?? inherited.indentEmu ?? 0
    );
    if (bullet && bullet.kind !== 'none') pDiv.dataset.bulletItem = '';
    const align =
      p.align === 'ctr'
        ? 'center'
        : p.align === 'r'
        ? 'right'
        : p.align === 'just'
        ? 'justify'
        : 'left';
    const marL = (p.marLEmu ?? inherited.marLEmu ?? 0) / EMU_PER_PX;
    const indent = (p.indentEmu ?? inherited.indentEmu ?? 0) / EMU_PER_PX;
    // Prevent flexbox from compressing paragraphs to the box height. With a
    // centered anchor, their natural height then extends above and below it.
    let css = `flex-shrink:0;text-align:${align};white-space:${
      body.wrap === 'none' ? 'pre' : 'pre-wrap'
    };`;
    if (bullet && bullet.kind !== 'none') {
      // The marker hangs beside the text. Both the first text line and any
      // Shift+Enter/wrapped lines start at the same padding edge.
      css += `position:relative;padding-left:${marL}px;text-indent:0px;`;
    } else if (marL || indent)
      css += `padding-left:${marL}px;text-indent:${indent}px;`;
    const baseFontPx =
      ptToCssPx(p.runs[0]?.sizePt ?? paraDef?.sizePt ?? 18) * fontScale;
    const before = spacingCss(paraProps.spaceBefore, baseFontPx);
    const after = spacingCss(paraProps.spaceAfter, baseFontPx);
    if (before) css += `margin-top:${before};`;
    if (after) css += `margin-bottom:${after};`;
    if (paraProps.lineSpacing?.kind === 'points')
      css += `line-height:${ptToCssPx(paraProps.lineSpacing.valPt)}px;`;
    else if (paraProps.lineSpacing?.kind === 'percent') {
      const reduction =
        body.autofit?.type === 'normal'
          ? body.autofit.lineSpaceReductionPct ?? 0
          : 0;
      css += `line-height:${Math.max(
        0.1,
        (paraProps.lineSpacing.valPct - reduction) / 100
      )};`;
    }
    pDiv.setAttribute('style', css);

    // bullet marker (explicit char / auto-number), styled from the first run
    const first = p.runs[0];
    const markerSize = (first?.sizePt ?? paraDef?.sizePt ?? 18) * fontScale;
    const markerColor = (first?.color ?? paraDef?.color ?? '000000').replace(
      '#',
      ''
    );
    const markerStyle = `font-size:${ptToCssPx(
      markerSize
    )}px;color:#${markerColor};position:absolute;left:${marL + indent}px;${
      indent ? '' : 'transform:translateX(-100%);'
    }`;
    if (bullet?.kind === 'char') {
      const m = featheryDoc().createElementNS(XHTML, 'span') as HTMLSpanElement;
      m.setAttribute('style', markerStyle);
      m.dataset.bullet = '';
      m.setAttribute('contenteditable', 'false');
      m.textContent = `${bulletGlyph(bullet.char, bullet.font)} `;
      pDiv.appendChild(m);
    } else if (bullet?.kind === 'autoNum') {
      const scheme = bullet.scheme || 'arabicPeriod';
      const key = `${p.level ?? 0}:${scheme}`;
      const autoNum = autoNumbers.has(key)
        ? autoNumbers.get(key)! + 1
        : bullet.startAt || 1;
      autoNumbers.set(key, autoNum);
      const m = featheryDoc().createElementNS(XHTML, 'span') as HTMLSpanElement;
      m.setAttribute('style', markerStyle);
      m.dataset.bullet = '';
      m.setAttribute('contenteditable', 'false');
      m.textContent = `${autoNumberGlyph(autoNum, scheme)} `;
      pDiv.appendChild(m);
    }

    if (!p.runs.length)
      pDiv.appendChild(featheryDoc().createElementNS(XHTML, 'br'));
    for (const [runIndex, r] of p.runs.entries()) {
      if (tagOf(r.node) === 'a:br') {
        const br = featheryDoc().createElementNS(XHTML, 'br') as HTMLBRElement;
        br.dataset.softBreak = '';
        br.dataset.sourceParagraph = String(paragraphIndex);
        br.dataset.sourceRun = String(runIndex);
        pDiv.appendChild(br);
        continue;
      }
      const span = featheryDoc().createElementNS(
        XHTML,
        'span'
      ) as HTMLSpanElement;
      span.setAttribute('style', runStyle(r, paraDef, fontScale));
      span.dataset.sourceParagraph = String(paragraphIndex);
      span.dataset.sourceRun = String(runIndex);
      if (tagOf(r.node) === 'a:fld')
        span.setAttribute('contenteditable', 'false');
      span.textContent = r.text;
      const hyperlink = r.rPr && child(r.rPr, 'a:hlinkClick');
      const relationshipId = hyperlink && getAttr(hyperlink, 'r:id');
      const relationship =
        relationshipId && curDeck && curSlide
          ? curDeck.pkg
              .rels(curSlide.path)
              .find((entry) => entry.id === relationshipId)
          : undefined;
      if (relationship) {
        const link = featheryDoc().createElementNS(
          XHTML,
          'a'
        ) as HTMLAnchorElement;
        link.dataset.hyperlink = '';
        const internalSlide =
          !relationship.external && relationship.type.endsWith('/slide');
        link.setAttribute('href', internalSlide ? '#' : relationship.target);
        if (internalSlide) link.dataset.slideTarget = relationship.target;
        else {
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
        }
        const tooltip = hyperlink ? getAttr(hyperlink, 'tooltip') : undefined;
        if (tooltip) link.setAttribute('title', tooltip);
        link.style.color = 'inherit';
        link.style.textDecoration = 'inherit';
        link.style.cursor = 'pointer';
        link.appendChild(span);
        pDiv.appendChild(link);
      } else pDiv.appendChild(span);
    }
    div.appendChild(pDiv);
  }
  fo.appendChild(div);
  g.appendChild(fo);
  return g;
}

function chartText(
  parent: SVGElement,
  value: string,
  x: number,
  y: number,
  size: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
  weight?: string,
  style?: ChartTextStyle
): SVGGElement {
  // Large EMU font sizes exceed Chromium's SVG font-size clamp before the
  // slide viewBox is scaled. Lay chart text out in ordinary CSS pixels inside
  // a scaled group so labels and their vector marks scale together.
  const wrapper = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
  wrapper.setAttribute(
    'transform',
    `translate(${x} ${y}) scale(${EMU_PER_PX})`
  );
  const text = featheryDoc().createElementNS(SVGNS, 'text');
  text.setAttribute('x', '0');
  text.setAttribute('y', '0');
  const resolvedSize = style?.sizePt ? style.sizePt * 12700 : size;
  text.setAttribute('font-size', String(resolvedSize / EMU_PER_PX));
  text.setAttribute(
    'font-family',
    `${resolveFont(style?.font, svgThemeFonts)},Arial,sans-serif`
  );
  text.setAttribute(
    'fill',
    resolveChartColor(style?.color, curDeck?.pkg) || '#44546a'
  );
  text.setAttribute('text-anchor', anchor);
  if (style?.colorOpacityPct !== undefined)
    text.setAttribute('fill-opacity', String(style.colorOpacityPct / 100));
  text.setAttribute('dominant-baseline', 'middle');
  if (weight || style?.bold) text.setAttribute('font-weight', weight || '700');
  if (style?.italic) text.setAttribute('font-style', 'italic');
  if (style?.underline && style.underline !== 'none')
    text.setAttribute('text-decoration', 'underline');
  text.textContent = value;
  wrapper.appendChild(text);
  parent.appendChild(wrapper);
  return wrapper;
}

function resolveChartColor(
  value: string | undefined,
  pkg: OPCPackage | undefined
): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('scheme:')) return value;
  if (!pkg) return undefined;
  const name = value.slice('scheme:'.length);
  return `#${
    themeColors(pkg)[SCHEME_ALIAS[name] || name] || themeColors(pkg).accent1
  }`;
}

function chartDashArray(
  dash: string | undefined,
  width: number
): string | undefined {
  if (!dash || dash === 'solid') return undefined;
  const patterns: Record<string, number[]> = {
    dash: [4, 3],
    lgDash: [8, 3],
    sysDash: [3, 1],
    sysDot: [1, 1],
    dot: [1, 3],
    dashDot: [4, 3, 1, 3],
    sysDashDot: [3, 1, 1, 1],
    lgDashDot: [8, 3, 1, 3],
    lgDashDotDot: [8, 3, 1, 3, 1, 3]
  };
  return (patterns[dash] || patterns.dash)
    .map((value) => value * width)
    .join(' ');
}

function chartPath(
  parent: SVGElement,
  d: string,
  color: string,
  mark: string,
  fill = 'none'
): SVGPathElement {
  const path = featheryDoc().createElementNS(SVGNS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', fill);
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '18000');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  path.dataset.chartMark = mark;
  parent.appendChild(path);
  return path;
}

function renderChartMarks(
  g: SVGGElement,
  chart: ChartData,
  w: number,
  h: number,
  pkg: OPCPackage
): void {
  const palette = [
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6'
  ].map((name) => `#${themeColors(pkg)[name]}`);
  const fontSize = Math.max(65000, Math.min(125000, Math.min(w, h) / 22));
  const titleSpace = chart.title ? fontSize * 2.3 : fontSize * 0.6;
  const legendPosition = chart.legendPosition || 'r';
  const hasLegend = chart.showLegend && chart.series.length > 0;
  const legendFontSize = chart.legendStyle?.sizePt
    ? chart.legendStyle.sizePt * 12700
    : Math.max(90000, fontSize * 0.9);
  const legendWidth =
    hasLegend && ['l', 'r', 'tr'].includes(legendPosition)
      ? Math.min(w * 0.22, 1500000)
      : 0;
  const legendHeight =
    hasLegend && ['t', 'b'].includes(legendPosition) ? legendFontSize * 1.8 : 0;
  const hasAxes = !['pie', 'doughnut', 'radar'].includes(chart.kind);
  const horizontalTitleSpace =
    hasAxes && chart.axisTitles.horizontal ? fontSize * 1.45 : 0;
  const verticalTitleSpace =
    hasAxes && chart.axisTitles.vertical ? fontSize * 1.15 : 0;
  const secondaryTitleSpace =
    hasAxes && chart.axisTitles.secondaryVertical ? fontSize * 1.15 : 0;
  const baseLeft = Math.max(fontSize * 2.4, w * 0.1);
  const baseRight = w * 0.05;
  const plot = {
    left:
      baseLeft +
      verticalTitleSpace +
      (legendPosition === 'l' ? legendWidth : 0),
    top: titleSpace + (legendPosition === 't' ? legendHeight : 0),
    width: Math.max(
      1,
      w -
        baseLeft -
        baseRight -
        verticalTitleSpace -
        secondaryTitleSpace -
        legendWidth
    ),
    height: Math.max(
      1,
      h - titleSpace - fontSize * 2.5 - horizontalTitleSpace - legendHeight
    )
  };
  if (chart.plotAreaStyle?.fillColor && !chart.plotAreaStyle.noFill) {
    const plotBackground = featheryDoc().createElementNS(SVGNS, 'rect');
    plotBackground.setAttribute('x', String(plot.left));
    plotBackground.setAttribute('y', String(plot.top));
    plotBackground.setAttribute('width', String(plot.width));
    plotBackground.setAttribute('height', String(plot.height));
    plotBackground.setAttribute(
      'fill',
      resolveChartColor(chart.plotAreaStyle.fillColor, pkg) || 'none'
    );
    if (chart.plotAreaStyle.fillOpacityPct !== undefined)
      plotBackground.setAttribute(
        'fill-opacity',
        String(chart.plotAreaStyle.fillOpacityPct / 100)
      );
    g.appendChild(plotBackground);
  }
  if (chart.title)
    chartText(
      g,
      chart.title,
      w / 2,
      fontSize * 0.95,
      fontSize * 1.25,
      'middle',
      undefined,
      chart.titleStyle
    );

  const colors = chart.series.map(
    (series, index) =>
      resolveChartColor(series.color, pkg) || palette[index % palette.length]
  );
  const categories =
    chart.series.find((series) => series.categories.length)?.categories ?? [];
  const values = chart.series
    .flatMap((series) => series.values)
    .filter(Number.isFinite);
  const renderLegend = (items: Array<{ label: string; color: string }>) => {
    if (!hasLegend || !items.length) return;
    const group = featheryDoc().createElementNS(SVGNS, 'g');
    group.dataset.chartLegend = '';
    group.dataset.legendPosition = legendPosition;
    const horizontal = legendPosition === 't' || legendPosition === 'b';
    if (horizontal) {
      const swatchSize = legendFontSize * 0.55;
      const itemGap = legendFontSize * 0.9;
      const widths = items.map(
        (item) =>
          swatchSize +
          legendFontSize * 0.42 +
          item.label.length * legendFontSize * 0.53
      );
      const totalWidth =
        widths.reduce((sum, width) => sum + width, 0) +
        Math.max(0, items.length - 1) * itemGap;
      let cursor = Math.max(fontSize * 0.5, (w - totalWidth) / 2);
      const y =
        legendPosition === 't'
          ? titleSpace + legendHeight * 0.5
          : h - legendHeight * 0.5;
      items.forEach((item, index) => {
        const x = cursor;
        const swatch = featheryDoc().createElementNS(SVGNS, 'rect');
        swatch.setAttribute('x', String(x));
        swatch.setAttribute('y', String(y - swatchSize / 2));
        swatch.setAttribute('width', String(swatchSize));
        swatch.setAttribute('height', String(swatchSize));
        swatch.setAttribute('fill', item.color);
        group.appendChild(swatch);
        chartText(
          group,
          item.label,
          x + swatchSize + legendFontSize * 0.42,
          y,
          legendFontSize,
          'start',
          undefined,
          chart.legendStyle
        );
        cursor += widths[index] + itemGap;
      });
    } else {
      const x =
        legendPosition === 'l'
          ? legendFontSize * 0.2
          : w - legendWidth + legendFontSize * 0.2;
      items.forEach((item, index) => {
        const y = plot.top + index * legendFontSize * 1.4;
        const swatch = featheryDoc().createElementNS(SVGNS, 'rect');
        swatch.setAttribute('x', String(x));
        swatch.setAttribute('y', String(y - legendFontSize * 0.35));
        swatch.setAttribute('width', String(legendFontSize * 0.7));
        swatch.setAttribute('height', String(legendFontSize * 0.7));
        swatch.setAttribute('fill', item.color);
        group.appendChild(swatch);
        chartText(
          group,
          item.label,
          x + legendFontSize * 1.15,
          y,
          legendFontSize,
          'start',
          undefined,
          chart.legendStyle
        );
      });
    }
    g.appendChild(group);
  };

  if (chart.kind === 'pie' || chart.kind === 'doughnut') {
    const series = chart.series[0];
    if (!series) return;
    const total =
      series.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const radius = Math.max(1, Math.min(plot.width, plot.height) * 0.42);
    const cx = plot.left + plot.width / 2;
    const cy = plot.top + plot.height / 2;
    let angle = (((chart.firstSliceAngle ?? 0) - 90) * Math.PI) / 180;
    series.values.forEach((raw, index) => {
      const sweep = (Math.max(0, raw) / total) * Math.PI * 2;
      const end = angle + sweep;
      const x1 = cx + Math.cos(angle) * radius;
      const y1 = cy + Math.sin(angle) * radius;
      const x2 = cx + Math.cos(end) * radius;
      const y2 = cy + Math.sin(end) * radius;
      const large = sweep > Math.PI ? 1 : 0;
      const d =
        sweep >= Math.PI * 1.999
          ? `M ${cx} ${cy} L ${cx} ${
              cy - radius
            } A ${radius} ${radius} 0 1 1 ${cx} ${
              cy + radius
            } A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius} Z`
          : `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
      const pointColor =
        resolveChartColor(series.pointColors?.[index], pkg) ||
        palette[index % palette.length];
      const slice = chartPath(g, d, '#ffffff', 'slice', pointColor);
      const opacity = series.pointOpacityPct?.[index] ?? series.fillOpacityPct;
      if (opacity !== undefined)
        slice.setAttribute('fill-opacity', String(opacity / 100));
      slice.setAttribute('stroke-width', '12000');
      angle = end;
    });
    if (chart.kind === 'doughnut') {
      const hole = featheryDoc().createElementNS(SVGNS, 'circle');
      hole.setAttribute('cx', String(cx));
      hole.setAttribute('cy', String(cy));
      hole.setAttribute(
        'r',
        String(radius * ((chart.doughnutHolePct ?? 50) / 100))
      );
      hole.setAttribute('fill', '#ffffff');
      g.appendChild(hole);
    }
    renderLegend(
      series.categories.map((label, index) => ({
        label,
        color:
          resolveChartColor(series.pointColors?.[index], pkg) ||
          palette[index % palette.length]
      }))
    );
    return;
  }

  if (chart.kind === 'radar') {
    const radarPlot = chart.plots.find((item) => item.kind === 'radar');
    const radarStyle = radarPlot?.radarStyle || 'standard';
    const count = Math.max(
      3,
      categories.length,
      ...chart.series.map((series) => series.values.length)
    );
    const maxValue = Math.max(1, ...values.map((value) => Math.abs(value)));
    const radius = Math.max(1, Math.min(plot.width, plot.height) * 0.38);
    const cx = plot.left + plot.width / 2;
    const cy = plot.top + plot.height / 2;
    const polar = (index: number, value: number) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
      const distance = (radius * Math.max(0, value)) / maxValue;
      return {
        x: cx + Math.cos(angle) * distance,
        y: cy + Math.sin(angle) * distance
      };
    };
    for (let ring = 1; ring <= 4; ring++) {
      const points = Array.from({ length: count }, (_, index) =>
        polar(index, (maxValue * ring) / 4)
      );
      chartPath(
        g,
        `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`,
        '#d9dee8',
        'grid'
      );
    }
    for (let index = 0; index < count; index++) {
      const edge = polar(index, maxValue);
      const axis = featheryDoc().createElementNS(SVGNS, 'line');
      axis.setAttribute('x1', String(cx));
      axis.setAttribute('y1', String(cy));
      axis.setAttribute('x2', String(edge.x));
      axis.setAttribute('y2', String(edge.y));
      axis.setAttribute('stroke', '#d9dee8');
      axis.setAttribute('stroke-width', '9000');
      g.appendChild(axis);
      const label = polar(index, maxValue * 1.16);
      chartText(
        g,
        categories[index] || String(index + 1),
        label.x,
        label.y,
        fontSize * 0.72,
        label.x < cx - 1000 ? 'end' : label.x > cx + 1000 ? 'start' : 'middle'
      );
    }
    chart.series.forEach((series, seriesIndex) => {
      const points = Array.from({ length: count }, (_, index) =>
        polar(index, series.values[index] || 0)
      );
      const filled = radarStyle === 'filled';
      const polygon = chartPath(
        g,
        `M ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} Z`,
        colors[seriesIndex],
        'radar',
        filled ? colors[seriesIndex] : 'none'
      );
      if (filled)
        polygon.setAttribute(
          'fill-opacity',
          String((series.fillOpacityPct ?? 16) / 100)
        );
      const showMarkers =
        radarStyle === 'marker' ||
        (series.marker && series.marker.symbol !== 'none');
      if (showMarkers)
        points.forEach((point) => {
          const marker = featheryDoc().createElementNS(SVGNS, 'circle');
          marker.setAttribute('cx', String(point.x));
          marker.setAttribute('cy', String(point.y));
          marker.setAttribute(
            'r',
            String(
              series.marker?.size ? series.marker.size * 6350 : fontSize * 0.14
            )
          );
          marker.setAttribute(
            'fill',
            series.marker?.color || colors[seriesIndex]
          );
          marker.dataset.chartMark = 'point';
          g.appendChild(marker);
        });
    });
    renderLegend(
      chart.series.map((series, index) => ({
        label: series.name,
        color: colors[index]
      }))
    );
    return;
  }

  const indexed = chart.series.map((series, index) => ({ series, index }));
  const plotFor = (seriesIndex: number) =>
    chart.plots.find((item) => item.seriesIndexes.includes(seriesIndex));
  const axisFor = (series: ChartSeries) => {
    const index = chart.series.indexOf(series);
    const plotModel = plotFor(index);
    if (plotModel?.yAxisId)
      return chart.axes.find((axis) => axis.id === plotModel.yAxisId);
    return (
      series.axisIds
        .map((id) =>
          chart.axes.find(
            (axis) =>
              axis.id === id &&
              axis.type === 'value' &&
              (axis.position === 'l' || axis.position === 'r')
          )
        )
        .find(Boolean) ||
      chart.axes.find(
        (axis) =>
          axis.type === 'value' &&
          (axis.position === 'l' || axis.position === 'r')
      )
    );
  };
  const xAxisFor = (series: ChartSeries) => {
    const index = chart.series.indexOf(series);
    const plotModel = plotFor(index);
    return plotModel?.xAxisId
      ? chart.axes.find((axis) => axis.id === plotModel.xAxisId)
      : undefined;
  };
  const domainFor = (series: ChartSeries) => {
    const axis = axisFor(series);
    const sameAxis = indexed.filter(
      ({ series: candidate }) => axisFor(candidate)?.id === axis?.id
    );
    const domainValues = sameAxis
      .flatMap(({ series: candidate }) => candidate.values)
      .filter(Number.isFinite);
    let min = Math.min(0, ...domainValues);
    let max = Math.max(0, ...domainValues);
    for (const chartPlot of chart.plots.filter(
      (item) =>
        item.grouping === 'stacked' || item.grouping === 'percentStacked'
    )) {
      if (
        !chartPlot.seriesIndexes.some(
          (index) => axisFor(chart.series[index])?.id === axis?.id
        )
      )
        continue;
      const stackSeries = chartPlot.seriesIndexes.map(
        (index) => chart.series[index]
      );
      const count = Math.max(
        0,
        ...stackSeries.map((item) => item.values.length)
      );
      for (let index = 0; index < count; index++) {
        const positive = stackSeries.reduce(
          (sum, item) => sum + Math.max(0, item.values[index] || 0),
          0
        );
        const negative = stackSeries.reduce(
          (sum, item) => sum + Math.min(0, item.values[index] || 0),
          0
        );
        max = Math.max(max, positive);
        min = Math.min(min, negative);
      }
    }
    if (axis?.resolvedScale) {
      min = axis.resolvedScale.min;
      max = axis.resolvedScale.max;
    } else {
      if (axis?.min !== undefined) min = axis.min;
      if (axis?.max !== undefined) max = axis.max;
    }
    if (min === max) max = min + 1;
    return { min, max, axis };
  };
  const primary = domainFor(chart.series[0]);
  const xDomainFor = (series: ChartSeries) => {
    const axis = xAxisFor(series);
    const values = indexed
      .filter(({ series: candidate }) => xAxisFor(candidate)?.id === axis?.id)
      .flatMap(({ series: candidate }) => candidate.xValues || [])
      .filter(Number.isFinite);
    let min = Math.min(0, ...values);
    let max = Math.max(0, ...values);
    if (axis?.resolvedScale) {
      min = axis.resolvedScale.min;
      max = axis.resolvedScale.max;
    } else {
      if (axis?.min !== undefined) min = axis.min;
      if (axis?.max !== undefined) max = axis.max;
    }
    if (min === max) max = min + 1;
    return { min, max, axis };
  };
  const yFor = (series: ChartSeries, value: number) => {
    const { min, max } = domainFor(series);
    return plot.top + ((max - value) / (max - min)) * plot.height;
  };
  const xFor = (series: ChartSeries, value: number) => {
    const { min, max } = domainFor(series);
    return plot.left + ((value - min) / (max - min)) * plot.width;
  };
  const count = Math.max(
    1,
    ...chart.series.map((series) => series.values.length)
  );
  const columns = indexed.filter(({ series }) => series.kind === 'column');
  const bars = indexed.filter(({ series }) => series.kind === 'bar');
  const lines = indexed.filter(({ series }) =>
    ['line', 'area', 'scatter'].includes(series.kind)
  );
  const pureBar = bars.length > 0 && !columns.length && !lines.length;
  const pureScatter =
    lines.length > 0 &&
    lines.every(({ series }) => series.kind === 'scatter') &&
    !columns.length &&
    !bars.length;
  const formatValue = (value: number, format?: string) =>
    format?.includes('0.0')
      ? value.toFixed(1)
      : format?.includes('%')
      ? `${
          Math.round(value * (format.includes('0.0') ? 10 : 1)) /
          (format.includes('0.0') ? 10 : 1)
        }%`
      : Number(value.toFixed(2)).toString();
  const labelValue = (series: ChartSeries, value: number, category: string) => {
    const labels = series.dataLabels;
    if (!labels) return '';
    const parts = [
      labels.showSeries ? series.name : '',
      labels.showCategory ? category : '',
      labels.showValue ? formatValue(value, labels.numberFormat) : ''
    ].filter(Boolean);
    return parts.join(' ');
  };
  const niceStep = (range: number, target = 5) => {
    const raw = Math.abs(range) / Math.max(1, target);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    const multiplier =
      fraction >= Math.sqrt(50)
        ? 10
        : fraction >= Math.sqrt(10)
        ? 5
        : fraction >= Math.sqrt(2)
        ? 2
        : 1;
    return multiplier * power;
  };
  const tickValues = (
    domain: { min: number; max: number },
    axis?: ChartData['axes'][number]
  ) => {
    if (axis?.resolvedScale?.tickValues?.length)
      return axis.resolvedScale.tickValues;
    const step =
      axis?.majorUnit ||
      axis?.resolvedScale?.majorUnit ||
      niceStep(domain.max - domain.min, axis?.role === 'secondary' ? 10 : 5);
    const first = Math.ceil(domain.min / step - 1e-9) * step;
    const values: number[] = [];
    for (
      let value = first;
      value <= domain.max + step * 1e-8 && values.length < 24;
      value += step
    )
      values.push(+value.toFixed(12));
    if (!values.length || Math.abs(values[0] - domain.min) > step * 1e-8)
      values.unshift(domain.min);
    if (Math.abs(values[values.length - 1] - domain.max) > step * 1e-8)
      values.push(domain.max);
    return values;
  };

  // Axes and major grid lines, using the primary value axis's explicit scale and styling.
  const primaryAxis = primary.axis;
  const primaryTicks = tickValues(primary, primaryAxis);
  const primaryAxisGroup = featheryDoc().createElementNS(SVGNS, 'g');
  primaryAxisGroup.dataset.chartAxisGroup = 'primary';
  if (primaryAxis)
    primaryAxisGroup.dataset.chartAxisId = String(primaryAxis.id);
  if (primaryAxis) {
    primaryAxisGroup.setAttribute(
      'aria-label',
      `${primaryAxis.title || 'Primary value axis'}: ${
        primaryAxis.seriesNames?.join(', ') || chart.series[0].name
      }; ${formatValue(primary.min, primaryAxis.numberFormat)} to ${formatValue(
        primary.max,
        primaryAxis.numberFormat
      )} by ${formatValue(
        primaryAxis.resolvedScale?.majorUnit ||
          primaryAxis.majorUnit ||
          niceStep(primary.max - primary.min),
        primaryAxis.numberFormat
      )}`
    );
    const tooltip = featheryDoc().createElementNS(SVGNS, 'title');
    tooltip.textContent = primaryAxisGroup.getAttribute('aria-label');
    primaryAxisGroup.appendChild(tooltip);
  }
  g.appendChild(primaryAxisGroup);
  for (const value of primaryTicks) {
    const ratio = (value - primary.min) / (primary.max - primary.min);
    const line = featheryDoc().createElementNS(SVGNS, 'line');
    if (pureBar) {
      const x = plot.left + plot.width * ratio;
      line.setAttribute('x1', String(x));
      line.setAttribute('x2', String(x));
      line.setAttribute('y1', String(plot.top));
      line.setAttribute('y2', String(plot.top + plot.height));
      const label = chartText(
        primaryAxisGroup,
        formatValue(value, primaryAxis?.numberFormat),
        x,
        plot.top + plot.height + fontSize,
        fontSize * 0.72,
        'middle',
        undefined,
        primaryAxis?.style
      );
      label.dataset.chartAxisLabel = 'primary';
      label.dataset.chartAxisValue = String(value);
      if (primaryAxis) label.dataset.chartAxisId = String(primaryAxis.id);
    } else {
      const y = plot.top + plot.height - plot.height * ratio;
      line.setAttribute('x1', String(plot.left));
      line.setAttribute('x2', String(plot.left + plot.width));
      line.setAttribute('y1', String(y));
      line.setAttribute('y2', String(y));
      const label = chartText(
        primaryAxisGroup,
        formatValue(value, primaryAxis?.numberFormat),
        plot.left - fontSize * 0.35,
        y,
        fontSize * 0.72,
        'end',
        undefined,
        primaryAxis?.style
      );
      label.dataset.chartAxisLabel = 'primary';
      label.dataset.chartAxisValue = String(value);
      if (primaryAxis) label.dataset.chartAxisId = String(primaryAxis.id);
    }
    const gridWidth = primaryAxis?.gridlineWidthEMU || 9000;
    line.setAttribute(
      'stroke',
      resolveChartColor(primaryAxis?.gridlineColor, pkg) || '#d9e2f5'
    );
    line.setAttribute('stroke-width', String(gridWidth));
    const gridDash = chartDashArray(primaryAxis?.gridlineDash, gridWidth);
    if (gridDash) line.setAttribute('stroke-dasharray', gridDash);
    if (primaryAxis?.gridlineOpacityPct !== undefined)
      line.setAttribute(
        'stroke-opacity',
        String(primaryAxis.gridlineOpacityPct / 100)
      );
    line.dataset.chartGridline = '';
    line.dataset.chartAxisValue = String(value);
    primaryAxisGroup.appendChild(line);
  }

  if (pureScatter) {
    const xDomain = xDomainFor(lines[0].series);
    for (const value of tickValues(xDomain, xDomain.axis)) {
      const ratio = (value - xDomain.min) / (xDomain.max - xDomain.min);
      const x = plot.left + plot.width * ratio;
      const grid = featheryDoc().createElementNS(SVGNS, 'line');
      grid.setAttribute('x1', String(x));
      grid.setAttribute('x2', String(x));
      grid.setAttribute('y1', String(plot.top));
      grid.setAttribute('y2', String(plot.top + plot.height));
      grid.setAttribute(
        'stroke',
        resolveChartColor(xDomain.axis?.gridlineColor, pkg) || '#d9e2f5'
      );
      grid.setAttribute(
        'stroke-width',
        String(xDomain.axis?.gridlineWidthEMU || 9000)
      );
      if (xDomain.axis?.gridlineColor) g.appendChild(grid);
      const label = chartText(
        g,
        formatValue(value, xDomain.axis?.numberFormat),
        x,
        plot.top + plot.height + fontSize,
        fontSize * 0.72,
        'middle',
        undefined,
        xDomain.axis?.style
      );
      label.dataset.chartAxisLabel = 'scatterX';
    }
  }

  if (columns.length) {
    const groupWidth = plot.width / count;
    const columnPlot = chart.plots.find((item) => item.kind === 'column');
    const stacked =
      columnPlot?.grouping === 'stacked' ||
      columnPlot?.grouping === 'percentStacked';
    const ratio = 100 / (100 + (columnPlot?.gapWidth ?? 150));
    const barWidth = (groupWidth * ratio) / (stacked ? 1 : columns.length);
    const positive = Array(count).fill(0);
    const negative = Array(count).fill(0);
    columns.forEach(({ series, index: seriesIndex }, columnIndex) =>
      series.values.forEach((value, index) => {
        const base = stacked
          ? value >= 0
            ? positive[index]
            : negative[index]
          : 0;
        const end = base + value;
        if (stacked) {
          if (value >= 0) positive[index] = end;
          else negative[index] = end;
        }
        const x =
          plot.left +
          index * groupWidth +
          (groupWidth - barWidth * (stacked ? 1 : columns.length)) / 2 +
          (stacked ? 0 : columnIndex * barWidth);
        const y = Math.min(yFor(series, base), yFor(series, end));
        const height = Math.max(
          1,
          Math.abs(yFor(series, base) - yFor(series, end))
        );
        const rect = featheryDoc().createElementNS(SVGNS, 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(Math.max(1, barWidth - 6000)));
        rect.setAttribute('height', String(height));
        rect.setAttribute(
          'fill',
          resolveChartColor(series.pointColors?.[index], pkg) ||
            colors[seriesIndex]
        );
        const opacity =
          series.pointOpacityPct?.[index] ?? series.fillOpacityPct;
        if (opacity !== undefined)
          rect.setAttribute('fill-opacity', String(opacity / 100));
        rect.dataset.chartMark = 'bar';
        g.appendChild(rect);
        const label = labelValue(series, value, categories[index] || '');
        if (label)
          chartText(
            g,
            label,
            x + barWidth / 2,
            y + height / 2,
            fontSize * 0.68,
            'middle',
            '600',
            series.dataLabels?.style
          );
      })
    );
  }
  if (bars.length) {
    const groupHeight = plot.height / count;
    const barPlot = chart.plots.find((item) => item.kind === 'bar');
    const ratio = 100 / (100 + (barPlot?.gapWidth ?? 150));
    const barHeight = (groupHeight * ratio) / bars.length;
    bars.forEach(({ series, index: seriesIndex }, naturalBarIndex) =>
      series.values.forEach((value, index) => {
        const barIndex = bars.length - 1 - naturalBarIndex;
        const visualIndex = count - 1 - index;
        const y =
          plot.top +
          visualIndex * groupHeight +
          (groupHeight - barHeight * bars.length) / 2 +
          barIndex * barHeight;
        const x0 = xFor(series, 0);
        const xv = xFor(series, value);
        const rect = featheryDoc().createElementNS(SVGNS, 'rect');
        rect.setAttribute('x', String(Math.min(x0, xv)));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(Math.max(1, Math.abs(xv - x0))));
        rect.setAttribute('height', String(Math.max(1, barHeight - 6000)));
        rect.setAttribute(
          'fill',
          resolveChartColor(series.pointColors?.[index], pkg) ||
            colors[seriesIndex]
        );
        const opacity =
          series.pointOpacityPct?.[index] ?? series.fillOpacityPct;
        if (opacity !== undefined)
          rect.setAttribute('fill-opacity', String(opacity / 100));
        rect.dataset.chartMark = 'bar';
        g.appendChild(rect);
        const label = labelValue(series, value, categories[index] || '');
        if (label)
          chartText(
            g,
            label,
            Math.max(x0, xv) + fontSize * 0.18,
            y + barHeight / 2,
            fontSize * 0.68,
            'start',
            undefined,
            series.dataLabels?.style
          );
      })
    );
  }
  lines.forEach(({ series, index: seriesIndex }) => {
    const points = series.values.map((value, index) => {
      const xValues = series.kind === 'scatter' ? series.xValues : undefined;
      const xDomain =
        series.kind === 'scatter' ? xDomainFor(series) : undefined;
      const x =
        xValues?.length && xDomain
          ? plot.left +
            ((xValues[index] - xDomain.min) / (xDomain.max - xDomain.min)) *
              plot.width
          : plot.left + ((index + 0.5) / count) * plot.width;
      return { x, y: yFor(series, value) };
    });
    if (!points.length) return;
    const lineD = `M ${points
      .map((point) => `${point.x} ${point.y}`)
      .join(' L ')}`;
    const seriesPlot = plotFor(seriesIndex);
    const scatterStyle = seriesPlot?.scatterStyle;
    const connectScatter =
      series.lineVisible !== false &&
      (series.kind !== 'scatter' ||
        !scatterStyle ||
        ['line', 'lineMarker', 'smooth', 'smoothMarker'].includes(
          scatterStyle
        ));
    if (series.kind === 'area') {
      const base = yFor(series, 0);
      chartPath(
        g,
        `${lineD} L ${points[points.length - 1].x} ${base} L ${
          points[0].x
        } ${base} Z`,
        colors[seriesIndex],
        'line',
        colors[seriesIndex]
      ).setAttribute('fill-opacity', '.28');
    } else if (connectScatter) {
      const path = chartPath(
        g,
        lineD,
        resolveChartColor(series.lineColor, pkg) || colors[seriesIndex],
        'line'
      );
      if (series.lineWidthEMU)
        path.setAttribute('stroke-width', String(series.lineWidthEMU));
      const dash = chartDashArray(
        series.lineDash,
        series.lineWidthEMU || 18000
      );
      if (dash) path.setAttribute('stroke-dasharray', dash);
      if (series.lineOpacityPct !== undefined)
        path.setAttribute(
          'stroke-opacity',
          String(series.lineOpacityPct / 100)
        );
    }
    const markerFromStyle =
      series.kind === 'scatter' &&
      !!scatterStyle &&
      ['marker', 'lineMarker', 'smoothMarker'].includes(scatterStyle);
    const showMarkers =
      markerFromStyle ||
      (series.marker
        ? series.marker.symbol !== 'none'
        : series.kind === 'line' && seriesPlot?.showMarker !== false);
    if (showMarkers)
      points.forEach((point) => {
        const circle = featheryDoc().createElementNS(SVGNS, 'circle');
        circle.setAttribute('cx', String(point.x));
        circle.setAttribute('cy', String(point.y));
        circle.setAttribute(
          'r',
          String(
            series.marker?.size ? series.marker.size * 6350 : fontSize * 0.16
          )
        );
        circle.setAttribute(
          'fill',
          series.marker?.color || colors[seriesIndex]
        );
        circle.dataset.chartMark = 'point';
        g.appendChild(circle);
      });
  });
  if (pureBar) {
    const groupHeight = plot.height / count;
    const categoryAxis = chart.axes.find((axis) => axis.type === 'category');
    categories
      .slice(0, count)
      .forEach((category, index) =>
        chartText(
          g,
          category,
          plot.left - fontSize * 0.35,
          plot.top + (count - index - 0.5) * groupHeight,
          fontSize * 0.72,
          'end',
          undefined,
          categoryAxis?.style
        )
      );
  } else if (!pureScatter) {
    const categoryAxis = chart.axes.find((axis) => axis.type === 'category');
    categories
      .slice(0, count)
      .forEach((category, index) =>
        chartText(
          g,
          category,
          plot.left + ((index + 0.5) / count) * plot.width,
          plot.top + plot.height + fontSize,
          fontSize * 0.72,
          'middle',
          undefined,
          categoryAxis?.style
        )
      );
  }

  // Secondary value axes (used by slide 10's line series).
  const secondaryAxes = chart.axes.filter(
    (axis) =>
      axis.type === 'value' &&
      !axis.deleted &&
      axis.id !== primaryAxis?.id &&
      axis.position === 'r'
  );
  for (const axis of secondaryAxes) {
    const series = chart.series.find(
      (candidate) => axisFor(candidate)?.id === axis.id
    );
    if (!series) continue;
    const domain = domainFor(series);
    const axisGroup = featheryDoc().createElementNS(SVGNS, 'g');
    axisGroup.dataset.chartAxisGroup = 'secondary';
    axisGroup.dataset.chartAxisId = String(axis.id);
    axisGroup.setAttribute(
      'aria-label',
      `${axis.title || 'Secondary Y axis'}: ${
        axis.seriesNames?.join(', ') || series.name
      }; ${formatValue(domain.min, axis.numberFormat)} to ${formatValue(
        domain.max,
        axis.numberFormat
      )} by ${formatValue(
        axis.resolvedScale?.majorUnit ||
          axis.majorUnit ||
          niceStep(domain.max - domain.min, 10),
        axis.numberFormat
      )}`
    );
    const tooltip = featheryDoc().createElementNS(SVGNS, 'title');
    tooltip.textContent = axisGroup.getAttribute('aria-label');
    axisGroup.appendChild(tooltip);
    g.appendChild(axisGroup);
    for (const value of tickValues(domain, axis)) {
      const ratio = (value - domain.min) / (domain.max - domain.min);
      const y = plot.top + plot.height - plot.height * ratio;
      const tickGroup = featheryDoc().createElementNS(SVGNS, 'g');
      tickGroup.setAttribute(
        'transform',
        `translate(${plot.left + plot.width} ${y})`
      );
      tickGroup.dataset.chartAxisValue = String(value);
      axisGroup.appendChild(tickGroup);
      if (axis.majorTickMark && axis.majorTickMark !== 'none') {
        const tick = featheryDoc().createElementNS(SVGNS, 'line');
        tick.setAttribute('x1', '0');
        tick.setAttribute('x2', String(fontSize * 0.14));
        tick.setAttribute('y1', '0');
        tick.setAttribute('y2', '0');
        tick.setAttribute(
          'stroke',
          resolveChartColor(axis.lineColor, pkg) || '#888888'
        );
        tick.setAttribute('stroke-width', String(axis.lineWidthEMU || 12700));
        tick.dataset.chartAxisTick = 'secondary';
        tick.dataset.chartAxisValue = String(value);
        tickGroup.appendChild(tick);
      }
      const label = chartText(
        tickGroup,
        formatValue(value, axis.numberFormat),
        fontSize * 0.35,
        0,
        fontSize * 0.72,
        'start',
        undefined,
        axis.style
      );
      label.dataset.chartAxisLabel = 'secondary';
      label.dataset.chartAxisId = String(axis.id);
      label.dataset.chartAxisValue = String(value);
    }
    const axisLine = featheryDoc().createElementNS(SVGNS, 'line');
    axisLine.setAttribute('x1', String(plot.left + plot.width));
    axisLine.setAttribute('x2', String(plot.left + plot.width));
    axisLine.setAttribute('y1', String(plot.top));
    axisLine.setAttribute('y2', String(plot.top + plot.height));
    const axisWidth = axis.lineWidthEMU || 12700;
    axisLine.setAttribute(
      'stroke',
      resolveChartColor(axis.lineColor, pkg) || '#888888'
    );
    axisLine.setAttribute('stroke-width', String(axisWidth));
    const axisDash = chartDashArray(axis.lineDash, axisWidth);
    if (axisDash) axisLine.setAttribute('stroke-dasharray', axisDash);
    if (axis.lineOpacityPct !== undefined)
      axisLine.setAttribute(
        'stroke-opacity',
        String(axis.lineOpacityPct / 100)
      );
    axisLine.dataset.chartAxis = 'secondary';
    axisLine.dataset.chartAxisId = String(axis.id);
    axisGroup.appendChild(axisLine);
  }
  const categoryAxis = chart.axes.find(
    (axis) => axis.type === 'category' && !axis.deleted
  );
  const horizontalAxis = featheryDoc().createElementNS(SVGNS, 'line');
  horizontalAxis.setAttribute('x1', String(plot.left));
  horizontalAxis.setAttribute('x2', String(plot.left + plot.width));
  horizontalAxis.setAttribute('y1', String(plot.top + plot.height));
  horizontalAxis.setAttribute('y2', String(plot.top + plot.height));
  const horizontalStyle = pureScatter
    ? xAxisFor(lines[0].series)
    : pureBar
    ? primaryAxis
    : categoryAxis;
  horizontalAxis.setAttribute(
    'stroke',
    resolveChartColor(horizontalStyle?.lineColor, pkg) || '#888888'
  );
  horizontalAxis.setAttribute(
    'stroke-width',
    String(horizontalStyle?.lineWidthEMU || 12700)
  );
  horizontalAxis.dataset.chartAxis = 'horizontal';
  g.appendChild(horizontalAxis);
  const verticalAxis = featheryDoc().createElementNS(SVGNS, 'line');
  verticalAxis.setAttribute('x1', String(plot.left));
  verticalAxis.setAttribute('x2', String(plot.left));
  verticalAxis.setAttribute('y1', String(plot.top));
  verticalAxis.setAttribute('y2', String(plot.top + plot.height));
  const verticalStyle = pureBar ? categoryAxis : primaryAxis;
  verticalAxis.setAttribute(
    'stroke',
    resolveChartColor(verticalStyle?.lineColor, pkg) || '#888888'
  );
  verticalAxis.setAttribute(
    'stroke-width',
    String(verticalStyle?.lineWidthEMU || 12700)
  );
  verticalAxis.dataset.chartAxis = 'vertical';
  g.appendChild(verticalAxis);

  if (chart.axisTitles.horizontal) {
    const axis = chart.axes.find(
      (candidate) => candidate.title === chart.axisTitles.horizontal
    );
    const text = chartText(
      g,
      chart.axisTitles.horizontal,
      plot.left + plot.width / 2,
      plot.top + plot.height + fontSize * 2.05,
      fontSize * 0.82,
      'middle',
      undefined,
      axis?.titleStyle
    );
    text.dataset.chartAxisTitle = 'horizontal';
  }
  if (chart.axisTitles.vertical) {
    const x =
      legendPosition === 'l' ? legendWidth + fontSize * 0.65 : fontSize * 0.65;
    const y = plot.top + plot.height / 2;
    const axis = chart.axes.find(
      (candidate) => candidate.title === chart.axisTitles.vertical
    );
    const text = chartText(
      g,
      chart.axisTitles.vertical,
      x,
      y,
      fontSize * 0.82,
      'middle',
      undefined,
      axis?.titleStyle
    );
    text.setAttribute(
      'transform',
      `translate(${x} ${y}) rotate(-90) scale(${EMU_PER_PX})`
    );
    text.dataset.chartAxisTitle = 'vertical';
  }
  if (chart.axisTitles.secondaryVertical) {
    const x = plot.left + plot.width + fontSize * 2.05;
    const y = plot.top + plot.height / 2;
    const axis = chart.axes.find(
      (candidate) => candidate.title === chart.axisTitles.secondaryVertical
    );
    const text = chartText(
      g,
      chart.axisTitles.secondaryVertical,
      x,
      y,
      fontSize * 0.82,
      'middle',
      undefined,
      axis?.titleStyle
    );
    text.setAttribute(
      'transform',
      `translate(${x} ${y}) rotate(90) scale(${EMU_PER_PX})`
    );
    text.dataset.chartAxisTitle = 'secondaryVertical';
    if (axis) text.dataset.chartAxisId = String(axis.id);
  }
  renderLegend(
    chart.series.map((series, index) => ({
      label: series.name,
      color: colors[index]
    }))
  );
}

function chartGroup(
  shape: Shape,
  pkg: OPCPackage,
  w: number,
  h: number
): SVGGElement {
  const g = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
  g.dataset.chart = '';
  const chart = shape.chartPart ? readChartData(pkg, shape.chartPart) : null;
  const background = featheryDoc().createElementNS(SVGNS, 'rect');
  background.setAttribute('width', String(w));
  background.setAttribute('height', String(h));
  const chartFill = chart?.chartAreaStyle;
  background.setAttribute(
    'fill',
    chartFill?.noFill
      ? 'none'
      : resolveChartColor(chartFill?.fillColor, pkg) || '#ffffff'
  );
  if (chartFill?.fillOpacityPct !== undefined)
    background.setAttribute(
      'fill-opacity',
      String(chartFill.fillOpacityPct / 100)
    );
  if (chartFill?.lineColor) {
    background.setAttribute(
      'stroke',
      resolveChartColor(chartFill.lineColor, pkg) || 'none'
    );
    background.setAttribute(
      'stroke-width',
      String(chartFill.lineWidthEMU || 9525)
    );
  }
  g.appendChild(background);
  if (!chart || chart.kind === 'unsupported') {
    const border = featheryDoc().createElementNS(SVGNS, 'rect');
    border.setAttribute('width', String(w));
    border.setAttribute('height', String(h));
    border.setAttribute('fill', 'none');
    border.setAttribute('stroke', '#8c96aa');
    border.setAttribute('stroke-width', '12700');
    g.appendChild(border);
    chartText(
      g,
      chart?.title || 'Unsupported chart',
      w / 2,
      h / 2,
      Math.min(w, h) / 12,
      'middle'
    );
    return g;
  }
  g.dataset.chartType = chart.kind;
  renderChartMarks(g, chart, w, h, pkg);
  return g;
}

// ---- shape -> <g> ----
const packageImageUrls = new WeakMap<OPCPackage, Map<string, string>>();

function packageImageUrl(
  pkg: OPCPackage,
  target: string,
  bytes: Uint8Array
): string | undefined {
  if (typeof URL === 'undefined' || !URL.createObjectURL) return undefined;
  let urls = packageImageUrls.get(pkg);
  if (!urls) {
    urls = new Map();
    packageImageUrls.set(pkg, urls);
  }
  const existing = urls.get(target);
  if (existing) return existing;
  const source = trackObjectUrl(
    pkg,
    URL.createObjectURL(
      new Blob([bytes as BlobPart], { type: mimeFor(target) })
    )
  );
  urls.set(target, source);
  return source;
}

function embeddedImageUrl(
  pkg: OPCPackage,
  ownerPart: string,
  node: ONode
): string | undefined {
  const blip = descendant(node, 'a:blip');
  const rid = blip && getAttr(blip, 'r:embed');
  const target = rid ? pkg.relTarget(ownerPart, rid) : undefined;
  const bytes = target && pkg.binary(target);
  if (!bytes || !target) return undefined;
  return packageImageUrl(pkg, target, bytes);
}

function shapeGroup(
  shape: Shape,
  pkg: OPCPackage,
  defs: SVGDefsElement,
  idx: number | string
): SVGGElement | null {
  if (!shape.xfrm) return null;
  const { x, y, cx, cy, rot, flipH, flipV } = shape.xfrm;
  const g = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
  const transforms = [`translate(${x} ${y})`];
  if (rot) transforms.push(`rotate(${rot} ${cx / 2} ${cy / 2})`);
  if (flipH || flipV)
    transforms.push(
      `translate(${flipH ? cx : 0} ${flipV ? cy : 0}) scale(${flipH ? -1 : 1} ${
        flipV ? -1 : 1
      })`
    );
  g.setAttribute('transform', transforms.join(' '));
  g.dataset.shapeId = shape.id;

  if (shape.type === 'pic' && shape.imageSrc) {
    const clip = featheryDoc().createElementNS(SVGNS, 'clipPath');
    const clipId = `${defsIdPrefix(defs)}picture-clip-${shape.id}-${idx}`;
    clip.setAttribute('id', clipId);
    clip.appendChild(geometryEl(shape, cx, cy, '#ffffff', undefined, 0));
    // Keep the referenced definition mounted while changing crop geometry. A
    // remove/append cycle can briefly invalidate url(#clipId) in the browser.
    upsertDefinition(defs, clip);
    const picture = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
    picture.setAttribute('clip-path', `url(#${clipId})`);
    const img = featheryDoc().createElementNS(SVGNS, 'image');
    const blipFill = child(shape.node, 'p:blipFill');
    const crop = blipFill && child(blipFill, 'a:srcRect');
    const fraction = (name: string) =>
      Math.max(
        0,
        Math.min(0.999, Number(crop && getAttr(crop, name)) / 100000 || 0)
      );
    const left = fraction('l');
    const top = fraction('t');
    const right = fraction('r');
    const bottom = fraction('b');
    const visibleW = Math.max(0.001, 1 - left - right);
    const visibleH = Math.max(0.001, 1 - top - bottom);
    img.setAttribute('x', String((-cx * left) / visibleW));
    img.setAttribute('y', String((-cy * top) / visibleH));
    img.setAttribute('width', String(cx / visibleW));
    img.setAttribute('height', String(cy / visibleH));
    img.setAttribute('href', shape.imageSrc);
    img.setAttribute('preserveAspectRatio', 'none');
    const alpha = blipFill && descendant(blipFill, 'a:alphaModFix');
    if (alpha)
      img.setAttribute(
        'opacity',
        String(Number(getAttr(alpha, 'amt')) / 100000)
      );
    picture.appendChild(img);
    g.appendChild(picture);
  } else if (
    shape.type === 'text' ||
    shape.type === 'shape' ||
    shape.type === 'connector'
  ) {
    const fill = shapeFill(shape, pkg, defs, `${shape.id}-${idx}`);
    const st = shapeStroke(shape, pkg);
    if (fill !== 'none' || st.color) {
      const geometry = geometryEl(shape, cx, cy, fill, st.color, st.width);
      const opacity = shapeFillOpacity(shape);
      if (opacity !== undefined)
        geometry.setAttribute('fill-opacity', String(opacity));
      applyLineStyle(geometry, st, defs, `${shape.id}-${idx}`);
      applyOuterShadow(geometry, shape, pkg, defs, `${shape.id}-${idx}`);
      g.appendChild(geometry);
    }
    const fo = textForeign(shape, cx, cy);
    if (fo) g.appendChild(fo);
  } else if (shape.type === 'group') {
    const groupXfrm = shape.spPr && child(shape.spPr, 'a:xfrm');
    const chOff = groupXfrm && child(groupXfrm, 'a:chOff');
    const chExt = groupXfrm && child(groupXfrm, 'a:chExt');
    const childX = Number(chOff && getAttr(chOff, 'x')) || 0;
    const childY = Number(chOff && getAttr(chOff, 'y')) || 0;
    const childW = Number(chExt && getAttr(chExt, 'cx')) || cx;
    const childH = Number(chExt && getAttr(chExt, 'cy')) || cy;
    const content = featheryDoc().createElementNS(SVGNS, 'g') as SVGGElement;
    content.setAttribute(
      'transform',
      `scale(${cx / childW} ${cy / childH}) translate(${-childX} ${-childY})`
    );
    const ownerPart = curSlide?.path || '';
    let childIndex = 0;
    for (const node of childrenOf(shape.node)) {
      const nested = readShapeNode(node, {
        imageSrc: (picture) => embeddedImageUrl(pkg, ownerPart, picture),
        relatedPart: (relationshipId) =>
          pkg.relTarget(ownerPart, relationshipId)
      });
      if (!nested) continue;
      const nestedGroup = shapeGroup(
        nested,
        pkg,
        defs,
        `${idx}-${childIndex++}`
      );
      if (nestedGroup) content.appendChild(nestedGroup);
    }
    g.appendChild(content);
  } else if (shape.type === 'table') {
    g.appendChild(tableGroup(shape, pkg));
  } else if (shape.type === 'chart') {
    g.appendChild(chartGroup(shape, pkg, cx, cy));
  } else {
    // Group and other unsupported graphic frames remain visible/selectable.
    const r = featheryDoc().createElementNS(SVGNS, 'rect');
    r.setAttribute('width', String(cx));
    r.setAttribute('height', String(cy));
    r.setAttribute('fill', 'rgba(140,150,170,0.08)');
    r.setAttribute('stroke', '#8c96aa');
    r.setAttribute('stroke-width', '12700');
    r.setAttribute('stroke-dasharray', '60000 40000');
    g.appendChild(r);
  }
  return g;
}

// ---- slide background (slide -> layout -> master inheritance) ----
function mimeFor(path: string): string {
  const ext = (path.split('.').pop() || 'png').toLowerCase();
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'gif'
    ? 'image/gif'
    : ext === 'svg'
    ? 'image/svg+xml'
    : 'image/png';
}

/** Find the first <p:bg> walking slide -> layout -> master, with its owning part. */
function backgroundNode(
  deck: Deck,
  slide: Slide
): { bg: ONode; part: string } | null {
  const pkg = deck.pkg;
  const chain = [slide.path];
  const layout = pkg.layoutFor(slide.path);
  if (layout) chain.push(layout);
  const master = layout && pkg.masterFor(layout);
  if (master) chain.push(master);
  for (const part of chain) {
    if (!pkg.hasPart(part)) continue;
    const cSld = child(xmlRoot(pkg.tree(part)), 'p:cSld');
    const bg = cSld && child(cSld, 'p:bg');
    if (bg) return { bg, part };
  }
  return null;
}

function renderBackground(
  deck: Deck,
  slide: Slide,
  defs: SVGDefsElement
): SVGElement | null {
  const found = backgroundNode(deck, slide);
  if (!found) return null;
  const { bg, part } = found;
  const pkg = deck.pkg;
  const { cx: w, cy: h } = effectiveSlideSize(deck, slide);
  const rect = (paint: string) => {
    const r = featheryDoc().createElementNS(SVGNS, 'rect');
    r.setAttribute('x', '0');
    r.setAttribute('y', '0');
    r.setAttribute('width', String(w));
    r.setAttribute('height', String(h));
    r.setAttribute('fill', paint);
    return r;
  };

  const bgPr = child(bg, 'p:bgPr');
  const bgRef = child(bg, 'p:bgRef'); // theme fill-style reference + color
  if (bgPr) {
    if (child(bgPr, 'a:noFill')) return null;
    const blip = child(bgPr, 'a:blipFill');
    if (blip) {
      const b = descendant(blip, 'a:blip');
      const rid = b && getAttr(b, 'r:embed');
      const target = rid ? pkg.relTarget(part, rid) : undefined;
      const bytes = target && pkg.binary(target);
      if (bytes && target) {
        const source = packageImageUrl(pkg, target, bytes);
        if (!source) return null;
        const img = featheryDoc().createElementNS(SVGNS, 'image');
        img.setAttribute('x', '0');
        img.setAttribute('y', '0');
        img.setAttribute('width', String(w));
        img.setAttribute('height', String(h));
        img.setAttribute('href', source);
        img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        return img;
      }
    }
    const paint = fillPaint(
      bgPr,
      pkg,
      defs,
      undefined,
      'slide-background-gradient'
    );
    return paint === 'none' ? null : rect(paint);
  }
  if (bgRef) {
    // bgRef points at a theme fill style (solid or gradient) and supplies the phClr.
    const phClr = resolveColor(bgRef, pkg);
    const idx = Number(getAttr(bgRef, 'idx')) || 0;
    const fillEl = themeFillStyle(pkg, part, idx);
    const paint = paintFromFillElement(
      fillEl,
      pkg,
      defs,
      phClr,
      'slide-background-gradient'
    );
    if (paint !== 'none') return rect(paint);
    if (phClr) return rect(phClr); // fallback: flat placeholder color
  }
  return null;
}

/** The theme fill-style element referenced by a bgRef idx (fillStyleLst 1-999, bgFillStyleLst 1001+). */
function themeFillStyle(
  pkg: OPCPackage,
  ownerPart: string,
  idx: number
): ONode | undefined {
  if (!idx) return undefined;
  const themePart =
    pkg.relTargetByType(ownerPart, 'theme') || 'ppt/theme/theme1.xml';
  if (!pkg.hasPart(themePart)) return undefined;
  const fmt = descendant(xmlRoot(pkg.tree(themePart)), 'a:fmtScheme');
  if (!fmt) return undefined;
  if (idx >= 1001)
    return childrenOf(child(fmt, 'a:bgFillStyleLst') || {})[idx - 1001];
  return childrenOf(child(fmt, 'a:fillStyleLst') || {})[idx - 1];
}

/** Render a whole slide to an <svg> element sized to the slide's EMU box. */
export function renderSlideSvg(deck: Deck, slide: Slide): SVGSVGElement {
  setRenderContext(deck, slide);
  try {
    const svg = featheryDoc().createElementNS(SVGNS, 'svg') as SVGSVGElement;
    svg.dataset.svgUid = `p${svgSeq++}-`;
    const size = effectiveSlideSize(deck, slide);
    svg.setAttribute('viewBox', `0 0 ${size.cx} ${size.cy}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.background = '#ffffff';
    svg.style.display = 'block';
    const defs = featheryDoc().createElementNS(SVGNS, 'defs') as SVGDefsElement;
    svg.appendChild(defs);
    const bg = renderBackground(deck, slide, defs);
    if (bg) {
      bg.setAttribute('data-slide-background', '');
      svg.appendChild(bg);
    }
    slide.shapes.forEach((shape, i) => {
      const g = shapeGroup(shape, deck.pkg, defs, i);
      if (g) svg.appendChild(g);
    });
    return svg;
  } finally {
    clearRenderContext();
  }
}

function sameDomKind(current: Node, next: Node): boolean {
  if (current.nodeType !== next.nodeType) return false;
  if (!(current instanceof Element) || !(next instanceof Element)) return true;
  return (
    current.namespaceURI === next.namespaceURI &&
    current.localName === next.localName
  );
}

/** Morph a freshly rendered subtree into the mounted one. Keeping the outer
 * shape/foreignObject nodes mounted avoids a browser paint gap during history
 * navigation while still allowing runs, rows, and other descendants to change. */
function patchDomNode(current: Node, next: Node): Node {
  if (!sameDomKind(current, next)) {
    current.parentNode?.replaceChild(next, current);
    return next;
  }
  if (!(current instanceof Element) || !(next instanceof Element)) {
    if (current.nodeValue !== next.nodeValue)
      current.nodeValue = next.nodeValue;
    return current;
  }

  const attrKey = (attr: Attr) =>
    `${attr.namespaceURI || ''}\0${attr.localName}`;
  const desiredAttrs = new Map(
    [...next.attributes].map((attr) => [attrKey(attr), attr])
  );
  for (const attr of [...current.attributes]) {
    if (!desiredAttrs.has(attrKey(attr))) {
      if (attr.namespaceURI)
        current.removeAttributeNS(attr.namespaceURI, attr.localName);
      else current.removeAttribute(attr.name);
    }
  }
  for (const attr of desiredAttrs.values()) {
    const value = attr.namespaceURI
      ? current.getAttributeNS(attr.namespaceURI, attr.localName)
      : current.getAttribute(attr.name);
    if (value === attr.value) continue;
    if (attr.namespaceURI)
      current.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    else current.setAttribute(attr.name, attr.value);
  }

  const desiredChildren = [...next.childNodes];
  for (let index = 0; index < desiredChildren.length; index++) {
    const mounted = current.childNodes[index];
    if (mounted) patchDomNode(mounted, desiredChildren[index]);
    else current.appendChild(desiredChildren[index]);
  }
  while (
    current.childNodes.length > desiredChildren.length &&
    current.lastChild
  )
    current.removeChild(current.lastChild);
  return current;
}

// Re-render ONE shape's <g> in place inside an already-rendered <svg>, reusing its
// <defs>. Morphing the mounted group avoids a paint gap and preserves already
// decoded images and laid-out foreignObject text whenever their nodes still match.
export function rerenderShape(
  deck: Deck,
  slide: Slide,
  shapeId: string,
  svg: SVGSVGElement
): void {
  const idx = slide.shapes.findIndex((s) => s.id === shapeId);
  if (idx < 0) return;
  setRenderContext(deck, slide);
  try {
    let defs = svg.querySelector('defs') as SVGDefsElement | null;
    if (!defs) {
      defs = featheryDoc().createElementNS(SVGNS, 'defs') as SVGDefsElement;
      svg.insertBefore(defs, svg.firstChild);
    }
    const newG = shapeGroup(slide.shapes[idx], deck.pkg, defs, idx);
    const oldG = svg.querySelector(`[data-shape-id="${shapeId}"]`);
    if (oldG && newG) patchDomNode(oldG, newG);
    else if (oldG && !newG) oldG.remove();
    else if (newG) svg.appendChild(newG);
  } finally {
    clearRenderContext();
  }
}

/** Update only the background, leaving shape and text DOM mounted. */
export function rerenderBackground(
  deck: Deck,
  slide: Slide,
  svg: SVGSVGElement
): void {
  setRenderContext(deck, slide);
  try {
    const defs = svg.querySelector('defs') as SVGDefsElement;
    const old = svg.querySelector('[data-slide-background]');
    const next = renderBackground(deck, slide, defs);
    if (next) {
      next.setAttribute('data-slide-background', '');
      if (old) patchDomNode(old, next);
      else defs.after(next);
    } else old?.remove();
  } finally {
    clearRenderContext();
  }
}

/** Reconcile shape additions, deletions, and ordering without replacing the slide SVG. */
export function syncShapeOrder(slide: Slide, svg: SVGSVGElement): void {
  const ids = new Set(slide.shapes.map((s) => s.id));
  [...svg.children]
    .filter((el) => (el as SVGGElement).dataset?.shapeId)
    .forEach((g) => {
      if (!ids.has((g as SVGGElement).dataset.shapeId || '')) g.remove();
    });
  let previous: Element =
    svg.querySelector('[data-slide-background]') || svg.querySelector('defs')!;
  for (const shape of slide.shapes) {
    const g = [...svg.children].find(
      (el) => (el as SVGGElement).dataset?.shapeId === shape.id
    );
    if (!g) continue;
    if (g.previousElementSibling !== previous)
      svg.insertBefore(g, previous.nextElementSibling);
    previous = g;
  }
}

export interface SvgSlideReconcileOptions {
  shapeIds?: string[];
  background?: boolean;
  structure?: boolean;
  slideSize?: boolean;
  fullContent?: boolean;
}

/** Apply a restored model state to an existing slide SVG without unmounting it. */
export function reconcileSlideSvg(
  deck: Deck,
  slide: Slide,
  svg: SVGSVGElement,
  change: SvgSlideReconcileOptions
): void {
  if (change.slideSize) {
    const size = effectiveSlideSize(deck, slide);
    svg.setAttribute('viewBox', `0 0 ${size.cx} ${size.cy}`);
  }
  if (change.background || change.fullContent)
    rerenderBackground(deck, slide, svg);
  const ids = change.fullContent
    ? slide.shapes.map((shape) => shape.id)
    : change.shapeIds || [];
  for (const id of new Set(ids)) rerenderShape(deck, slide, id, svg);
  if (change.structure || change.fullContent) syncShapeOrder(slide, svg);
}
