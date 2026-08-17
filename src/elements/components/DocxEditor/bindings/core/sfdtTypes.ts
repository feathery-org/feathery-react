// Structural types for the verbose SFDT document, shared by the adapter, the
// engine and template import.
//
// These describe only the shape the binding engine relies on; every node keeps an
// index signature because SFDT carries far more formatting than this code reads,
// and all of it must survive a round trip untouched.
//
// "Verbose" is load-bearing. Syncfusion defaults `optimizeSfdt` to true, which
// renames every key (`sections` -> `sec`, `contentControlProperties` -> `ccp`,
// `tag` -> `tg`), and nothing here would find a single binding in that form. The
// editor must therefore be constructed with `optimizeSfdt: false`;
// `isOptimizedSfdt` exists so the mistake is caught loudly instead of read as an
// empty document.

/** A path of object keys / array indices from the document root to a node. */
export type SfdtPath = Array<string | number>;

export interface ContentControlProperties {
  tag?: string;
  title?: string;
  lockContents?: boolean;
  lockContentControl?: boolean;
  type?: string;
  /**
   * Required in practice. The SFDT reader only assigns it when supplied, and the
   * content-control border renderer measures it as soon as the caret enters the
   * control - a control synthesized without a color crashes the editor on focus.
   */
  color?: string;
  appearance?: string;
  hasPlaceHolderText?: boolean;
  multiline?: boolean;
  isTemporary?: boolean;
  [key: string]: unknown;
}

export interface SfdtInline {
  text?: string;
  characterFormat?: Record<string, unknown>;
  contentControlProperties?: ContentControlProperties;
  /** Present when this inline is a content control wrapping other inlines. */
  inlines?: SfdtInline[];
  [key: string]: unknown;
}

export interface SfdtCell {
  cellFormat?: Record<string, unknown>;
  // Forward reference to the interface below; fine for a type.
  // eslint-disable-next-line no-use-before-define
  blocks?: SfdtBlock[];
  [key: string]: unknown;
}

export interface SfdtRowFormat {
  isHeader?: boolean;
  [key: string]: unknown;
}

export interface SfdtRow {
  rowFormat?: SfdtRowFormat;
  cells?: SfdtCell[];
  [key: string]: unknown;
}

export interface SfdtBlock {
  /** Paragraph content. */
  inlines?: SfdtInline[];
  /** Table content. */
  rows?: SfdtRow[];
  /** Block-level content control wrapper (how a table marker is expressed). */
  blocks?: SfdtBlock[];
  contentControlProperties?: ContentControlProperties;
  paragraphFormat?: Record<string, unknown>;
  tableFormat?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SfdtHeaderFooter {
  blocks?: SfdtBlock[];
  [key: string]: unknown;
}

export interface SfdtSection {
  blocks?: SfdtBlock[];
  headersFooters?: Record<string, SfdtHeaderFooter | undefined>;
  sectionFormat?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SfdtDocument {
  sections?: SfdtSection[];
  [key: string]: unknown;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path: SfdtPath;
}

/**
 * True when a document uses Syncfusion's minified keyword set, in which case the
 * binding engine cannot read it. Detected on the top-level sections key, which
 * every document has.
 */
export function isOptimizedSfdt(sfdt: unknown): boolean {
  if (!sfdt || typeof sfdt !== 'object') return false;
  const document = sfdt as Record<string, unknown>;
  return Array.isArray(document.sec) && !Array.isArray(document.sections);
}
