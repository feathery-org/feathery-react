// Pure per-node readers shared by import.ts (whole deck) and edit.ts (single
// node after a mutation). No OPCPackage dependency; images are resolved by an
// optional callback the caller supplies.

import {
  child,
  children,
  descendant,
  getAttr,
  childrenOf,
  tagOf,
  type ONode
} from '../opc/xml';
import { angleToDeg, szToPt } from './units';
import type { Shape, ShapeType, Xfrm, TextBody, Paragraph, Run } from './types';

export function readXfrm(xfrmNode: ONode | undefined): Xfrm | undefined {
  if (!xfrmNode) return undefined;
  const off = child(xfrmNode, 'a:off');
  const ext = child(xfrmNode, 'a:ext');
  return {
    x: Number(off && getAttr(off, 'x')) || 0,
    y: Number(off && getAttr(off, 'y')) || 0,
    cx: Number(ext && getAttr(ext, 'cx')) || 0,
    cy: Number(ext && getAttr(ext, 'cy')) || 0,
    rot: angleToDeg(Number(getAttr(xfrmNode, 'rot')) || 0),
    flipH: getAttr(xfrmNode, 'flipH') === '1',
    flipV: getAttr(xfrmNode, 'flipV') === '1'
  };
}

export function solidFillHex(container: ONode | undefined): string | undefined {
  if (!container) return undefined;
  const fill = child(container, 'a:solidFill');
  const srgb = fill && child(fill, 'a:srgbClr');
  return srgb ? getAttr(srgb, 'val') : undefined;
}

function readRun(rNode: ONode): Run {
  const rPr = child(rNode, 'a:rPr');
  const tNode = child(rNode, 'a:t');
  const latin = rPr && child(rPr, 'a:latin');
  const sz = rPr && getAttr(rPr, 'sz');
  const highlight = rPr && child(rPr, 'a:highlight');
  const highlightRgb = highlight && child(highlight, 'a:srgbClr');
  const baseline = rPr && getAttr(rPr, 'baseline');
  return {
    text:
      tagOf(rNode) === 'a:br'
        ? '\n'
        : tNode
        ? childrenOf(tNode)
            .map((c) => c['#text'] ?? '')
            .join('')
        : '',
    bold: rPr ? getAttr(rPr, 'b') === '1' : undefined,
    italic: rPr ? getAttr(rPr, 'i') === '1' : undefined,
    underline: rPr
      ? getAttr(rPr, 'u') !== undefined && getAttr(rPr, 'u') !== 'none'
      : undefined,
    strike: rPr
      ? getAttr(rPr, 'strike') !== undefined &&
        getAttr(rPr, 'strike') !== 'noStrike'
      : undefined,
    sizePt: sz ? szToPt(Number(sz)) : undefined,
    color: solidFillHex(rPr),
    highlight: highlightRgb ? getAttr(highlightRgb, 'val') : undefined,
    baselinePct: baseline === undefined ? undefined : Number(baseline) / 1000,
    font: latin ? getAttr(latin, 'typeface') : undefined,
    rPr,
    node: rNode
  };
}

function readBullet(pPr: ONode | undefined): Paragraph['bullet'] {
  if (!pPr) return undefined;
  if (child(pPr, 'a:buNone')) return { kind: 'none' };
  const buFontEl = child(pPr, 'a:buFont');
  const buFont = buFontEl ? getAttr(buFontEl, 'typeface') : undefined;
  const buChar = child(pPr, 'a:buChar');
  if (buChar) {
    const encoded = getAttr(buChar, 'char') || '•';
    const char = encoded
      .replace(/&#x([0-9a-f]+);/gi, (_, value) =>
        String.fromCodePoint(parseInt(value, 16))
      )
      .replace(/&#([0-9]+);/g, (_, value) =>
        String.fromCodePoint(parseInt(value, 10))
      );
    return { kind: 'char', char, font: buFont };
  }
  const buAutoNum = child(pPr, 'a:buAutoNum');
  if (buAutoNum)
    return {
      kind: 'autoNum',
      scheme: getAttr(buAutoNum, 'type') || 'arabicPeriod',
      startAt: Number(getAttr(buAutoNum, 'startAt')) || undefined
    };
  return undefined;
}

export function readTextBody(txBody: ONode | undefined): TextBody | undefined {
  if (!txBody) return undefined;
  const paragraphs: Paragraph[] = children(txBody, 'a:p').map((pNode) => {
    const pPr = child(pNode, 'a:pPr');
    // a:r and a:fld carry text; a:br is a soft line break within the paragraph.
    const runs = childrenOf(pNode)
      .filter(
        (c) => tagOf(c) === 'a:r' || tagOf(c) === 'a:fld' || tagOf(c) === 'a:br'
      )
      .map(readRun);
    return {
      runs,
      align: (pPr && (getAttr(pPr, 'algn') as Paragraph['align'])) || undefined,
      bullet: readBullet(pPr),
      marLEmu:
        pPr && getAttr(pPr, 'marL') !== undefined
          ? Number(getAttr(pPr, 'marL'))
          : undefined,
      indentEmu:
        pPr && getAttr(pPr, 'indent') !== undefined
          ? Number(getAttr(pPr, 'indent'))
          : undefined,
      level:
        pPr && getAttr(pPr, 'lvl') !== undefined
          ? Number(getAttr(pPr, 'lvl'))
          : undefined,
      node: pNode
    };
  });
  return { paragraphs, node: txBody };
}

const NV_TAGS = new Set([
  'p:sp',
  'p:pic',
  'p:graphicFrame',
  'p:grpSp',
  'p:cxnSp'
]);

function classify(tag: string, hasText: boolean, node: ONode): ShapeType {
  switch (tag) {
    case 'p:sp':
      return hasText ? 'text' : 'shape';
    case 'p:pic':
      return 'pic';
    case 'p:graphicFrame':
      if (descendant(node, 'a:tbl')) return 'table';
      if (descendant(node, 'c:chart')) return 'chart';
      return 'other';
    case 'p:grpSp':
      return 'group';
    case 'p:cxnSp':
      return 'connector';
    default:
      return 'other';
  }
}

export interface ReadShapeOpts {
  imageSrc?: (node: ONode) => string | undefined;
  relatedPart?: (relationshipId: string) => string | undefined;
}

export function readShapeNode(
  node: ONode,
  opts: ReadShapeOpts = {}
): Shape | null {
  const tag = tagOf(node);
  if (!tag || !NV_TAGS.has(tag)) return null;

  const cNvPr = descendant(node, 'p:cNvPr');
  const spPr = child(node, 'p:spPr') || child(node, 'p:grpSpPr');
  const text = readTextBody(child(node, 'p:txBody'));
  const hasText =
    !!text && text.paragraphs.some((p) => p.runs.some((r) => r.text.length));

  const xfrmNode =
    tag === 'p:graphicFrame'
      ? child(node, 'p:xfrm')
      : spPr && child(spPr, 'a:xfrm');
  const geomNode = spPr && child(spPr, 'a:prstGeom');
  const chart =
    tag === 'p:graphicFrame' ? descendant(node, 'c:chart') : undefined;
  const chartRelId = chart && getAttr(chart, 'r:id');

  return {
    id: (cNvPr && getAttr(cNvPr, 'id')) || '',
    name: (cNvPr && getAttr(cNvPr, 'name')) || '',
    type: classify(tag, hasText, node),
    xfrm: readXfrm(xfrmNode),
    text,
    imageSrc: tag === 'p:pic' ? opts.imageSrc?.(node) : undefined,
    chartPart: chartRelId ? opts.relatedPart?.(chartRelId) : undefined,
    fillColor: solidFillHex(spPr),
    geom: geomNode ? getAttr(geomNode, 'prst') : undefined,
    node,
    spPr
  };
}

/** Rebuild just the .text view of a shape from its (mutated) raw node. */
export function refreshShapeText(shape: Shape): void {
  shape.text = readTextBody(child(shape.node, 'p:txBody'));
}
