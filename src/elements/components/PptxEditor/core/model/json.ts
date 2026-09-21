// A clean, serializable JSON view of the deck. Text is a typed subset of OOXML,
// with the raw XML tree remaining authoritative for unmodeled properties.
// Unlike the live model (which holds raw ONode references), this is plain data:
// safe to JSON.stringify, log, diff, or hand to a binding layer later.

import {
  child,
  children,
  childrenOf,
  descendant,
  getAttr,
  root as xmlRoot,
  tagOf,
  type ONode
} from '../opc/xml';
import {
  readBodyProps,
  readParagraphPr,
  readParagraphProps,
  type BodyProps,
  type ParagraphProps
} from './textLayout';
import {
  tableCellAlign,
  tableCellBorderEdge,
  tableCellFill,
  tableCellGridSpan,
  tableCellIsMergeContinuation,
  tableCellRowSpan,
  tableCellText,
  tableCellVerticalAlign,
  tableCells,
  tableColumns,
  tableRows
} from './table';
import type { Deck, Slide, Shape } from './types';
import { effectiveSlideSize } from './slideSize';
import { readChartData, type ChartData } from './chart';
import { readShapeNode } from './read';

export interface RunPropsJSON {
  letterSpacingPt?: number;
  kerningPt?: number;
  baselinePct?: number;
  caps?: string;
  language?: string;
  fonts?: { latin?: string; ea?: string; cs?: string; sym?: string };
  hyperlink?: { relId?: string; action?: string; tooltip?: string };
}
export interface RunJSON {
  node: 'run' | 'field' | 'break';
  text?: string;
  id?: string;
  fieldType?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sizePt?: number;
  color?: string;
  highlight?: string;
  baselinePct?: number;
  font?: string;
  props?: RunPropsJSON;
}
export interface ParagraphJSON {
  align?: string;
  props?: ParagraphProps;
  bullet?: {
    kind: string;
    char?: string;
    scheme?: string;
    startAt?: number;
    font?: string;
    sizePct?: number;
    color?: string;
  };
  runs: RunJSON[];
  endRunProps?: RunPropsJSON;
}
export interface TableJSON {
  columns: { widthEMU: number }[];
  rows: {
    heightEMU: number;
    cells: {
      columnIndex: number;
      text: string;
      align: string;
      verticalAlign: string;
      fill?: string;
      gridSpan: number;
      rowSpan: number;
      mergeContinuation: boolean;
      borders: Record<
        'left' | 'top' | 'right' | 'bottom',
        { color?: string; widthEMU: number; dash: string; none: boolean }
      >;
      paragraphs: ParagraphJSON[];
    }[];
  }[];
}
export interface ShapeJSON {
  id: string;
  name: string;
  type: Shape['type'];
  frameEMU: {
    x: number;
    y: number;
    cx: number;
    cy: number;
    rot: number;
    flipH: boolean;
    flipV: boolean;
  } | null;
  geom?: string;
  fill?: string;
  image?: boolean;
  picture?: {
    cropPct: { left: number; top: number; right: number; bottom: number };
    clipGeometry: string;
    opacityPct?: number;
  };
  table?: TableJSON;
  chart?: ChartData;
  style?: {
    fill: {
      type: 'none' | 'solid' | 'gradient' | 'pattern' | 'image' | 'inherit';
      color?: string;
      opacityPct?: number;
      angleDeg?: number;
      stops?: { posPct: number; color?: string; opacityPct?: number }[];
    };
    line?: {
      color?: string;
      opacityPct?: number;
      widthEMU: number;
      dash: string;
      cap?: string;
      compound?: string;
      alignment?: string;
      head?: string;
      headWidth?: string;
      headLength?: string;
      tail?: string;
      tailWidth?: string;
      tailLength?: string;
    };
    outerShadow?: {
      color?: string;
      blurEMU: number;
      distanceEMU: number;
      directionDeg: number;
      opacityPct?: number;
    };
    customGeometry: boolean;
  };
  children?: ShapeJSON[];
  text?: {
    bodyPr: BodyProps;
    listStyle?: {
      levels: (ParagraphProps & { bullet?: ParagraphJSON['bullet'] })[];
    };
    paragraphs: ParagraphJSON[];
  };
}
export type BackgroundJSON =
  | { type: 'solid'; color?: string }
  | { type: 'gradient'; stops: { posPct: number; color?: string }[] }
  | { type: 'image' }
  | { type: 'themeRef'; idx: number; color?: string }
  | { type: 'none' }
  | { type: 'inherit' };
export interface SlideJSON {
  index: number;
  path: string;
  sizeEMU: { cx: number; cy: number };
  sizeInches: { w: number; h: number };
  background: BackgroundJSON;
  shapes: ShapeJSON[];
}
export interface DeckJSON {
  sizeEMU: { cx: number; cy: number };
  sizeInches: { w: number; h: number };
  slideCount: number;
  slides: SlideJSON[];
}

function colorOf(parent: ONode | undefined): string | undefined {
  if (!parent) return undefined;
  const srgb = child(parent, 'a:srgbClr');
  if (srgb) return `#${getAttr(srgb, 'val')}`;
  const scheme = child(parent, 'a:schemeClr');
  if (scheme) return `scheme:${getAttr(scheme, 'val')}`;
  return undefined;
}

const numberAttr = (
  node: ONode | undefined,
  name: string
): number | undefined => {
  const value = node && getAttr(node, name);
  return value === undefined ? undefined : Number(value);
};

function runPropsJSON(rPr: ONode | undefined): RunPropsJSON | undefined {
  if (!rPr) return undefined;
  const font = (tag: string) => {
    const n = child(rPr, tag);
    return n ? getAttr(n, 'typeface') : undefined;
  };
  const fonts = {
    latin: font('a:latin'),
    ea: font('a:ea'),
    cs: font('a:cs'),
    sym: font('a:sym')
  };
  const link = child(rPr, 'a:hlinkClick');
  return {
    letterSpacingPt:
      numberAttr(rPr, 'spc') === undefined
        ? undefined
        : numberAttr(rPr, 'spc')! / 100,
    kerningPt:
      numberAttr(rPr, 'kern') === undefined
        ? undefined
        : numberAttr(rPr, 'kern')! / 100,
    baselinePct:
      numberAttr(rPr, 'baseline') === undefined
        ? undefined
        : numberAttr(rPr, 'baseline')! / 1000,
    caps: getAttr(rPr, 'cap'),
    language: getAttr(rPr, 'lang'),
    fonts: Object.values(fonts).some(Boolean) ? fonts : undefined,
    hyperlink: link
      ? {
          relId: getAttr(link, 'r:id'),
          action: getAttr(link, 'action'),
          tooltip: getAttr(link, 'tooltip')
        }
      : undefined
  };
}

function bulletJSON(pPr: ONode | undefined): ParagraphJSON['bullet'] {
  if (!pPr) return undefined;
  if (child(pPr, 'a:buNone')) return { kind: 'none' };
  const char = child(pPr, 'a:buChar');
  const auto = child(pPr, 'a:buAutoNum');
  if (!char && !auto) return undefined;
  const font = child(pPr, 'a:buFont');
  const size = child(pPr, 'a:buSzPct');
  const color = child(pPr, 'a:buClr');
  return {
    kind: char ? 'char' : 'autoNum',
    char: char
      ? (getAttr(char, 'char') || '')
          .replace(/&#x([0-9a-f]+);/gi, (_, value) =>
            String.fromCodePoint(parseInt(value, 16))
          )
          .replace(/&#([0-9]+);/g, (_, value) =>
            String.fromCodePoint(parseInt(value, 10))
          )
      : undefined,
    scheme: auto ? getAttr(auto, 'type') : undefined,
    startAt: numberAttr(auto, 'startAt'),
    font: font ? getAttr(font, 'typeface') : undefined,
    sizePct: size ? numberAttr(size, 'val')! / 1000 : undefined,
    color: colorOf(color)
  };
}

function runJSON(
  node: ONode,
  run:
    | NonNullable<Shape['text']>['paragraphs'][number]['runs'][number]
    | undefined
): RunJSON {
  const tag = tagOf(node);
  const rPr = child(node, 'a:rPr');
  return {
    node: tag === 'a:fld' ? 'field' : tag === 'a:br' ? 'break' : 'run',
    text:
      run?.text ??
      (child(node, 'a:t')
        ? childrenOf(child(node, 'a:t')!)
            .map((entry) => entry['#text'] ?? '')
            .join('')
        : tag === 'a:br'
        ? '\n'
        : undefined),
    id: tag === 'a:fld' ? getAttr(node, 'id') : undefined,
    fieldType: tag === 'a:fld' ? getAttr(node, 'type') : undefined,
    bold: run?.bold,
    italic: run?.italic,
    underline: run?.underline,
    strike: run?.strike,
    sizePt: run?.sizePt,
    color: run?.color ? `#${run.color}` : undefined,
    highlight: run?.highlight ? `#${run.highlight}` : undefined,
    baselinePct: run?.baselinePct,
    font: run?.font,
    props: runPropsJSON(rPr)
  };
}

function listStyleJSON(
  txBody: ONode
): NonNullable<ShapeJSON['text']>['listStyle'] {
  const list = child(txBody, 'a:lstStyle');
  if (!list) return undefined;
  const levels = Array.from({ length: 9 }, (_, index) => {
    const node = child(list, `a:lvl${index + 1}pPr`);
    if (!node) return {};
    return { ...readParagraphPr(node), bullet: bulletJSON(node) };
  });
  return levels.some((level) => Object.keys(level).length)
    ? { levels }
    : undefined;
}

function backgroundJSON(deck: Deck, slide: Slide): BackgroundJSON {
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
    if (!bg) continue;
    const bgPr = child(bg, 'p:bgPr');
    const bgRef = child(bg, 'p:bgRef');
    if (bgPr) {
      if (child(bgPr, 'a:noFill')) return { type: 'none' };
      if (child(bgPr, 'a:blipFill')) return { type: 'image' };
      const solid = child(bgPr, 'a:solidFill');
      if (solid) return { type: 'solid', color: colorOf(solid) };
      const grad = child(bgPr, 'a:gradFill');
      if (grad) {
        const lst = child(grad, 'a:gsLst');
        return {
          type: 'gradient',
          stops: children(lst || grad, 'a:gs').map((gs) => ({
            posPct: Number(getAttr(gs, 'pos')) / 1000,
            color: colorOf(gs)
          }))
        };
      }
    } else if (bgRef) {
      return {
        type: 'themeRef',
        idx: Number(getAttr(bgRef, 'idx')) || 0,
        color: colorOf(bgRef)
      };
    }
  }
  return { type: 'inherit' };
}

function shapeJSON(s: Shape, deck: Deck): ShapeJSON {
  const x = s.xfrm;
  const opacityPct = (container: ONode | undefined): number | undefined => {
    const color =
      container &&
      (child(container, 'a:srgbClr') ||
        child(container, 'a:schemeClr') ||
        child(container, 'a:sysClr'));
    const alpha = color && child(color, 'a:alpha');
    return alpha ? Number(getAttr(alpha, 'val')) / 1000 : undefined;
  };
  const fillJSON = () => {
    if (!s.spPr) return { type: 'inherit' as const };
    if (child(s.spPr, 'a:noFill')) return { type: 'none' as const };
    const solid = child(s.spPr, 'a:solidFill');
    if (solid)
      return {
        type: 'solid' as const,
        color: colorOf(solid),
        opacityPct: opacityPct(solid)
      };
    const gradient = child(s.spPr, 'a:gradFill');
    if (gradient) {
      const lin = child(gradient, 'a:lin');
      const list = child(gradient, 'a:gsLst');
      return {
        type: 'gradient' as const,
        angleDeg: lin ? Number(getAttr(lin, 'ang')) / 60000 : undefined,
        stops: children(list || gradient, 'a:gs').map((stop) => ({
          posPct: Number(getAttr(stop, 'pos')) / 1000,
          color: colorOf(stop),
          opacityPct: opacityPct(stop)
        }))
      };
    }
    if (child(s.spPr, 'a:pattFill')) return { type: 'pattern' as const };
    if (child(s.spPr, 'a:blipFill')) return { type: 'image' as const };
    return { type: 'inherit' as const };
  };
  const line = s.spPr && child(s.spPr, 'a:ln');
  const lineFill = line && child(line, 'a:solidFill');
  const head = line && child(line, 'a:headEnd');
  const tail = line && child(line, 'a:tailEnd');
  const shadow =
    s.spPr && child(child(s.spPr, 'a:effectLst') || {}, 'a:outerShdw');
  const shadowColor =
    shadow && (child(shadow, 'a:srgbClr') || child(shadow, 'a:schemeClr'));
  const alpha = shadowColor && child(shadowColor, 'a:alpha');
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    frameEMU: x
      ? {
          x: x.x,
          y: x.y,
          cx: x.cx,
          cy: x.cy,
          rot: x.rot,
          flipH: x.flipH,
          flipV: x.flipV
        }
      : null,
    geom: s.geom,
    fill: s.fillColor ? `#${s.fillColor}` : undefined,
    image: s.type === 'pic' ? true : undefined,
    picture:
      s.type === 'pic'
        ? (() => {
            const blipFill = child(s.node, 'p:blipFill');
            const crop = blipFill && child(blipFill, 'a:srcRect');
            const pct = (name: string) =>
              Number(crop && getAttr(crop, name)) / 1000 || 0;
            const alphaMod = blipFill && descendant(blipFill, 'a:alphaModFix');
            return {
              cropPct: {
                left: pct('l'),
                top: pct('t'),
                right: pct('r'),
                bottom: pct('b')
              },
              clipGeometry: s.geom || 'rect',
              opacityPct: alphaMod
                ? Number(getAttr(alphaMod, 'amt')) / 1000
                : undefined
            };
          })()
        : undefined,
    chart:
      s.type === 'chart' && s.chartPart
        ? readChartData(deck.pkg, s.chartPart) || undefined
        : undefined,
    style: s.spPr
      ? {
          fill: fillJSON(),
          line: line
            ? {
                color: colorOf(lineFill),
                opacityPct: opacityPct(lineFill),
                widthEMU: Number(getAttr(line, 'w')) || 9525,
                dash:
                  getAttr(child(line, 'a:prstDash') || {}, 'val') || 'solid',
                cap: getAttr(line, 'cap'),
                compound: getAttr(line, 'cmpd'),
                alignment: getAttr(line, 'algn'),
                head: getAttr(head || {}, 'type'),
                headWidth: getAttr(head || {}, 'w'),
                headLength: getAttr(head || {}, 'len'),
                tail: getAttr(tail || {}, 'type'),
                tailWidth: getAttr(tail || {}, 'w'),
                tailLength: getAttr(tail || {}, 'len')
              }
            : undefined,
          outerShadow: shadow
            ? {
                color: colorOf(shadow),
                blurEMU: Number(getAttr(shadow, 'blurRad')) || 0,
                distanceEMU: Number(getAttr(shadow, 'dist')) || 0,
                directionDeg: (Number(getAttr(shadow, 'dir')) || 0) / 60000,
                opacityPct: alpha
                  ? Number(getAttr(alpha, 'val')) / 1000
                  : undefined
              }
            : undefined,
          customGeometry: !!child(s.spPr, 'a:custGeom')
        }
      : undefined,
    children:
      s.type === 'group'
        ? childrenOf(s.node)
            .map((node) => readShapeNode(node))
            .filter((shape): shape is Shape => !!shape)
            .map((shape) => shapeJSON(shape, deck))
        : undefined,
    table:
      s.type === 'table'
        ? {
            columns: tableColumns(s).map((column) => ({
              widthEMU: Number(getAttr(column, 'w')) || 0
            })),
            rows: tableRows(s).map((row) => ({
              heightEMU: Number(getAttr(row, 'h')) || 0,
              cells: tableCells(row).map((cell, columnIndex) => {
                const body = child(cell, 'a:txBody');
                const edge = (name: 'L' | 'T' | 'R' | 'B') => {
                  const border = tableCellBorderEdge(cell, name);
                  return {
                    ...border,
                    color: border.color ? `#${border.color}` : undefined
                  };
                };
                return {
                  columnIndex,
                  text: tableCellText(cell),
                  align: tableCellAlign(cell),
                  verticalAlign: tableCellVerticalAlign(cell),
                  fill: tableCellFill(cell)
                    ? `#${tableCellFill(cell)}`
                    : undefined,
                  gridSpan: tableCellGridSpan(cell),
                  rowSpan: tableCellRowSpan(cell),
                  mergeContinuation: tableCellIsMergeContinuation(cell),
                  borders: {
                    left: edge('L'),
                    top: edge('T'),
                    right: edge('R'),
                    bottom: edge('B')
                  },
                  paragraphs: body
                    ? children(body, 'a:p').map((paragraph) => ({
                        align: getAttr(child(paragraph, 'a:pPr') || {}, 'algn'),
                        props: readParagraphProps(paragraph),
                        bullet: bulletJSON(child(paragraph, 'a:pPr')),
                        runs: childrenOf(paragraph)
                          .filter((node) =>
                            ['a:r', 'a:fld', 'a:br'].includes(tagOf(node) || '')
                          )
                          .map((node) => runJSON(node, undefined)),
                        endRunProps: runPropsJSON(
                          child(paragraph, 'a:endParaRPr')
                        )
                      }))
                    : []
                };
              })
            }))
          }
        : undefined,
    text: s.text
      ? {
          bodyPr: readBodyProps(s.text.node),
          listStyle: listStyleJSON(s.text.node),
          paragraphs: s.text.paragraphs.map((p) => ({
            align: p.align,
            props: readParagraphProps(p.node),
            bullet: bulletJSON(child(p.node, 'a:pPr')),
            runs: childrenOf(p.node)
              .filter((n) => ['a:r', 'a:fld', 'a:br'].includes(tagOf(n) || ''))
              .map((n) =>
                runJSON(
                  n,
                  p.runs.find((r) => r.node === n)
                )
              ),
            endRunProps: runPropsJSON(child(p.node, 'a:endParaRPr'))
          }))
        }
      : undefined
  };
}

export function slideToJSON(deck: Deck, sl: Slide, i: number): SlideJSON {
  const size = effectiveSlideSize(deck, sl);
  return {
    index: i + 1,
    path: sl.path,
    sizeEMU: size,
    sizeInches: {
      w: +(size.cx / 914400).toFixed(2),
      h: +(size.cy / 914400).toFixed(2)
    },
    background: backgroundJSON(deck, sl),
    shapes: sl.shapes.map((shape) => shapeJSON(shape, deck))
  };
}

export function deckToJSON(deck: Deck): DeckJSON {
  return {
    sizeEMU: { cx: deck.size.cx, cy: deck.size.cy },
    sizeInches: {
      w: +(deck.size.cx / 914400).toFixed(2),
      h: +(deck.size.cy / 914400).toFixed(2)
    },
    slideCount: deck.slides.length,
    slides: deck.slides.map((sl, i) => slideToJSON(deck, sl, i))
  };
}
