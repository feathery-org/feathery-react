// Low-level DrawingML table accessors shared by the SVG renderer and editor
// commands. Keeping this separate from the view model means imported tables
// retain all XML we do not actively edit (merged cells, custom styles, etc.).
import {
  child,
  children,
  childrenOf,
  getAttr,
  tagOf,
  descendant,
  type ONode
} from '../opc/xml';
import type { Shape } from './types';

export function tableNode(shape: Shape): ONode | undefined {
  return descendant(shape.node, 'a:tbl');
}
export function tableRows(shape: Shape): ONode[] {
  const tbl = tableNode(shape);
  return tbl ? children(tbl, 'a:tr') : [];
}
export function tableColumns(shape: Shape): ONode[] {
  const tbl = tableNode(shape);
  const grid = tbl && child(tbl, 'a:tblGrid');
  return grid ? children(grid, 'a:gridCol') : [];
}
export function tableCells(row: ONode): ONode[] {
  return children(row, 'a:tc');
}
export function tableCell(
  shape: Shape,
  row: number,
  col: number
): ONode | undefined {
  const tr = tableRows(shape)[row];
  return tr ? tableCells(tr)[col] : undefined;
}
export function tableCellGridSpan(cell: ONode | undefined): number {
  return Math.max(1, Number(cell && getAttr(cell, 'gridSpan')) || 1);
}
export function tableCellRowSpan(cell: ONode | undefined): number {
  return Math.max(1, Number(cell && getAttr(cell, 'rowSpan')) || 1);
}
export function tableCellIsMergeContinuation(cell: ONode | undefined): boolean {
  return (
    !!cell &&
    (getAttr(cell, 'hMerge') === '1' ||
      getAttr(cell, 'hMerge') === 'true' ||
      getAttr(cell, 'vMerge') === '1' ||
      getAttr(cell, 'vMerge') === 'true')
  );
}
export function tableCellText(cell: ONode | undefined): string {
  if (!cell) return '';
  const body = child(cell, 'a:txBody');
  return body
    ? children(body, 'a:p')
        .map((p) =>
          childrenOf(p)
            .filter((n) => tagOf(n) === 'a:r' || tagOf(n) === 'a:fld')
            .map((r) => {
              const t = child(r, 'a:t');
              return t
                ? childrenOf(t)
                    .map((n) => n['#text'] ?? '')
                    .join('')
                : '';
            })
            .join('')
        )
        .join('\n')
    : '';
}
export function tableCellFill(cell: ONode | undefined): string | undefined {
  const pr = cell && child(cell, 'a:tcPr');
  const fill = pr && child(pr, 'a:solidFill');
  const rgb = fill && child(fill, 'a:srgbClr');
  return rgb ? getAttr(rgb, 'val') : undefined;
}
export function tableCellBorder(cell: ONode | undefined): string | undefined {
  const pr = cell && child(cell, 'a:tcPr');
  const ln =
    pr &&
    (child(pr, 'a:lnL') ||
      child(pr, 'a:lnT') ||
      child(pr, 'a:lnR') ||
      child(pr, 'a:lnB'));
  const fill = ln && child(ln, 'a:solidFill');
  const rgb = fill && child(fill, 'a:srgbClr');
  return rgb ? getAttr(rgb, 'val') : undefined;
}
export interface TableBorder {
  color?: string;
  widthEMU: number;
  dash: string;
  none: boolean;
}
export function tableCellBorderEdge(
  cell: ONode | undefined,
  edge: 'L' | 'T' | 'R' | 'B'
): TableBorder {
  const pr = cell && child(cell, 'a:tcPr');
  const line = pr && child(pr, `a:ln${edge}`);
  const fill = line && child(line, 'a:solidFill');
  const rgb = fill && child(fill, 'a:srgbClr');
  return {
    color: rgb ? getAttr(rgb, 'val') : undefined,
    widthEMU: Number(line && getAttr(line, 'w')) || 9525,
    dash:
      line && child(line, 'a:prstDash')
        ? getAttr(child(line, 'a:prstDash')!, 'val') || 'solid'
        : 'solid',
    none: !!(line && child(line, 'a:noFill'))
  };
}
export function tableCellFontSize(cell: ONode | undefined): number | undefined {
  const rPr =
    cell && (descendant(cell, 'a:rPr') || descendant(cell, 'a:endParaRPr'));
  const sz = rPr && Number(getAttr(rPr, 'sz'));
  return sz ? sz / 100 : undefined;
}
export function tableCellAlign(
  cell: ONode | undefined
): 'l' | 'ctr' | 'r' | 'just' {
  const body = cell && child(cell, 'a:txBody');
  const paragraph = body && child(body, 'a:p');
  const pPr = paragraph && child(paragraph, 'a:pPr');
  return (pPr && (getAttr(pPr, 'algn') as 'l' | 'ctr' | 'r' | 'just')) || 'l';
}
export function tableCellVerticalAlign(
  cell: ONode | undefined
): 't' | 'ctr' | 'b' {
  const body = cell && child(cell, 'a:txBody');
  const bodyPr = body && child(body, 'a:bodyPr');
  const anchor = bodyPr && getAttr(bodyPr, 'anchor');
  return anchor === 'ctr' || anchor === 'b' ? anchor : 't';
}
