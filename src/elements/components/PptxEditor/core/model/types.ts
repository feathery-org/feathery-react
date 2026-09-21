// The typed slide model is a *view* over the order-preserving raw XML tree.
// Every node keeps a reference (`node`) into that raw tree, so edits mutate the
// raw in place and untouched XML survives the round trip. This is the "_raw
// passthrough" from the plan, realized by reference rather than by copy.

import type { ONode, OTree } from '../opc/xml';
import type { OPCPackage } from '../opc/package';

export type ShapeType =
  | 'text'
  | 'shape'
  | 'pic'
  | 'table'
  | 'chart'
  | 'group'
  | 'connector'
  | 'other';

/** Geometry in EMU; rot in degrees (converted from the file's 60000ths). */
export interface Xfrm {
  x: number;
  y: number;
  cx: number;
  cy: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
}

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  sizePt?: number;
  color?: string; // hex "RRGGBB"
  highlight?: string; // hex "RRGGBB"
  baselinePct?: number; // positive = superscript, negative = subscript
  font?: string;
  rPr?: ONode; // the a:rPr node (formatting), if present
  node: ONode; // the a:r node
}

export interface Bullet {
  kind: 'none' | 'char' | 'autoNum';
  char?: string; // for kind 'char' (e.g. "•", "-")
  font?: string; // a:buFont typeface (e.g. "Wingdings", "Arial") — needed to interpret char
  scheme?: string; // for kind 'autoNum' (e.g. "arabicPeriod")
  startAt?: number;
}

export interface Paragraph {
  runs: Run[];
  align?: 'l' | 'ctr' | 'r' | 'just';
  bullet?: Bullet;
  marLEmu?: number; // left margin (a:pPr @marL)
  indentEmu?: number; // first-line indent (a:pPr @indent), usually negative for hanging bullets
  level?: number; // a:pPr @lvl
  node: ONode; // the a:p node
}

export interface TextBody {
  paragraphs: Paragraph[];
  node: ONode; // the p:txBody node
}

export interface Shape {
  id: string; // cNvPr @id
  name: string; // cNvPr @name
  type: ShapeType;
  xfrm?: Xfrm;
  text?: TextBody;
  imageSrc?: string; // object URL for a picture
  chartPart?: string; // related ppt/charts/chartN.xml part for a chart graphic frame
  fillColor?: string; // solid fill hex, if any
  geom?: string; // prstGeom preset (rect, ellipse, ...)
  extKey?: string; // future binding anchor from extLst (parsed, preserved)
  node: ONode; // the raw p:sp / p:pic / p:graphicFrame / ... node
  spPr?: ONode; // the p:spPr node (geometry/fill), when applicable
}

export interface Slide {
  path: string; // e.g. ppt/slides/slide1.xml
  spTree: ONode; // the p:spTree node (mutate its children to add/remove shapes)
  shapes: Shape[];
  raw: OTree; // the whole parsed slide document
  size?: { cx: number; cy: number }; // editor-specific per-slide viewport; PPTX itself has one global size
}

export interface Deck {
  size: { cx: number; cy: number }; // EMU
  slides: Slide[];
  pkg: OPCPackage;
}
