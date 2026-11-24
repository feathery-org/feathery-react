import type { OPCPackage } from '../opc/package';
import {
  child,
  children,
  childrenOf,
  getAttr,
  root,
  textOf,
  type ONode
} from '../opc/xml';
import { pkgCache } from './color';

const STYLES_PART = 'ppt/tableStyles.xml';
const COLOR_TAGS = ['a:srgbClr', 'a:schemeClr', 'a:sysClr'];
const stylesCache = new WeakMap<OPCPackage, Map<string, Map<string, ONode>>>();

/** The fill, text colour and weight a table style gives a cell */
export interface TableCellLook {
  fill?: ONode;
  textColor?: ONode;
  bold?: boolean;
}

function stylesOf(pkg: OPCPackage): Map<string, ONode> {
  const inner = pkgCache(stylesCache, pkg);
  const cached = inner.get(STYLES_PART);
  if (cached) return cached;
  const styles = new Map<string, ONode>();
  if (pkg.hasPart(STYLES_PART))
    for (const style of children(root(pkg.tree(STYLES_PART)), 'a:tblStyle')) {
      const id = getAttr(style, 'styleId');
      if (id) styles.set(id, style);
    }
  inner.set(STYLES_PART, styles);
  return styles;
}

/** The style parts that reach a cell, weakest first, as PowerPoint layers them */
function partsFor(
  tblPr: ONode | undefined,
  row: number,
  col: number,
  rowCount: number,
  colCount: number
): string[] {
  const on = (flag: string) => !!tblPr && getAttr(tblPr, flag) === '1';
  const parts = ['a:wholeTbl'];
  if (on('bandCol')) {
    const band = col - (on('firstCol') ? 1 : 0);
    if (band >= 0) parts.push(band % 2 === 0 ? 'a:band1V' : 'a:band2V');
  }
  if (on('bandRow')) {
    const band = row - (on('firstRow') ? 1 : 0);
    if (band >= 0) parts.push(band % 2 === 0 ? 'a:band1H' : 'a:band2H');
  }
  if (on('firstCol') && col === 0) parts.push('a:firstCol');
  if (on('lastCol') && col === colCount - 1) parts.push('a:lastCol');
  if (on('lastRow') && row === rowCount - 1) parts.push('a:lastRow');
  if (on('firstRow') && row === 0) parts.push('a:firstRow');
  return parts;
}

/** The fill and text a table's style gives one of its cells */
export function tableCellLook(
  tbl: ONode,
  pkg: OPCPackage,
  row: number,
  col: number,
  rowCount: number,
  colCount: number
): TableCellLook {
  const tblPr = child(tbl, 'a:tblPr');
  const idNode = tblPr && child(tblPr, 'a:tableStyleId');
  const styleId = idNode && childrenOf(idNode).map(textOf).join('').trim();
  const style = styleId && stylesOf(pkg).get(styleId);
  if (!style) return {};
  const look: TableCellLook = {};
  for (const tag of partsFor(tblPr, row, col, rowCount, colCount)) {
    const part = child(style, tag);
    if (!part) continue;
    const tcStyle = child(part, 'a:tcStyle');
    const fill = tcStyle && child(tcStyle, 'a:fill');
    const solid = fill && child(fill, 'a:solidFill');
    if (solid || (fill && child(fill, 'a:noFill'))) look.fill = solid;
    const txStyle = child(part, 'a:tcTxStyle');
    if (!txStyle) continue;
    if (COLOR_TAGS.some((tag) => child(txStyle, tag))) look.textColor = txStyle;
    const bold = getAttr(txStyle, 'b');
    if (bold) look.bold = bold === 'on';
  }
  return look;
}
