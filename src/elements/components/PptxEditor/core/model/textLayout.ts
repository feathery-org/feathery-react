// Read sparse DrawingML text layout properties without flattening inheritance.
// Both the JSON view and SVG renderer consume these XML-backed values.

import { child, children, getAttr, type ONode } from '../opc/xml';

export type Spacing =
  | { kind: 'percent'; valPct: number }
  | { kind: 'points'; valPt: number };

export interface BodyProps {
  wrap?: string;
  anchor?: string;
  vertical?: string;
  verticalOverflow?: string;
  insetsEMU?: { l?: number; t?: number; r?: number; b?: number };
  autofit?: {
    type: 'none' | 'normal' | 'shape';
    fontScalePct?: number;
    lineSpaceReductionPct?: number;
  };
}

export interface ParagraphProps {
  level?: number;
  marginLeftEMU?: number;
  marginRightEMU?: number;
  indentEMU?: number;
  defaultTabEMU?: number;
  lineSpacing?: Spacing;
  spaceBefore?: Spacing;
  spaceAfter?: Spacing;
  tabs?: { posEMU: number; align?: string }[];
}

const numAttr = (node: ONode | undefined, name: string): number | undefined => {
  const value = node && getAttr(node, name);
  return value === undefined ? undefined : Number(value);
};

// OOXML may serialize percentages as 92000 or as "92.000%".
export function ooxmlPercent(
  value: string | undefined,
  fallback: number
): number {
  if (!value) return fallback;
  return value.endsWith('%')
    ? Number(value.slice(0, -1))
    : Number(value) / 1000;
}

function spacing(container: ONode | undefined): Spacing | undefined {
  if (!container) return undefined;
  const pct = child(container, 'a:spcPct');
  if (pct)
    return { kind: 'percent', valPct: ooxmlPercent(getAttr(pct, 'val'), 100) };
  const pts = child(container, 'a:spcPts');
  if (pts) return { kind: 'points', valPt: (numAttr(pts, 'val') || 0) / 100 };
  return undefined;
}

export function readBodyProps(txBody: ONode | undefined): BodyProps {
  const body = txBody && child(txBody, 'a:bodyPr');
  if (!body) return {};
  const insetsEMU = {
    l: numAttr(body, 'lIns'),
    t: numAttr(body, 'tIns'),
    r: numAttr(body, 'rIns'),
    b: numAttr(body, 'bIns')
  };
  const normal = child(body, 'a:normAutofit');
  const autofit = normal
    ? {
        type: 'normal' as const,
        fontScalePct: ooxmlPercent(getAttr(normal, 'fontScale'), 100),
        lineSpaceReductionPct: ooxmlPercent(
          getAttr(normal, 'lnSpcReduction'),
          0
        )
      }
    : child(body, 'a:spAutoFit')
    ? { type: 'shape' as const }
    : child(body, 'a:noAutofit')
    ? { type: 'none' as const }
    : undefined;
  return {
    wrap: getAttr(body, 'wrap'),
    anchor: getAttr(body, 'anchor'),
    vertical: getAttr(body, 'vert'),
    verticalOverflow: getAttr(body, 'vertOverflow'),
    insetsEMU: Object.values(insetsEMU).some((v) => v !== undefined)
      ? insetsEMU
      : undefined,
    autofit
  };
}

export function readParagraphProps(pNode: ONode): ParagraphProps {
  const pPr = child(pNode, 'a:pPr');
  return readParagraphPr(pPr);
}

export function readParagraphPr(pPr: ONode | undefined): ParagraphProps {
  if (!pPr) return {};
  const tabLst = child(pPr, 'a:tabLst');
  return {
    level: numAttr(pPr, 'lvl'),
    marginLeftEMU: numAttr(pPr, 'marL'),
    marginRightEMU: numAttr(pPr, 'marR'),
    indentEMU: numAttr(pPr, 'indent'),
    defaultTabEMU: numAttr(pPr, 'defTabSz'),
    lineSpacing: spacing(child(pPr, 'a:lnSpc')),
    spaceBefore: spacing(child(pPr, 'a:spcBef')),
    spaceAfter: spacing(child(pPr, 'a:spcAft')),
    tabs: tabLst
      ? children(tabLst, 'a:tab').map((tab) => ({
          posEMU: numAttr(tab, 'pos') || 0,
          align: getAttr(tab, 'algn')
        }))
      : undefined
  };
}
