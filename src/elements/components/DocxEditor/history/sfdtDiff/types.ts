// Shared types for the version-history diff engine.
//
// A "hunk" is one change a session made, anchored to an exact position in the
// session's FINAL document (F). Insertions are a range in F; deletions carry the
// removed text because it no longer exists in F; formatting hunks describe a
// range whose characters survived but whose formatting changed.

export type AuthorKey = string;

/** Path from the document root to a block: section index, then block indices,
 *  descending through tables as ['rows', r, 'cells', c, 'blocks', b]. */
export type BlockPath = Array<string | number>;

export interface HunkAt {
  block: BlockPath;
  /** Character offset within the block's plain text (paragraphs only). */
  offset?: number;
  /** Range length in F (ins / fmt). */
  length?: number;
}

export type FormatDelta = Record<string, [unknown, unknown]>;

export interface InsHunk {
  id: number;
  author: AuthorKey;
  type: 'ins';
  at: Required<Pick<HunkAt, 'block' | 'offset' | 'length'>>;
}

export interface DelHunk {
  id: number;
  author: AuthorKey;
  type: 'del';
  at: Required<Pick<HunkAt, 'block' | 'offset'>>;
  text: string;
  /** Character format of the removed run(s), when uniform. */
  characterFormat?: Record<string, unknown>;
}

export interface FmtHunk {
  id: number;
  author: AuthorKey;
  type: 'fmt';
  at: Required<Pick<HunkAt, 'block' | 'offset' | 'length'>>;
  props: FormatDelta;
}

export interface InsBlockHunk {
  id: number;
  author: AuthorKey;
  type: 'ins_block';
  at: Pick<HunkAt, 'block'>;
  count: number;
}

export interface DelBlockHunk {
  id: number;
  author: AuthorKey;
  type: 'del_block';
  /** The block in F BEFORE which the removed block(s) sat. */
  at: Pick<HunkAt, 'block'>;
  /** Removed paragraphs, as plain SFDT blocks (text + formats), in order. */
  blocks: unknown[];
}

export interface FmtBlockHunk {
  id: number;
  author: AuthorKey;
  type: 'fmt_block';
  at: Pick<HunkAt, 'block'>;
  props: FormatDelta;
}

export type Hunk =
  | InsHunk
  | DelHunk
  | FmtHunk
  | InsBlockHunk
  | DelBlockHunk
  | FmtBlockHunk;

export interface ChangeList {
  v: 1;
  sessionId: string;
  final_sha256: string;
  hunks: Hunk[];
  changeCount: number;
  formatChangeCount: number;
  authors: AuthorKey[];
  /** Reasons the result is partial (time budget, block cap, …). */
  degraded?: string[];
}

export interface Slice {
  sfdt: unknown;
  author: AuthorKey;
  endedAt?: string;
}

export interface DiffOptions {
  /** Above this many blocks the engine only aligns by identity (no LCS). */
  maxBlocks?: number;
  timeBudgetMs?: number;
  includeFormatting?: boolean;
  now?: () => number;
}
