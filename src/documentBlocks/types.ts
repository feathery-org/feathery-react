/**
 * The data that defines a document. The document in the editor is a rendering
 * of this; every edit on either side converges back into one of these.
 */
import { TokenSpec } from '../documentTokens/plan';

export type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'table';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'token'; spec: TokenSpec };

export type Cell = { content: Inline[] };

export type Block = {
  /** Anchor identity: the document carries a bookmark named fblk_<id>. */
  id: string;
  type: BlockType;
  /** h1/h2/h3/paragraph content. Absent for tables. */
  content?: Inline[];
  /** Table rows. Row 0 is the header row. Absent for non-tables. */
  rows?: Cell[][];
};

export type Section = { id: string; blocks: Block[] };

/**
 * SFDT format fragments captured from the Components document and re-applied
 * on every generate. Pass-through objects: whatever Syncfusion serializes for
 * the sample is what every instance gets.
 */
export type BlockFormats = {
  characterFormat?: Record<string, any>;
  paragraphFormat?: Record<string, any>;
};

export type Theme = {
  h1: BlockFormats;
  h2: BlockFormats;
  h3: BlockFormats;
  paragraph: BlockFormats;
  table: {
    tableFormat?: Record<string, any>;
    headerRow: BlockFormats & { cellFormat?: Record<string, any> };
    body: BlockFormats & { cellFormat?: Record<string, any> };
  };
};

export type DocumentData = {
  sections: Section[];
  theme: Theme;
  /** In-memory token values — a token with neither `source` nor `formula`. */
  values?: Record<string, string | number>;
};

export const EMPTY_THEME: Theme = {
  h1: {},
  h2: {},
  h3: {},
  paragraph: {},
  table: { headerRow: {}, body: {} }
};

export const blockIds = (data: DocumentData): string[] =>
  data.sections.flatMap((s) => s.blocks.map((b) => b.id));

/** Every inline in a block, regardless of shape — cells included. */
export const allInlines = (block: Block): Inline[] =>
  block.rows
    ? block.rows.flatMap((row) => row.flatMap((cell) => cell.content))
    : block.content ?? [];
