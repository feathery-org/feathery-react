// A hunk is one session change anchored in the FINAL document (F); deletions
// carry their removed text because it no longer exists in F.

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
  /** The original table when this deletion removes one whole table. Keeping the
   *  wrapper preserves rows, cells, widths and borders in the history view. */
  table?: unknown;
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

/** Text an author inserted/deleted, captured from live revisions so an edit
 *  accepted before close can still be attributed at view time. */
export interface RevisionRun {
  kind: 'ins' | 'del';
  text: string;
  /** Original Robin tracked-change group, retained when a version is restored. */
  group?: string;
}

export interface ChangeList {
  v: 1;
  sessionId: string;
  final_sha256: string;
  hunks: Hunk[];
  changeCount: number;
  formatChangeCount: number;
  authors: AuthorKey[];
  /** Correct pre-edit boundaries make slice attribution authoritative. Older
   *  artifacts retain the legacy text-based attribution fallback. */
  attribution?: 'slices';
  /** Authors of revisions actually rendered from the final change list. */
  trackedAuthors?: AuthorKey[];
  /** Robin's text captured while live, to keep ACCEPTED Robin edits coloured
   *  as Robin. Absent on older versions. */
  robinRuns?: RevisionRun[];
  /** This version records the user confirming tracked edits. Its synthetic
   *  revisions stay attributed to the original author and render as approved
   *  (non-pending) highlights. */
  confirmed?: boolean;
  /** Reasons the result is partial (time budget, block cap, …). */
  degraded?: string[];
}

export interface Slice {
  sfdt: unknown;
  author: AuthorKey;
  endedAt?: string;
}

export interface DiffOptions {
  /** Above this many blocks the diff stops, degraded 'block-cap' (no hunks). */
  maxBlocks?: number;
  timeBudgetMs?: number;
  includeFormatting?: boolean;
  now?: () => number;
}
