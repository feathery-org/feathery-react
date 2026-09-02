// Flattens a verbose SFDT document into the per-character representation the
// diff works on. Only paragraphs are blocks here; a table contributes its cell
// paragraphs (with their full path) so text inside tables diffs like any other
// text. Row add/remove is recognised downstream from whole-row membership.

import type { BlockPath, FormatDelta } from './types';

/** Non-text inlines (images, fields, breaks…) become one atomic character. */
export const TOKEN_CHAR = '';

/** Character-format properties the diff compares. Everything else is ignored. */
export const FMT_PROPS = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'fontSize',
  'fontFamily',
  'fontColor',
  'highlightColor',
  'baselineAlignment'
] as const;

/** Paragraph-format properties the diff compares. */
export const BLOCK_FMT_PROPS = [
  'textAlignment',
  'styleName',
  'listFormat',
  'leftIndent',
  'rightIndent',
  'firstLineIndent',
  'beforeSpacing',
  'afterSpacing',
  'lineSpacing'
] as const;

export interface FlatChar {
  ch: string;
  /** Stable key for the character format (JSON of the compared props). */
  fmtKey: string;
  /** The original non-text inline, for TOKEN_CHAR. */
  token?: unknown;
}

export interface FlatBlock {
  path: BlockPath;
  /** Path of the enclosing table row, when inside a table. */
  rowPath?: BlockPath;
  chars: FlatChar[];
  text: string;
  paraFmt: Record<string, unknown>;
  paraFmtKey: string;
  /** fmtKey → full characterFormat object (for rebuilding runs). */
  fmts: Map<string, Record<string, unknown>>;
  /** The original paragraph, untouched (used to reproduce deleted blocks). */
  raw: unknown;
}

export interface FlatDoc {
  blocks: FlatBlock[];
}

const IDENTITY_LIMIT = 200;

export function identityOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, IDENTITY_LIMIT);
}

export function pick(
  obj: Record<string, unknown> | undefined,
  keys: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) return out;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) out[k] = obj[k];
  }
  return out;
}

export function fmtKeyOf(fmt: Record<string, unknown> | undefined): string {
  const picked = pick(fmt, FMT_PROPS);
  const keys = Object.keys(picked).sort();
  return keys.length ? JSON.stringify(picked, keys) : '';
}

export function paraFmtKeyOf(fmt: Record<string, unknown> | undefined): string {
  const picked = pick(fmt, BLOCK_FMT_PROPS);
  const keys = Object.keys(picked).sort();
  return keys.length ? JSON.stringify(picked, keys) : '';
}

export function formatDelta(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  props: readonly string[]
): FormatDelta | null {
  const a = pick(before, props);
  const b = pick(after, props);
  const delta: FormatDelta = {};
  let any = false;
  for (const k of props) {
    const x = JSON.stringify(a[k] ?? null);
    const y = JSON.stringify(b[k] ?? null);
    if (x !== y) {
      delta[k] = [a[k] ?? null, b[k] ?? null];
      any = true;
    }
  }
  return any ? delta : null;
}

function isParagraph(block: any): boolean {
  return !!block && Array.isArray(block.inlines);
}

function isTable(block: any): boolean {
  return !!block && Array.isArray(block.rows);
}

/** Recursively flatten inlines (content controls wrap nested `inlines`). */
function flattenInlines(
  inlines: any[],
  chars: FlatChar[],
  fmts: Map<string, Record<string, unknown>>,
  inherited?: Record<string, unknown>
): void {
  for (const inline of inlines) {
    if (!inline || typeof inline !== 'object') continue;
    const fmt = inline.characterFormat ?? inherited;
    if (Array.isArray(inline.inlines)) {
      flattenInlines(inline.inlines, chars, fmts, fmt);
      continue;
    }
    const key = fmtKeyOf(fmt);
    if (!fmts.has(key)) fmts.set(key, fmt ? { ...fmt } : {});
    if (typeof inline.text === 'string') {
      for (const ch of inline.text) chars.push({ ch, fmtKey: key });
    } else {
      chars.push({ ch: TOKEN_CHAR, fmtKey: key, token: inline });
    }
  }
}

function flattenParagraph(
  para: any,
  path: BlockPath,
  rowPath: BlockPath | undefined,
  out: FlatBlock[]
): void {
  const chars: FlatChar[] = [];
  const fmts = new Map<string, Record<string, unknown>>();
  flattenInlines(para.inlines ?? [], chars, fmts);
  const paraFmt = para.paragraphFormat ?? {};
  out.push({
    path,
    rowPath,
    chars,
    text: chars.map((c) => c.ch).join(''),
    paraFmt,
    paraFmtKey: paraFmtKeyOf(paraFmt),
    fmts,
    raw: para
  });
}

function flattenBlocks(
  blocks: any[],
  path: BlockPath,
  rowPath: BlockPath | undefined,
  out: FlatBlock[]
): void {
  blocks.forEach((block, index) => {
    const here = [...path, index];
    if (isParagraph(block)) {
      flattenParagraph(block, here, rowPath, out);
    } else if (isTable(block)) {
      block.rows.forEach((row: any, r: number) => {
        const rp = [...here, 'rows', r];
        (row.cells ?? []).forEach((cell: any, c: number) => {
          flattenBlocks(
            cell.blocks ?? [],
            [...rp, 'cells', c, 'blocks'],
            rp,
            out
          );
        });
      });
    } else if (Array.isArray(block.blocks)) {
      // Block-level content control wrapper.
      flattenBlocks(block.blocks, [...here, 'blocks'], rowPath, out);
    }
  });
}

export function flattenSfdt(sfdt: any): FlatDoc {
  const blocks: FlatBlock[] = [];
  (sfdt?.sections ?? []).forEach((section: any, s: number) => {
    flattenBlocks(section.blocks ?? [], [s, 'blocks'], undefined, blocks);
  });
  return { blocks };
}

/** Navigate a block path on a (cloned) document. */
export function getBlock(sfdt: any, path: BlockPath): any {
  let node: any = sfdt.sections;
  for (const step of path) {
    if (node == null) return undefined;
    node = node[step as any];
  }
  return node;
}

/** The array that holds the block at `path`, and the index within it. */
export function containerOf(
  sfdt: any,
  path: BlockPath
): { arr: any[]; index: number } {
  const parent = path.slice(0, -1);
  let node: any = sfdt.sections;
  for (const step of parent) node = node[step as any];
  return { arr: node, index: path[path.length - 1] as number };
}

// ---------------------------------------------------------------------------
// Normalisation before diffing: drop pending tracked changes (Robin's
// suggestions live in the document as revisions; the history must see the
// document as it would read with everything accepted) and replace image
// payloads with a short digest so snapshots stay small and comparable.

function revisionIdsOfType(sfdt: any, type: string): Set<string> {
  const ids = new Set<string>();
  for (const rev of sfdt?.revisions ?? []) {
    if (String(rev?.revisionType) === type && rev?.revisionId != null)
      ids.add(String(rev.revisionId));
  }
  return ids;
}

function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function normalizeForDiff(sfdt: any): any {
  const doc = JSON.parse(JSON.stringify(sfdt ?? {}));
  const deletions = revisionIdsOfType(doc, 'Deletion');
  const moveFrom = revisionIdsOfType(doc, 'MoveFrom');
  const dropIds = new Set([...deletions, ...moveFrom]);
  const isDropped = (node: any) =>
    Array.isArray(node?.revisionIds) &&
    node.revisionIds.length > 0 &&
    node.revisionIds.every((id: unknown) => dropIds.has(String(id)));

  const walkInlines = (inlines: any[]): any[] =>
    inlines
      .filter((inline) => !isDropped(inline))
      .map((inline) => {
        const next = { ...inline };
        delete next.revisionIds;
        if (
          typeof next.imageString === 'string' &&
          next.imageString.length > 64
        ) {
          next.imageString = `sha:${hash32(next.imageString)}`;
        }
        if (Array.isArray(next.inlines))
          next.inlines = walkInlines(next.inlines);
        return next;
      });

  const walkBlocks = (blocks: any[]): any[] =>
    blocks
      .filter((block) => {
        // A paragraph whose mark is a pending deletion disappears entirely.
        const mark = block?.characterFormat;
        return !(isDropped(mark) && isParagraph(block));
      })
      .map((block) => {
        const next = { ...block };
        if (next.characterFormat?.revisionIds) {
          next.characterFormat = { ...next.characterFormat };
          delete next.characterFormat.revisionIds;
        }
        if (Array.isArray(next.inlines))
          next.inlines = walkInlines(next.inlines);
        if (Array.isArray(next.rows)) {
          next.rows = next.rows
            .filter((row: any) => !isDropped(row?.rowFormat))
            .map((row: any) => {
              const r = { ...row };
              if (r.rowFormat?.revisionIds) {
                r.rowFormat = { ...r.rowFormat };
                delete r.rowFormat.revisionIds;
              }
              r.cells = (r.cells ?? []).map((cell: any) => ({
                ...cell,
                blocks: walkBlocks(cell.blocks ?? [])
              }));
              return r;
            });
        }
        if (Array.isArray(next.blocks)) next.blocks = walkBlocks(next.blocks);
        return next;
      });

  doc.sections = (doc.sections ?? []).map((section: any) => ({
    ...section,
    blocks: walkBlocks(section.blocks ?? [])
  }));
  delete doc.revisions;
  return doc;
}

/** Deterministic content hash of a normalised document (FNV-1a, 32-bit x2). */
export function contentHash(sfdt: any): string {
  const s = JSON.stringify(sfdt);
  return hash32(s) + hash32(s.split('').reverse().join(''));
}
