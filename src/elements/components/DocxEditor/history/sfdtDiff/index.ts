// Public API of the version-history diff engine.
//
//   diffSession(S0, slices)            → ChangeList (hunks anchored to the final slice)
//   applyHunks(finalSfdt, changeList)  → display SFDT with synthetic revisions
//
// Both are pure. The engine runs at session close (in the browser) and the
// viewer applies the stored hunks later without diffing anything.

import {
  acceptedText,
  applySlice,
  fromFlat,
  WBlock,
  WChar,
  Working
} from './chain';
import {
  contentHash,
  containerOf,
  flattenSfdt,
  getBlock,
  normalizeForDiff,
  TOKEN_CHAR
} from './ir';
import type {
  AuthorKey,
  BlockPath,
  ChangeList,
  DiffOptions,
  Hunk,
  Slice
} from './types';

export * from './types';
export { normalizeForDiff, contentHash } from './ir';

/** Author key prefix that marks a formatting-only revision in the viewer. */
export const FMT_AUTHOR_PREFIX = 'fmt:';

const DEFAULT_MAX_BLOCKS = 5000;

/**
 * Diff a session. `slices` are the document states in order, each tagged with
 * the author whose edits produced that state; the LAST slice must be the final
 * document (F). `start` is the state at session start.
 */
export function diffSession(
  start: unknown,
  slices: Slice[],
  sessionId: string,
  options: DiffOptions = {}
): ChangeList {
  const now = options.now ?? (() => Date.now());
  const began = now();
  const includeFormatting = options.includeFormatting ?? true;
  const degraded: string[] = [];
  if (!slices.length) throw new Error('diffSession: no slices');

  const s0 = normalizeForDiff(start);
  const working: Working = fromFlat(flattenSfdt(s0));
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;

  for (const slice of slices) {
    if (options.timeBudgetMs && now() - began > options.timeBudgetMs) {
      degraded.push('time-budget');
      break;
    }
    const flat = flattenSfdt(normalizeForDiff(slice.sfdt));
    if (flat.blocks.length > maxBlocks) degraded.push('block-cap');
    applySlice(working, flat, slice.author, includeFormatting);
  }

  const finalDoc = normalizeForDiff(slices[slices.length - 1].sfdt);
  const hunks = emitHunks(working);
  const authors = Array.from(
    new Set(hunks.map((h) => h.author))
  ) as AuthorKey[];
  return {
    v: 1,
    sessionId,
    final_sha256: contentHash(finalDoc),
    hunks,
    changeCount: hunks.filter((h) => !h.type.startsWith('fmt')).length,
    formatChangeCount: hunks.filter((h) => h.type.startsWith('fmt')).length,
    authors,
    ...(degraded.length ? { degraded } : {})
  };
}

// ---------------------------------------------------------------------------
// Emitting hunks against the final document.

function rawParagraphFrom(block: WBlock): unknown {
  // A plain paragraph carrying the deleted characters with their formats.
  const inlines: any[] = [];
  for (const c of block.chars) {
    if (c.token) {
      inlines.push({ ...(c.token as any) });
      continue;
    }
    const last = inlines[inlines.length - 1];
    if (last && typeof last.text === 'string' && last.__fmtKey === c.fmtKey) {
      last.text += c.ch;
    } else {
      inlines.push({
        characterFormat: { ...c.fmt },
        text: c.ch,
        __fmtKey: c.fmtKey
      });
    }
  }
  for (const inline of inlines) delete inline.__fmtKey;
  return { paragraphFormat: { ...block.paraFmt }, inlines };
}

function emitHunks(working: Working): Hunk[] {
  const hunks: Hunk[] = [];
  let nextId = 1;
  const blocks = working.blocks;

  // Anchor for deleted blocks: the path of the next surviving block.
  const nextSurvivingPath = (from: number): BlockPath => {
    for (let i = from; i < blocks.length; i++) {
      if (!blocks[i].delBlock) return blocks[i].path;
    }
    // Past the end: one past the last surviving block's index.
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!blocks[i].delBlock) {
        const p = [...blocks[i].path];
        p[p.length - 1] = (p[p.length - 1] as number) + 1;
        return p;
      }
    }
    return [0, 'blocks', 0];
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.delBlock) {
      // Consecutive deleted blocks by the same author share one hunk.
      const removed: unknown[] = [rawParagraphFrom(block)];
      const author = block.delBlock;
      while (bi + 1 < blocks.length && blocks[bi + 1].delBlock === author) {
        bi++;
        removed.push(rawParagraphFrom(blocks[bi]));
      }
      hunks.push({
        id: nextId++,
        author,
        type: 'del_block',
        at: { block: nextSurvivingPath(bi + 1) },
        blocks: removed
      });
      continue;
    }
    if (block.insBlock) {
      const author = block.insBlock;
      const startPath = block.path;
      let count = 1;
      while (
        bi + 1 < blocks.length &&
        blocks[bi + 1].insBlock === author &&
        sameContainer(blocks[bi + 1].path, startPath)
      ) {
        bi++;
        count++;
      }
      hunks.push({
        id: nextId++,
        author,
        type: 'ins_block',
        at: { block: startPath },
        count
      });
      continue;
    }
    if (block.paraFmtChange) {
      hunks.push({
        id: nextId++,
        author: block.paraFmtChange.author,
        type: 'fmt_block',
        at: { block: block.path },
        props: block.paraFmtChange.props
      });
    }
    emitInlineHunks(block, hunks, () => nextId++);
  }
  return hunks;
}

function sameContainer(a: BlockPath, b: BlockPath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i++) if (a[i] !== b[i]) return false;
  return true;
}

function emitInlineHunks(block: WBlock, hunks: Hunk[], id: () => number): void {
  const chars = block.chars;
  let offset = 0; // offset in the final (accepted) text
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (c.del) {
      const author = c.del;
      let text = '';
      const fmt = c.fmt;
      let uniform = true;
      while (i < chars.length && chars[i].del === author) {
        text += chars[i].ch;
        if (chars[i].fmtKey !== c.fmtKey) uniform = false;
        i++;
      }
      const delHunk: Hunk = {
        id: id(),
        author,
        type: 'del',
        at: { block: block.path, offset },
        text,
        ...(uniform ? { characterFormat: { ...fmt } } : {})
      };
      hunks.push(delHunk);
      // A replace: insertion by the same author immediately following.
      if (i < chars.length && chars[i].ins === author && !chars[i].del) {
        let length = 0;
        while (i < chars.length && chars[i].ins === author && !chars[i].del) {
          length++;
          i++;
        }
        hunks.push({
          id: delHunk.id,
          author,
          type: 'ins',
          at: { block: block.path, offset, length }
        });
        offset += length;
      }
      continue;
    }
    if (c.ins) {
      const author = c.ins;
      let length = 0;
      while (i < chars.length && chars[i].ins === author && !chars[i].del) {
        length++;
        i++;
      }
      hunks.push({
        id: id(),
        author,
        type: 'ins',
        at: { block: block.path, offset, length }
      });
      offset += length;
      continue;
    }
    if (c.fmtChange) {
      const author = c.fmtChange.author;
      const key = JSON.stringify(c.fmtChange.props);
      let length = 0;
      while (
        i < chars.length &&
        !chars[i].del &&
        !chars[i].ins &&
        chars[i].fmtChange &&
        chars[i].fmtChange!.author === author &&
        JSON.stringify(chars[i].fmtChange!.props) === key
      ) {
        length++;
        i++;
      }
      hunks.push({
        id: id(),
        author,
        type: 'fmt',
        at: { block: block.path, offset, length },
        props: c.fmtChange.props
      });
      offset += length;
      continue;
    }
    offset++;
    i++;
  }
}

// ---------------------------------------------------------------------------
// Applying hunks to the final document for display.

interface Mark {
  revisionId: string;
}

interface DisplayChar {
  ch: string;
  fmt: Record<string, unknown>;
  fmtKey: string;
  token?: unknown;
  revisionIds: string[];
}

function flattenForDisplay(para: any): DisplayChar[] {
  const out: DisplayChar[] = [];
  const walk = (inlines: any[], inherited?: Record<string, unknown>) => {
    for (const inline of inlines ?? []) {
      if (!inline || typeof inline !== 'object') continue;
      const fmt = inline.characterFormat ?? inherited ?? {};
      if (Array.isArray(inline.inlines)) {
        walk(inline.inlines, fmt);
        continue;
      }
      const fmtKey = JSON.stringify(fmt);
      if (typeof inline.text === 'string') {
        for (const ch of inline.text)
          out.push({ ch, fmt, fmtKey, revisionIds: [] });
      } else {
        out.push({
          ch: TOKEN_CHAR,
          fmt,
          fmtKey,
          token: inline,
          revisionIds: []
        });
      }
    }
  };
  walk(para.inlines ?? []);
  return out;
}

function rebuildInlines(chars: DisplayChar[]): any[] {
  const inlines: any[] = [];
  for (const c of chars) {
    if (c.token) {
      const t = { ...(c.token as any) };
      if (c.revisionIds.length) t.revisionIds = [...c.revisionIds];
      inlines.push(t);
      continue;
    }
    const revKey = c.revisionIds.join(',');
    const last = inlines[inlines.length - 1];
    if (
      last &&
      typeof last.text === 'string' &&
      last.__fmtKey === c.fmtKey &&
      last.__revKey === revKey
    ) {
      last.text += c.ch;
    } else {
      const inline: any = { characterFormat: { ...c.fmt }, text: c.ch };
      if (c.revisionIds.length) inline.revisionIds = [...c.revisionIds];
      inline.__fmtKey = c.fmtKey;
      inline.__revKey = revKey;
      inlines.push(inline);
    }
  }
  for (const inline of inlines) {
    delete inline.__fmtKey;
    delete inline.__revKey;
  }
  return inlines;
}

/**
 * Build the display document: the final document plus synthetic revisions for
 * every hunk. Deleted text is re-inserted as Deletion runs, inserted ranges
 * become Insertion runs, formatting ranges become Insertion runs authored
 * `fmt:<author>` (Syncfusion has no formatting revision type; the renderer
 * keys off the prefix).
 */
export function applyHunks(finalSfdt: unknown, changes: ChangeList): any {
  const doc = JSON.parse(JSON.stringify(finalSfdt));
  const revisions: any[] = Array.isArray(doc.revisions)
    ? [...doc.revisions]
    : [];
  const date = new Date().toISOString();
  const changeSetId = `version:${changes.sessionId}`;
  let seq = 0;
  const newRevision = (
    type: 'Insertion' | 'Deletion',
    author: string,
    hunkId: number
  ): Mark => {
    const revisionId = `vh-${hunkId}-${(seq++).toString(36)}`;
    revisions.push({
      author,
      date,
      revisionType: type,
      revisionId,
      customData: JSON.stringify({
        v: 1,
        source: 'history',
        changeSetId,
        group: `h${hunkId}`
      })
    });
    return { revisionId };
  };

  // Inline hunks first (they don't move blocks), grouped per block.
  const byBlock = new Map<string, Hunk[]>();
  for (const hunk of changes.hunks) {
    if (hunk.type === 'del_block' || hunk.type === 'ins_block') continue;
    const key = JSON.stringify(hunk.at.block);
    const list = byBlock.get(key) ?? [];
    list.push(hunk);
    byBlock.set(key, list);
  }
  for (const [key, list] of byBlock) {
    const path: BlockPath = JSON.parse(key);
    const para = getBlock(doc, path);
    if (!para || !Array.isArray(para.inlines)) continue;
    const chars = flattenForDisplay(para);
    // Range marks (ins / fmt) on existing characters.
    for (const hunk of list) {
      if (hunk.type === 'ins' || hunk.type === 'fmt') {
        const author =
          hunk.type === 'fmt'
            ? `${FMT_AUTHOR_PREFIX}${hunk.author}`
            : hunk.author;
        const mark = newRevision('Insertion', author, hunk.id);
        for (let k = hunk.at.offset; k < hunk.at.offset + hunk.at.length; k++) {
          chars[k]?.revisionIds.push(mark.revisionId);
        }
      } else if (hunk.type === 'fmt_block') {
        const mark = newRevision(
          'Insertion',
          `${FMT_AUTHOR_PREFIX}${hunk.author}`,
          hunk.id
        );
        para.characterFormat = {
          ...(para.characterFormat ?? {}),
          revisionIds: [
            ...((para.characterFormat?.revisionIds as string[]) ?? []),
            mark.revisionId
          ]
        };
      }
    }
    // Deletions: insert removed text at its offset (descending so offsets hold).
    const dels = list
      .filter((h): h is Extract<Hunk, { type: 'del' }> => h.type === 'del')
      .sort((a, b) => b.at.offset - a.at.offset);
    for (const hunk of dels) {
      const mark = newRevision('Deletion', hunk.author, hunk.id);
      const fmt = hunk.characterFormat ?? chars[hunk.at.offset]?.fmt ?? {};
      const inserted: DisplayChar[] = [...hunk.text].map((ch) => ({
        ch,
        fmt,
        fmtKey: JSON.stringify(fmt),
        revisionIds: [mark.revisionId]
      }));
      chars.splice(hunk.at.offset, 0, ...inserted);
    }
    para.inlines = rebuildInlines(chars);
  }

  // Whole-block insertions: mark every inline and the paragraph mark.
  for (const hunk of changes.hunks) {
    if (hunk.type !== 'ins_block') continue;
    const mark = newRevision('Insertion', hunk.author, hunk.id);
    for (let k = 0; k < hunk.count; k++) {
      const path = [...hunk.at.block];
      path[path.length - 1] = (path[path.length - 1] as number) + k;
      const para = getBlock(doc, path);
      if (!para || !Array.isArray(para.inlines)) continue;
      const chars = flattenForDisplay(para);
      for (const c of chars) c.revisionIds.push(mark.revisionId);
      para.inlines = rebuildInlines(chars);
      para.characterFormat = {
        ...(para.characterFormat ?? {}),
        revisionIds: [
          ...((para.characterFormat?.revisionIds as string[]) ?? []),
          mark.revisionId
        ]
      };
    }
  }

  // Whole-block deletions: re-insert the removed paragraphs before their anchor.
  // Descending path order so earlier insertions don't shift later anchors.
  const delBlocks = changes.hunks
    .filter(
      (h): h is Extract<Hunk, { type: 'del_block' }> => h.type === 'del_block'
    )
    .sort((a, b) => comparePaths(b.at.block, a.at.block));
  for (const hunk of delBlocks) {
    const mark = newRevision('Deletion', hunk.author, hunk.id);
    const { arr, index } = containerOf(doc, hunk.at.block);
    if (!Array.isArray(arr)) continue;
    const paras = hunk.blocks.map((raw: any) => {
      const para = JSON.parse(JSON.stringify(raw));
      const chars = flattenForDisplay(para);
      for (const c of chars) c.revisionIds.push(mark.revisionId);
      para.inlines = rebuildInlines(chars);
      para.characterFormat = {
        ...(para.characterFormat ?? {}),
        revisionIds: [mark.revisionId]
      };
      return para;
    });
    arr.splice(Math.min(index, arr.length), 0, ...paras);
  }

  doc.revisions = revisions;
  doc.optimizeSfdt = false;
  return doc;
}

function comparePaths(a: BlockPath, b: BlockPath): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    if (typeof a[i] === 'number' && typeof b[i] === 'number')
      return (a[i] as number) - (b[i] as number);
    return String(a[i]) < String(b[i]) ? -1 : 1;
  }
  return a.length - b.length;
}

/** Convenience used by tests: plain text of a working block. */
export { acceptedText };
export type { WBlock, WChar };
