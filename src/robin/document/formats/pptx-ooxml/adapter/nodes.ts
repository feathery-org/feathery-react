import type { NfNode } from '../../../tree';
import { canonicalJson, clone } from '../../../tree';
import { themeColorKey } from '../native';
import { szToPt } from '../../../../../elements/components/PptxEditor/core/model/units';
import {
  child,
  childrenOf,
  descendant,
  getAttr,
  tagOf,
  type ONode
} from '../../../../../elements/components/PptxEditor/core/opc/xml';

// Where a child node sat in its container: the adapter puts the normal form's children back here
export const SLOT: ONode = { '#slot': '' };

export const isSlot = (node: ONode) => '#slot' in node;

const SHAPE_KINDS: Record<string, string> = {
  'p:sp': 'shape',
  'p:pic': 'picture',
  'p:grpSp': 'group',
  'p:cxnSp': 'connector',
  'p:graphicFrame': 'graphic'
};

const RUN_KINDS: Record<string, string> = {
  'a:r': 'run',
  'a:br': 'break',
  'a:fld': 'field'
};

export const isShapeNode = (node: ONode) => (tagOf(node) ?? '') in SHAPE_KINDS;
export const isRunNode = (node: ONode) => (tagOf(node) ?? '') in RUN_KINDS;
export const shapeIdOf = (node: ONode) =>
  getAttr(descendant(node, 'p:cNvPr') ?? {}, 'id') ?? '';

export const MERGE_MARKS = ['gridSpan', 'rowSpan', 'hMerge', 'vMerge'];

// Files often write a span of 1 or a merge of 0, which is no merge
export const isMerge = (mark: string, value: string | undefined) =>
  mark === 'gridSpan' || mark === 'rowSpan'
    ? Number(value) > 1
    : value === '1' || value === 'true';

export interface ReadNodes {
  residue: Record<string, ONode>;
  sources: Map<NfNode, ONode>;
  inherited?: Record<string, Record<string, Record<string, unknown>>>;
  links?: Record<string, string>;
  themeColors?: Record<string, string>;
  slidePath?: string;
}

function withSlots(node: ONode, isModeled: (kid: ONode) => boolean): ONode {
  const copy = clone(node);
  const tag = tagOf(copy) as string;
  copy[tag] = childrenOf(copy).map((kid) => (isModeled(kid) ? SLOT : kid));
  return copy;
}

function shapeKind(node: ONode): string {
  const kind = SHAPE_KINDS[tagOf(node) as string];
  if (kind !== 'graphic') return kind;
  if (descendant(node, 'a:tbl')) return 'table';
  if (descendant(node, 'c:chart')) return 'chart';
  return kind;
}

function frameOf(node: ONode): Record<string, number> | undefined {
  const holder =
    tagOf(node) === 'p:graphicFrame'
      ? node
      : child(node, 'p:spPr') ?? child(node, 'p:grpSpPr');
  const xfrm = holder && (child(holder, 'a:xfrm') ?? child(holder, 'p:xfrm'));
  const off = xfrm && child(xfrm, 'a:off');
  const ext = xfrm && child(xfrm, 'a:ext');
  if (!off || !ext) return undefined;
  return {
    x: Number(getAttr(off, 'x')),
    y: Number(getAttr(off, 'y')),
    cx: Number(getAttr(ext, 'cx')),
    cy: Number(getAttr(ext, 'cy'))
  };
}

function placeholderOf(node: ONode): string | undefined {
  const nonVisual = childrenOf(node).find((kid) =>
    (tagOf(kid) ?? '').startsWith('p:nv')
  );
  const nvPr = nonVisual && child(nonVisual, 'p:nvPr');
  const ph = nvPr && child(nvPr, 'p:ph');
  if (!ph) return undefined;
  return getAttr(ph, 'type') ?? 'body';
}

/** A run's own formatting: only what its own properties set, never what it inherits */
function ownRunFormat(
  rPr: ONode | undefined,
  read: ReadNodes
): Record<string, unknown> {
  if (!rPr) return {};
  const out: Record<string, unknown> = {};
  const flag = (name: string) => {
    const value = getAttr(rPr, name);
    return value === undefined ? undefined : value === '1' || value === 'true';
  };
  const bold = flag('b');
  const italic = flag('i');
  const underline = getAttr(rPr, 'u');
  const strike = getAttr(rPr, 'strike');
  const size = getAttr(rPr, 'sz');
  const fill = child(rPr, 'a:solidFill');
  const rgb = fill && child(fill, 'a:srgbClr');
  const highlight = child(rPr, 'a:highlight');
  const highlightRgb = highlight && child(highlight, 'a:srgbClr');
  const latin = child(rPr, 'a:latin');
  if (bold !== undefined) out.bold = bold;
  if (italic !== undefined) out.italic = italic;
  if (underline !== undefined) out.underline = underline !== 'none';
  if (strike !== undefined) out.strike = strike !== 'noStrike';
  if (size !== undefined) out.size = szToPt(Number(size));
  const themed = (colored: ONode) =>
    read.slidePath === undefined
      ? undefined
      : read.themeColors?.[themeColorKey(read.slidePath, colored)];
  if (rgb) out.color = `#${(getAttr(rgb, 'val') ?? '').toUpperCase()}`;
  else if (fill && themed(fill)) out.color = themed(fill);
  if (highlightRgb)
    out.highlight = `#${(getAttr(highlightRgb, 'val') ?? '').toUpperCase()}`;
  else if (highlight && themed(highlight)) out.highlight = themed(highlight);
  if (latin && getAttr(latin, 'typeface'))
    out.font = getAttr(latin, 'typeface');
  return out;
}

// A click link or an action alone puts a run in a link
export const linkOf = (run: ONode) => {
  const rPr = child(run, 'a:rPr') ?? {};
  return child(rPr, 'a:hlinkClick') ?? child(rPr, 'a:hlinkMouseOver');
};

// Runs share a link by its relationship, an action alone by its own tag
export const linkKey = (hlink: ONode) =>
  (tagOf(hlink) === 'a:hlinkClick' && getAttr(hlink, 'r:id')) ||
  canonicalJson(hlink);

function linkTarget(hlink: ONode, links?: Record<string, string>): string {
  const relationship = getAttr(hlink, 'r:id');
  const target = relationship
    ? links?.[relationship] ?? relationship
    : getAttr(hlink, 'action') ?? '';
  return tagOf(hlink) === 'a:hlinkMouseOver' ? `on hover: ${target}` : target;
}

export function runText(node: ONode): string {
  if (tagOf(node) === 'a:br') return '\n';
  const t = child(node, 'a:t');
  return t
    ? childrenOf(t)
        .map((kid) => kid['#text'] ?? '')
        .join('')
    : '';
}

function readRun(node: ONode, id: string, read: ReadNodes): NfNode {
  const kind = RUN_KINDS[tagOf(node) as string];
  const run: NfNode = { id, kind, text: runText(node) };
  if (kind === 'field') run.field = getAttr(node, 'type') ?? 'field';
  if (kind !== 'break')
    Object.assign(run, ownRunFormat(child(node, 'a:rPr'), read));
  read.residue[id] = clone(node);
  read.sources.set(run, node);
  return run;
}

function readParagraph(
  node: ONode,
  id: string,
  read: ReadNodes,
  inherited?: Record<string, Record<string, unknown>>
): NfNode {
  const pPr = child(node, 'a:pPr');
  const paragraph: NfNode = { id, kind: 'paragraph' };
  const align = pPr && getAttr(pPr, 'algn');
  const level = pPr && getAttr(pPr, 'lvl');
  if (align) paragraph.align = align;
  if (level !== undefined) paragraph.level = Number(level);
  const from = inherited?.[Number(level ?? 0)];
  if (from) paragraph.inherited = from;
  // Consecutive runs that name one link are that link's text
  const runs: NfNode[] = [];
  let link: NfNode | undefined;
  let linked: string | undefined;
  childrenOf(node)
    .filter(isRunNode)
    .forEach((native, r) => {
      const run = readRun(native, `${id}r${r}`, read);
      const hlink = linkOf(native);
      if (!hlink) {
        link = linked = undefined;
        runs.push(run);
        return;
      }
      if (!link || linked !== linkKey(hlink)) {
        link = {
          id: `${id}l${r}`,
          kind: 'link',
          target: linkTarget(hlink, read.links),
          runs: []
        };
        linked = linkKey(hlink);
        read.residue[link.id] = clone(hlink);
        runs.push(link);
      }
      (link.runs as NfNode[]).push(run);
    });
  paragraph.runs = runs;
  read.residue[id] = withSlots(node, isRunNode);
  read.sources.set(paragraph, node);
  return paragraph;
}

function readParagraphs(
  txBody: ONode,
  id: string,
  read: ReadNodes,
  inherited?: Record<string, Record<string, unknown>>
): NfNode[] {
  return childrenOf(txBody)
    .filter((kid) => tagOf(kid) === 'a:p')
    .map((paragraph, p) =>
      readParagraph(paragraph, `${id}:p${p}`, read, inherited)
    );
}

const isParagraph = (node: ONode) => tagOf(node) === 'a:p';
const isRow = (node: ONode) => tagOf(node) === 'a:tr';
const isCell = (node: ONode) => tagOf(node) === 'a:tc';

function readTable(table: ONode, frame: NfNode, read: ReadNodes): ONode {
  const tbl = descendant(table, 'a:tbl') as ONode;
  frame.rows = childrenOf(tbl)
    .filter(isRow)
    .map((row, r) => {
      const rowId = `${frame.id}:r${r}`;
      const cells = childrenOf(row)
        .filter(isCell)
        .map((cell, c) => {
          const cellId = `${rowId}c${c}`;
          const txBody = child(cell, 'a:txBody');
          const out: NfNode = { id: cellId, kind: 'cell' };
          for (const mark of MERGE_MARKS) {
            const value = getAttr(cell, mark);
            if (isMerge(mark, value))
              out[mark] =
                mark === 'gridSpan' || mark === 'rowSpan' ? Number(value) : 1;
          }
          out.paragraphs = txBody ? readParagraphs(txBody, cellId, read) : [];
          read.residue[cellId] = txBody
            ? withTextSlots(cell, 'a:txBody')
            : clone(cell);
          read.sources.set(out, cell);
          return out;
        });
      read.residue[rowId] = withSlots(row, isCell);
      const rowNode: NfNode = { id: rowId, kind: 'row', cells };
      read.sources.set(rowNode, row);
      return rowNode;
    });
  return slotInside(table, 'a:tbl', isRow);
}

function withTextSlots(node: ONode, txTag: string): ONode {
  return slotInside(node, txTag, isParagraph);
}

function slotInside(
  node: ONode,
  tag: string,
  isModeled: (kid: ONode) => boolean
): ONode {
  const copy = clone(node);
  const holder = descendant(copy, tag);
  if (holder) {
    const holderTag = tagOf(holder) as string;
    holder[holderTag] = childrenOf(holder).map((kid) =>
      isModeled(kid) ? SLOT : kid
    );
  }
  return copy;
}

export function readShape(
  node: ONode,
  id: string,
  read: ReadNodes,
  topLevel = false
): NfNode {
  const kind = shapeKind(node);
  const cNvPr = descendant(node, 'p:cNvPr');
  const shape: NfNode = {
    id,
    kind,
    shapeId: getAttr(cNvPr ?? {}, 'id') ?? '',
    name: getAttr(cNvPr ?? {}, 'name') ?? ''
  };
  const placeholder = placeholderOf(node);
  if (placeholder) shape.placeholder = placeholder;
  const frame = frameOf(node);
  if (frame) shape.frame = frame;
  read.sources.set(shape, node);

  if (kind === 'shape') {
    const txBody = child(node, 'p:txBody');
    if (txBody)
      shape.paragraphs = readParagraphs(
        txBody,
        id,
        read,
        topLevel ? read.inherited?.[String(shape.shapeId)] : undefined
      );
    read.residue[id] = txBody ? withTextSlots(node, 'p:txBody') : clone(node);
    return shape;
  }
  if (kind === 'table') {
    read.residue[id] = readTable(node, shape, read);
    return shape;
  }
  if (kind === 'group') {
    shape.shapes = childrenOf(node)
      .filter(isShapeNode)
      .map((member) => readShape(member, `${id}/${shapeIdOf(member)}`, read));
    read.residue[id] = withSlots(node, isShapeNode);
    return shape;
  }
  read.residue[id] = clone(node);
  return shape;
}
