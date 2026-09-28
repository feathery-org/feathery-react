// The working model a session is diffed through, one slice at a time.
//
// Every character of the document carries who inserted it, who deleted it and
// who last changed its formatting. Applying a slice diffs the slice against the
// ACCEPTED text (characters not marked deleted), so earlier authors' marks ride
// along and end up positioned against the final document for free.

import {
  BLOCK_FMT_PROPS,
  FMT_PROPS,
  FlatBlock,
  FlatDoc,
  fmtKeyOf,
  formatDelta,
  identityOf,
  regionKey,
  TOKEN_CHAR
} from './ir';
import { patienceAlign, similarity, wordDiff } from './lcs';
import type { AuthorKey, BlockPath, FormatDelta } from './types';

export interface WChar {
  ch: string;
  fmtKey: string;
  fmt: Record<string, unknown>;
  token?: unknown;
  ins?: AuthorKey;
  del?: AuthorKey;
  /** Set when formatting changed on a surviving character. */
  fmtChange?: { author: AuthorKey; props: FormatDelta };
}

export interface WBlock {
  chars: WChar[];
  paraFmt: Record<string, unknown>;
  paraFmtChange?: { author: AuthorKey; props: FormatDelta };
  insBlock?: AuthorKey;
  delBlock?: AuthorKey;
  /** Path of this block in the most recently applied slice. */
  path: BlockPath;
  rowPath?: BlockPath;
  rawTable?: unknown;
  raw: unknown;
}

export interface Working {
  blocks: WBlock[];
}

const SIMILARITY_THRESHOLD = 0.5;

function toWChars(block: FlatBlock, ins?: AuthorKey): WChar[] {
  return block.chars.map((c) => ({
    ch: c.ch,
    fmtKey: c.fmtKey,
    fmt: block.fmts.get(c.fmtKey) ?? {},
    token: c.token,
    ...(ins ? { ins } : {})
  }));
}

export function fromFlat(doc: FlatDoc): Working {
  return {
    blocks: doc.blocks.map((b) => ({
      chars: toWChars(b),
      paraFmt: b.paraFmt,
      path: b.path,
      rowPath: b.rowPath,
      rawTable: b.rawTable,
      raw: b.raw
    }))
  };
}

export function acceptedChars(block: WBlock): WChar[] {
  return block.chars.filter((c) => !c.del);
}

export function acceptedText(block: WBlock): string {
  return acceptedChars(block)
    .map((c) => c.ch)
    .join('');
}

/** Rebuild a matched block's characters from a word diff against the slice. */
function spliceBlock(
  block: WBlock,
  next: FlatBlock,
  author: AuthorKey,
  includeFormatting: boolean,
  checkBudget?: () => void
): void {
  const oldAccepted = acceptedChars(block);
  const oldText = oldAccepted.map((c) => c.ch).join('');
  const newChars = toWChars(next);
  const ops = wordDiff(oldText, next.text, checkBudget);

  // Deleted characters stay in the stream (marked) in their original order;
  // we walk the old accepted stream and the new stream in parallel.
  const result: WChar[] = [];
  let oi = 0; // index into oldAccepted
  let ni = 0; // index into newChars
  let oldAll = 0; // index into block.chars (to carry deleted chars along)

  const drainDeletedBefore = (targetAccepted: WChar | undefined) => {
    // Push any already-deleted chars that sit before the next accepted char.
    while (oldAll < block.chars.length) {
      const c = block.chars[oldAll];
      if (c === targetAccepted) break;
      if (c.del) {
        result.push(c);
        oldAll++;
      } else break;
    }
  };

  for (const op of ops) {
    const len = [...op.text].length;
    if (op.type === 'eq') {
      for (let k = 0; k < len; k++) {
        drainDeletedBefore(oldAccepted[oi]);
        const oldChar = oldAccepted[oi++];
        const newChar = newChars[ni++];
        oldAll++;
        const merged: WChar = {
          ...oldChar,
          fmtKey: newChar.fmtKey,
          fmt: newChar.fmt,
          token: newChar.token ?? oldChar.token
        };
        if (includeFormatting && oldChar.fmtKey !== newChar.fmtKey) {
          const delta = formatDelta(oldChar.fmt, newChar.fmt, FMT_PROPS);
          if (delta && !merged.ins) {
            // Keep the very first "before" if an earlier slice already changed it.
            const before = oldChar.fmtChange?.props ?? {};
            const props: FormatDelta = {};
            for (const [k, [, after]] of Object.entries(delta)) {
              props[k] = [before[k]?.[0] ?? delta[k][0], after];
            }
            merged.fmtChange = { author, props };
          }
        }
        result.push(merged);
      }
    } else if (op.type === 'del') {
      for (let k = 0; k < len; k++) {
        drainDeletedBefore(oldAccepted[oi]);
        const oldChar = oldAccepted[oi++];
        oldAll++;
        if (oldChar.ins && oldChar.ins === author) continue; // self-revert
        result.push({ ...oldChar, del: author, fmtChange: undefined });
      }
    } else {
      for (let k = 0; k < len; k++) {
        const newChar = newChars[ni++];
        result.push({ ...newChar, ins: author });
      }
    }
  }
  // Trailing already-deleted chars.
  while (oldAll < block.chars.length) {
    const c = block.chars[oldAll++];
    if (c.del) result.push(c);
  }

  block.chars = result;
  if (includeFormatting) {
    const delta = formatDelta(block.paraFmt, next.paraFmt, BLOCK_FMT_PROPS);
    if (delta) {
      const before = block.paraFmtChange?.props ?? {};
      const props: FormatDelta = {};
      for (const [k, [, after]] of Object.entries(delta)) {
        props[k] = [before[k]?.[0] ?? delta[k][0], after];
      }
      block.paraFmtChange = { author, props };
    }
  }
  block.paraFmt = next.paraFmt;
  block.path = next.path;
  block.rowPath = next.rowPath;
  block.rawTable = next.rawTable;
  block.raw = next.raw;
}

function insertedBlock(next: FlatBlock, author: AuthorKey): WBlock {
  return {
    chars: toWChars(next, author),
    paraFmt: next.paraFmt,
    insBlock: author,
    path: next.path,
    rowPath: next.rowPath,
    rawTable: next.rawTable,
    raw: next.raw
  };
}

function markDeleted(block: WBlock, author: AuthorKey): void {
  if (block.insBlock && block.insBlock === author) {
    block.chars = [];
    block.delBlock = author;
    block.insBlock = undefined;
    (block as any).selfReverted = true;
    return;
  }
  block.delBlock = author;
  block.chars = block.chars.map((c) =>
    c.del ? c : { ...c, del: author, fmtChange: undefined }
  );
}

/**
 * Apply one slice: align the working (accepted) blocks against the slice's
 * blocks, then mark insertions, deletions and formatting changes by `author`.
 */
export function applySlice(
  working: Working,
  slice: FlatDoc,
  author: AuthorKey,
  includeFormatting = true,
  checkBudget?: () => void
): void {
  const live = working.blocks.filter((b) => !b.delBlock);
  const oldKeys = live.map(
    (b) => `${regionKey(b.path)}:${identityOf(acceptedText(b))}`
  );
  const newKeys = slice.blocks.map(
    (b) => `${regionKey(b.path)}:${identityOf(b.text)}`
  );
  const pairs = patienceAlign(oldKeys, newKeys, checkBudget);

  const nextBlocks: WBlock[] = [];
  let li = 0; // index into live
  let ni = 0; // index into slice.blocks
  let wi = 0; // index into working.blocks (to carry deleted blocks along)

  const carryDeletedUpTo = (liveBlock: WBlock | undefined) => {
    while (wi < working.blocks.length) {
      const b = working.blocks[wi];
      if (b === liveBlock) break;
      if (b.delBlock) {
        nextBlocks.push(b);
        wi++;
      } else break;
    }
  };

  const handleGap = (liveEnd: number, newEnd: number) => {
    const olds = live.slice(li, liveEnd);
    const news = slice.blocks.slice(ni, newEnd);
    // Pair by position while similar enough; the rest are removed / added.
    let oi = 0;
    let nj = 0;
    while (oi < olds.length || nj < news.length) {
      checkBudget?.();
      const o = olds[oi];
      const n = news[nj];
      if (
        o &&
        n &&
        regionKey(o.path) === regionKey(n.path) &&
        similarity(acceptedText(o), n.text) >= SIMILARITY_THRESHOLD
      ) {
        carryDeletedUpTo(o);
        spliceBlock(o, n, author, includeFormatting, checkBudget);
        nextBlocks.push(o);
        wi++;
        oi++;
        nj++;
      } else if (o && (!n || olds.length - oi >= news.length - nj)) {
        carryDeletedUpTo(o);
        markDeleted(o, author);
        nextBlocks.push(o);
        wi++;
        oi++;
      } else if (n) {
        nextBlocks.push(insertedBlock(n, author));
        nj++;
      }
    }
    li = liveEnd;
    ni = newEnd;
  };

  for (const p of pairs) {
    checkBudget?.();
    handleGap(p.a, p.b);
    const o = live[p.a];
    carryDeletedUpTo(o);
    spliceBlock(o, slice.blocks[p.b], author, includeFormatting, checkBudget);
    nextBlocks.push(o);
    wi++;
    li = p.a + 1;
    ni = p.b + 1;
  }
  handleGap(live.length, slice.blocks.length);
  carryDeletedUpTo(undefined);
  working.blocks = nextBlocks.filter((b) => !(b as any).selfReverted);
}

export { fmtKeyOf, TOKEN_CHAR };
