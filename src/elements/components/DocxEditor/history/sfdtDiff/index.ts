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
  regionKey,
  visitDocumentRegions,
  tableParagraphCount,
  TOKEN_CHAR
} from './ir';
import type {
  AuthorKey,
  BlockPath,
  ChangeList,
  DiffOptions,
  Hunk,
  RevisionRun,
  Slice
} from './types';

export * from './types';
export {
  normalizeForDiff,
  contentHash,
  hash32,
  IMAGE_DIGEST_MIN_LENGTH,
  IMAGE_DIGEST_PREFIX
} from './ir';

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
  const timedOut = new Error('diff time budget exceeded');
  const checkBudget = () => {
    if (options.timeBudgetMs && now() - began > options.timeBudgetMs)
      throw timedOut;
  };

  for (const slice of slices) {
    if (options.timeBudgetMs && now() - began > options.timeBudgetMs) {
      degraded.push('time-budget');
      break;
    }
    const flat = flattenSfdt(normalizeForDiff(slice.sfdt));
    if (flat.blocks.length > maxBlocks || working.blocks.length > maxBlocks) {
      degraded.push('block-cap');
      break;
    }
    try {
      checkBudget();
      applySlice(working, flat, slice.author, includeFormatting, checkBudget);
      checkBudget();
    } catch (error) {
      if (error !== timedOut) throw error;
      degraded.push('time-budget');
      break;
    }
  }

  const finalDoc = normalizeForDiff(slices[slices.length - 1].sfdt);
  // Partial slices are anchored to an intermediate document. Never paint them
  // onto F: their offsets and authors can refer to entirely different content.
  const hunks = degraded.length ? [] : emitHunks(working);
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

const tablePathOf = (path: BlockPath): BlockPath | null => {
  const rowIndex = path.indexOf('rows');
  return rowIndex > 0 ? path.slice(0, rowIndex) : null;
};

const samePath = (a: BlockPath | null, b: BlockPath | null): boolean =>
  a !== null &&
  b !== null &&
  a.length === b.length &&
  a.every((part, index) => part === b[index]);

// The deleted run's table, but ONLY when the run removes the whole table: every
// block shares one carried table reference (so it is the real structure from
// the document the blocks last lived in — never a stale S0 path lookup) and the
// run covers all of its paragraphs (a partial row deletion must not resurrect
// the surviving rows as a duplicate struck table).
function wholeDeletedTable(runBlocks: WBlock[]): unknown {
  const table = runBlocks[0]?.rawTable as any;
  if (!table || !Array.isArray(table.rows)) return undefined;
  if (!runBlocks.every((b) => b.rawTable === table)) return undefined;
  return tableParagraphCount(table) === runBlocks.length ? table : undefined;
}

function emitHunks(working: Working): Hunk[] {
  const hunks: Hunk[] = [];
  let nextId = 1;
  const blocks = working.blocks;

  // Anchor for deleted blocks: the path of the next surviving block.
  const nextSurvivingPath = (from: number, origin: BlockPath): BlockPath => {
    const region = regionKey(origin);
    for (let i = from; i < blocks.length; i++) {
      if (!blocks[i].delBlock && regionKey(blocks[i].path) === region)
        return blocks[i].path;
    }
    // Past the end: one past the last surviving block's index.
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (!blocks[i].delBlock && regionKey(blocks[i].path) === region) {
        const p = [...blocks[i].path];
        p[p.length - 1] = (p[p.length - 1] as number) + 1;
        return p;
      }
    }
    return [
      ...origin.slice(0, origin[1] === 'headersFooters' ? 3 : 1),
      'blocks',
      0
    ];
  };

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    if (block.delBlock) {
      // Consecutive deleted blocks by the same author share one hunk.
      const removed: unknown[] = [rawParagraphFrom(block)];
      const runBlocks: WBlock[] = [block];
      const tablePath = tablePathOf(block.path);
      let deletesOnlyThisTable = !!tablePath;
      const author = block.delBlock;
      while (
        bi + 1 < blocks.length &&
        blocks[bi + 1].delBlock === author &&
        regionKey(blocks[bi + 1].path) === regionKey(block.path)
      ) {
        bi++;
        removed.push(rawParagraphFrom(blocks[bi]));
        runBlocks.push(blocks[bi]);
        if (!samePath(tablePath, tablePathOf(blocks[bi].path)))
          deletesOnlyThisTable = false;
      }
      const table = deletesOnlyThisTable
        ? wholeDeletedTable(runBlocks)
        : undefined;
      hunks.push({
        id: nextId++,
        author,
        type: 'del_block',
        at: { block: nextSurvivingPath(bi + 1, block.path) },
        blocks: removed,
        ...(table ? { table } : {})
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
  /** The content control this char belongs to (its properties), so the wrapper
   *  can be rebuilt; undefined for chars outside any content control. */
  cc?: Record<string, unknown>;
  /** Per-occurrence id so adjacent runs of the SAME content control regroup. */
  ccId?: number;
}

function flattenForDisplay(para: any): DisplayChar[] {
  const out: DisplayChar[] = [];
  let ccCounter = 0;
  const walk = (
    inlines: any[],
    inherited: Record<string, unknown> | undefined,
    cc: Record<string, unknown> | undefined,
    ccId: number | undefined
  ) => {
    for (const inline of inlines ?? []) {
      if (!inline || typeof inline !== 'object') continue;
      const fmt = inline.characterFormat ?? inherited ?? {};
      if (Array.isArray(inline.inlines)) {
        // A content control wraps nested inlines; tag its children so the
        // wrapper survives the rebuild (bound fields must keep rendering).
        const ccProps = inline.contentControlProperties ?? inline.ccp;
        if (ccProps) walk(inline.inlines, fmt, ccProps, ++ccCounter);
        else walk(inline.inlines, fmt, cc, ccId);
        continue;
      }
      const fmtKey = JSON.stringify(fmt);
      if (typeof inline.text === 'string') {
        for (const ch of inline.text)
          out.push({ ch, fmt, fmtKey, revisionIds: [], cc, ccId });
      } else {
        out.push({
          ch: TOKEN_CHAR,
          fmt,
          fmtKey,
          token: inline,
          revisionIds: [],
          cc,
          ccId
        });
      }
    }
  };
  walk(para.inlines ?? [], undefined, undefined, undefined);
  return out;
}

function rebuildInlines(chars: DisplayChar[]): any[] {
  // First coalesce chars into runs (carrying their content-control tag)...
  const runs: any[] = [];
  for (const c of chars) {
    if (c.token) {
      const t = { ...(c.token as any) };
      if (c.revisionIds.length) t.revisionIds = [...c.revisionIds];
      t.__ccId = c.ccId;
      t.__cc = c.cc;
      runs.push(t);
      continue;
    }
    const revKey = c.revisionIds.join(',');
    const last = runs[runs.length - 1];
    if (
      last &&
      typeof last.text === 'string' &&
      last.__fmtKey === c.fmtKey &&
      last.__revKey === revKey &&
      last.__ccId === c.ccId
    ) {
      last.text += c.ch;
    } else {
      const inline: any = { characterFormat: { ...c.fmt }, text: c.ch };
      if (c.revisionIds.length) inline.revisionIds = [...c.revisionIds];
      inline.__fmtKey = c.fmtKey;
      inline.__revKey = revKey;
      inline.__ccId = c.ccId;
      inline.__cc = c.cc;
      runs.push(inline);
    }
  }
  // ...then re-wrap consecutive runs of the same content control in it.
  const out: any[] = [];
  let i = 0;
  while (i < runs.length) {
    const ccId = runs[i].__ccId;
    const cc = runs[i].__cc;
    if (ccId == null) {
      out.push(clean(runs[i]));
      i++;
      continue;
    }
    const group: any[] = [];
    while (i < runs.length && runs[i].__ccId === ccId) {
      group.push(clean(runs[i]));
      i++;
    }
    out.push({ contentControlProperties: cc, inlines: group });
  }
  return out;

  function clean(inline: any): any {
    delete inline.__fmtKey;
    delete inline.__revKey;
    delete inline.__ccId;
    delete inline.__cc;
    return inline;
  }
}

interface PendingRun {
  kind: 'ins' | 'del';
  text: string;
  /** The revision's author key ('robin' for the assistant), for re-attribution. */
  author: AuthorKey;
  /** Robin's original tracked-change group, if the revision was tagged. */
  group?: string;
}

// The assistant writes tracked changes under the document author 'Robin'; the
// diff's author key is 'robin'. Normalise a live-revision author to that key so
// a re-attributed edit gets the assistant's brand colour, not a palette one.
function authorKeyOf(author: string): AuthorKey {
  return author.trim().toLowerCase().startsWith('robin') ? 'robin' : author;
}

/**
 * Every LIVE tracked change still in F — the assistant's edits the user has not
 * accepted yet. Our own display revisions use `vh-` ids and are skipped, so what
 * remains is the pending suggestions. Each run is one live revision's
 * concatenated text with its author, tagged insert or delete; applyHunks matches
 * a hunk's text against these to mark it pending AND re-attribute it to the real
 * author (the diff can mis-credit a still-tracked assistant edit to the viewer).
 */
function collectPendingRuns(doc: any, revisionIds?: Set<string>): PendingRun[] {
  const revs: any[] = Array.isArray(doc?.revisions) ? doc.revisions : [];
  const metaById = new Map<
    string,
    { kind: 'ins' | 'del'; author: string; group?: string }
  >();
  for (const r of revs) {
    const id = r?.revisionId != null ? String(r.revisionId) : null;
    if (!id || id.startsWith('vh-')) continue;
    if (revisionIds && !revisionIds.has(id)) continue;
    const type = String(r?.revisionType);
    const author = String(r?.author ?? '');
    let group: string | undefined;
    try {
      const customData = JSON.parse(r?.customData ?? '{}');
      if (
        customData?.source === 'robin' &&
        typeof customData.group === 'string'
      )
        group = customData.group;
    } catch {
      // Older or untagged tracked revisions do not carry a usable group.
    }
    if (type === 'Insertion' || type === 'MoveTo')
      metaById.set(id, { kind: 'ins', author, group });
    else if (type === 'Deletion' || type === 'MoveFrom')
      metaById.set(id, { kind: 'del', author, group });
  }
  if (!metaById.size) return [];
  const textById = new Map<string, string>();
  const visitInlines = (inlines: any[]) => {
    for (const inline of inlines ?? []) {
      if (!inline || typeof inline !== 'object') continue;
      if (Array.isArray(inline.inlines)) {
        visitInlines(inline.inlines);
        continue;
      }
      const ids: string[] = Array.isArray(inline.revisionIds)
        ? inline.revisionIds.map(String)
        : [];
      if (typeof inline.text === 'string' && ids.length) {
        for (const id of ids) {
          if (metaById.has(id))
            textById.set(id, (textById.get(id) ?? '') + inline.text);
        }
      }
    }
  };
  const visitBlocks = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (!b || typeof b !== 'object') continue;
      if (Array.isArray(b.inlines)) visitInlines(b.inlines);
      if (Array.isArray(b.blocks)) visitBlocks(b.blocks);
      if (Array.isArray(b.rows))
        for (const row of b.rows)
          for (const cell of row?.cells ?? []) visitBlocks(cell?.blocks ?? []);
    }
  };
  visitDocumentRegions(doc, visitBlocks);
  const runs: PendingRun[] = [];
  for (const [id, text] of textById) {
    const meta = metaById.get(id);
    if (meta && text.trim())
      runs.push({
        kind: meta.kind,
        text,
        author: authorKeyOf(meta.author),
        ...(meta.group ? { group: meta.group } : {})
      });
  }
  return runs;
}

/**
 * The text Robin has authored in a live document, as {kind,text} runs. Captured
 * at edit time (while the revisions are still live) so it survives the user
 * accepting the suggestion — the session hook stores these on the change list,
 * and applyHunks uses them to keep an accepted Robin edit coloured as Robin.
 */
export function collectRobinRuns(
  doc: any,
  revisionIds?: string[]
): RevisionRun[] {
  return collectPendingRuns(doc, revisionIds ? new Set(revisionIds) : undefined)
    .filter((r) => r.author === 'robin')
    .map((r) => ({
      kind: r.kind,
      text: r.text,
      ...(r.group ? { group: r.group } : {})
    }));
}

/**
 * The bucket a display revision steps/counts under. Every revision — assistant
 * or human — groups by its hunk group, so one CONTIGUOUS block of edits is one
 * step: a replace's halves share a hunk id (emitInlineHunks), and consecutive
 * same-author block insertions coalesce into one ins_block hunk (emitHunks), so
 * e.g. a whole table Robin inserted steps as a single edit. Empty paragraphs
 * at the edge of such a hunk get their own group so stepping lands on text.
 * Grouping is by the
 * edit's shape, NOT by session/turn, so it stays correct when a session holds
 * several assistant turns. Returns null for revisions that are not ours.
 */
export function editGroupKey(revision: any): string | null {
  let cd: any;
  try {
    cd = JSON.parse(revision?.customData ?? '{}');
  } catch {
    return null;
  }
  if (cd.source !== 'history') return null;
  return String(cd.group ?? revision.revisionId ?? '');
}

/** Authors of the rendered history revisions, excluding native suggestions. */
export function trackedAuthorKeys(displayDoc: any): string[] {
  return Array.from(
    new Set<string>(
      (displayDoc?.revisions ?? [])
        .filter((revision: any) => editGroupKey(revision) !== null)
        .map((revision: any) =>
          String(revision.author ?? '').replace(/^fmt:/, '')
        )
    )
  );
}

/** Revision ids that mark at least one NON-EMPTY text inline in the display —
 *  i.e. edits with visible content. A blank inserted line's revision only sits
 *  on a paragraph mark, so it never lands in this set. */
function revisionIdsWithText(doc: any): Set<string> {
  const ids = new Set<string>();
  const visitInlines = (inlines: any[]) => {
    for (const inline of inlines ?? []) {
      if (!inline || typeof inline !== 'object') continue;
      if (Array.isArray(inline.inlines)) {
        visitInlines(inline.inlines);
        continue;
      }
      if (
        typeof inline.text === 'string' &&
        inline.text.length > 0 &&
        Array.isArray(inline.revisionIds)
      )
        for (const id of inline.revisionIds) ids.add(String(id));
    }
  };
  const visitBlocks = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (!b || typeof b !== 'object') continue;
      if (Array.isArray(b.inlines)) visitInlines(b.inlines);
      if (Array.isArray(b.blocks)) visitBlocks(b.blocks);
      if (Array.isArray(b.rows))
        for (const row of b.rows)
          for (const cell of row?.cells ?? []) visitBlocks(cell?.blocks ?? []);
    }
  };
  visitDocumentRegions(doc, visitBlocks);
  return ids;
}

/**
 * Count the distinct EDITS in a display document the way the version bar and
 * the prev/next steppers present them: one per edit group (see editGroupKey),
 * with formatting-only revisions excluded — they are counted separately.
 * Groups with no visible content (an inserted blank line: paragraph-mark-only)
 * are excluded, matching the steppers, so the "N edits" label never exceeds
 * what stepping visits. Falls back to counting every group only when a version
 * holds nothing but blank-line edits (again mirroring the steppers).
 */
export function countEditGroups(displayDoc: any): number {
  const textIds = revisionIdsWithText(displayDoc);
  const withContent = new Set<string>();
  const all = new Set<string>();
  for (const r of displayDoc?.revisions ?? []) {
    const author = String(r?.author ?? '');
    if (author.startsWith(FMT_AUTHOR_PREFIX)) continue;
    const key = editGroupKey(r);
    if (key == null) continue;
    all.add(key);
    if (textIds.has(String(r.revisionId))) withContent.add(key);
  }
  return withContent.size || all.size;
}

/**
 * Count the distinct pending edits in an applyHunks display document — the
 * assistant suggestions still awaiting the user's approval — grouped so a
 * replace (its delete + insert) counts once. Drives the "N pending" label.
 */
export function countPendingGroups(displayDoc: any): number {
  const groups = new Set<string>();
  for (const r of displayDoc?.revisions ?? []) {
    try {
      const cd = JSON.parse(r?.customData ?? '{}');
      if (cd.pending) groups.add(cd.group ?? String(r.revisionId));
    } catch {
      /* a revision without our customData is not one of ours */
    }
  }
  return groups.size;
}

/**
 * Move NATIVE row-level revision marks (Syncfusion tags a tracked row insert /
 * delete on rowFormat) down onto the row's cell content, in place. The renderer
 * paints a row-level mark as a wash across every cell — a whole tracked table
 * floods solid — while cell-content marks paint like any other tracked text.
 * Used on documents shown WITHOUT a change list (a restored version, a degraded
 * row), where applyHunks never ran to normalize the marks. Returns whether
 * anything was moved.
 */
export function demoteNativeRowRevisions(doc: any): boolean {
  let changed = false;
  const markParagraphs = (blocks: any[], ids: string[]) => {
    for (const b of blocks ?? []) {
      if (!b || typeof b !== 'object') continue;
      if (Array.isArray(b.inlines)) {
        const chars = flattenForDisplay(b);
        for (const c of chars) for (const id of ids) c.revisionIds.push(id);
        b.inlines = rebuildInlines(chars);
        b.characterFormat = {
          ...(b.characterFormat ?? {}),
          revisionIds: [
            ...((b.characterFormat?.revisionIds as string[]) ?? []),
            ...ids
          ]
        };
      }
      if (Array.isArray(b.blocks)) markParagraphs(b.blocks, ids);
      if (Array.isArray(b.rows))
        for (const row of b.rows)
          for (const cell of row?.cells ?? [])
            markParagraphs(cell?.blocks ?? [], ids);
    }
  };
  const walkBlocks = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (!b || typeof b !== 'object') continue;
      if (Array.isArray(b.rows)) {
        for (const row of b.rows) {
          const ids: string[] = Array.isArray(row?.rowFormat?.revisionIds)
            ? row.rowFormat.revisionIds.map(String)
            : [];
          if (ids.length) {
            delete row.rowFormat.revisionIds;
            for (const cell of row.cells ?? [])
              markParagraphs(cell?.blocks ?? [], ids);
            changed = true;
          }
          // Nested tables inside the row's cells get their own pass.
          for (const cell of row?.cells ?? []) walkBlocks(cell?.blocks ?? []);
        }
      }
      if (Array.isArray(b.blocks)) walkBlocks(b.blocks);
    }
  };
  visitDocumentRegions(doc, walkBlocks);
  return changed;
}

/**
 * Build the display document: the final document plus synthetic revisions for
 * every hunk. Deleted text is re-inserted as Deletion runs, inserted ranges
 * become Insertion runs, formatting ranges become Insertion runs authored
 * `fmt:<author>` (Syncfusion has no formatting revision type; the renderer
 * keys off the prefix).
 */
export function applyHunks(finalSfdt: unknown, changes: ChangeList): any {
  // The assistant's edits arrive as live tracked changes; the user's edits are
  // not tracked, so any revision already in F (i.e. NOT one of our synthetic
  // `vh-` history revisions) is an assistant suggestion the user has not yet
  // accepted. Read those from the RAW document first — they tell us both which
  // edits are still pending AND who really made them.
  const raw = JSON.parse(JSON.stringify(finalSfdt));
  const pendingRuns = collectPendingRuns(raw);
  // Build the display on the ACCEPTED document: dropping the live revisions (and
  // their markup) leaves only our synthetic revisions to render — no orphaned
  // originals mis-colouring the text, and offsets that line up with the hunks
  // (which are anchored to the accepted document). Keep real image bytes.
  const doc = normalizeForDiff(raw, { digestImages: false });
  const revisions: any[] = [];
  // A hunk's pending match, if its text belongs to a still-tracked edit. Used to
  // both flag it pending and re-attribute it to that edit's real author.
  const matchPending = (
    kind: 'ins' | 'del',
    text: string
  ): PendingRun | undefined => {
    if (!pendingRuns.length) return undefined;
    const t = text.trim();
    if (!t) return undefined;
    return pendingRuns.find((r) => {
      if (r.kind !== kind) return false;
      const candidate = r.text.trim();
      // Short substrings are common words ("the", punctuation, etc.) and are
      // not reliable identity evidence across unrelated edits. Permit fuzzy
      // containment only once both sides carry enough context; exact matches
      // remain valid for short runs.
      return (
        candidate === t ||
        (candidate.length >= 8 &&
          t.length >= 8 &&
          (candidate.includes(t) || t.includes(candidate)))
      );
    });
  };
  // Robin's authored text, captured while its revisions were live (stored on the
  // change list). Unlike pendingRuns this survives the user ACCEPTING the edit,
  // so it keeps an accepted Robin edit coloured as Robin. Matched only when there
  // is no live pending match, and it never marks the edit pending (it's approved).
  const robinRuns = changes.robinRuns ?? [];
  const matchRobin = (
    kind: 'ins' | 'del',
    text: string
  ): RevisionRun | undefined => {
    if (!robinRuns.length) return undefined;
    const t = text.trim();
    if (!t) return undefined;
    return robinRuns.find((r) => {
      if (r.kind !== kind) return false;
      const candidate = r.text.trim();
      return (
        candidate === t ||
        (candidate.length >= 8 &&
          t.length >= 8 &&
          (candidate.includes(t) || t.includes(candidate)))
      );
    });
  };
  // Author + pending decision for a content hunk: a live tracked revision wins
  // (re-attributed AND pending); else an accepted Robin edit (approved, no ring);
  // else the diff's slice author.
  const resolveContentAuthor = (
    kind: 'ins' | 'del',
    text: string,
    fallbackAuthor: string
  ): { author: string; pending: boolean; group?: string } => {
    // A confirmation's hunks contain only the selected, settled revisions.
    // Identical text in another pending suggestion is not the same edit.
    const live = changes.confirmed ? undefined : matchPending(kind, text);
    if (
      live &&
      (changes.attribution !== 'slices' ||
        live.author === authorKeyOf(fallbackAuthor))
    )
      return {
        author: live.author,
        pending: true,
        ...(live.group ? { group: live.group } : {})
      };
    const robin = matchRobin(kind, text);
    if (
      robin &&
      (changes.attribution !== 'slices' ||
        authorKeyOf(fallbackAuthor) === 'robin')
    )
      return {
        author: 'robin',
        pending: false,
        ...(robin.group ? { group: robin.group } : {})
      };
    return { author: fallbackAuthor, pending: false };
  };
  const date = new Date().toISOString();
  const changeSetId = `version:${changes.sessionId}`;
  let seq = 0;
  // Step/count bucket for a hunk: its TOP-LEVEL block, scoped by author. Every
  // hunk inside one structure shares that structure's top-level index — all of a
  // table's cells are `[section,'blocks',tableIdx,...]` — so a whole table (or a
  // single paragraph) steps as ONE edit, while separate structures stay separate.
  // A replace's delete+insert share a paragraph + author, so they stay one group.
  const blockGroupKey = (author: string, block: BlockPath): string => {
    const a = authorKeyOf(String(author).replace(FMT_AUTHOR_PREFIX, ''));
    const sec = Array.isArray(block) ? block[0] : 0;
    const idx = Array.isArray(block) ? block[2] : 0; // top-level block index
    return `${a}:${sec}:${idx}`;
  };
  const newRevision = (
    type: 'Insertion' | 'Deletion',
    author: string,
    hunkId: number,
    pending = false,
    group?: string
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
        group: group ?? `h${hunkId}`,
        ...(changes.confirmed ? { confirmed: true } : {}),
        ...(pending ? { pending: true } : {})
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
        // Pending only for genuine content insertions (formatting revisions
        // aren't tracked-change suggestions the user accepts/rejects here). A
        // match also re-attributes the edit to its real author.
        const insText =
          hunk.type === 'ins'
            ? chars
                .slice(hunk.at.offset, hunk.at.offset + hunk.at.length)
                .map((c) => c.ch)
                .join('')
            : '';
        const resolved =
          hunk.type === 'ins'
            ? resolveContentAuthor('ins', insText, author)
            : { author, pending: false };
        const mark = newRevision(
          'Insertion',
          resolved.author,
          hunk.id,
          resolved.pending,
          resolved.group ?? blockGroupKey(resolved.author, hunk.at.block)
        );
        for (let k = hunk.at.offset; k < hunk.at.offset + hunk.at.length; k++) {
          chars[k]?.revisionIds.push(mark.revisionId);
        }
      } else if (hunk.type === 'fmt_block') {
        const mark = newRevision(
          'Insertion',
          `${FMT_AUTHOR_PREFIX}${hunk.author}`,
          hunk.id,
          false,
          blockGroupKey(hunk.author, hunk.at.block)
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
      const resolved = resolveContentAuthor('del', hunk.text, hunk.author);
      const mark = newRevision(
        'Deletion',
        resolved.author,
        hunk.id,
        resolved.pending,
        resolved.group ?? blockGroupKey(resolved.author, hunk.at.block)
      );
      // Inherit the surrounding char's content control so re-inserted deleted
      // text stays inside its field rather than splitting the wrapper.
      const neighbor = chars[hunk.at.offset] ?? chars[hunk.at.offset - 1];
      const fmt = hunk.characterFormat ?? neighbor?.fmt ?? {};
      const inserted: DisplayChar[] = [...hunk.text].map((ch) => ({
        ch,
        fmt,
        fmtKey: JSON.stringify(fmt),
        revisionIds: [mark.revisionId],
        cc: neighbor?.cc,
        ccId: neighbor?.ccId
      }));
      chars.splice(hunk.at.offset, 0, ...inserted);
    }
    para.inlines = rebuildInlines(chars);
  }

  // Whole-block insertions: mark every inline and the paragraph mark.
  for (const hunk of changes.hunks) {
    if (hunk.type !== 'ins_block') continue;
    const inserted = Array.from({ length: hunk.count }, (_, k) => {
      const path = [...hunk.at.block];
      path[path.length - 1] = (path[path.length - 1] as number) + k;
      const para = getBlock(doc, path);
      const text =
        para && Array.isArray(para.inlines)
          ? flattenForDisplay(para)
              .map((c) => c.ch)
              .join('')
          : '';
      return { path, para, text };
    });
    // The stored hunk may start on a blank paragraph and continue into the
    // user's real line. Split that boundary into separate revisions: the blank
    // mark is ignored by the stepper, and the line gets its own text anchor.
    for (let start = 0; start < inserted.length; ) {
      let end = start + 1;
      while (
        end < inserted.length &&
        Boolean(inserted[end].text) === Boolean(inserted[start].text)
      )
        end++;
      const insBlockText = inserted
        .slice(start, end)
        .map((part) => part.text)
        .join('');
      const resolved = resolveContentAuthor('ins', insBlockText, hunk.author);
      const mark = newRevision(
        'Insertion',
        resolved.author,
        hunk.id,
        resolved.pending,
        resolved.group ?? blockGroupKey(resolved.author, inserted[start].path)
      );
      for (const { para } of inserted.slice(start, end)) {
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
      start = end;
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
    const delBlockText = hunk.blocks
      .map((raw: any) =>
        flattenForDisplay(JSON.parse(JSON.stringify(raw)))
          .map((c) => c.ch)
          .join('')
      )
      .join('');
    const resolved = resolveContentAuthor('del', delBlockText, hunk.author);
    const delAuthor = resolved.author;
    const mark = newRevision(
      'Deletion',
      delAuthor,
      hunk.id,
      resolved.pending,
      resolved.group ?? blockGroupKey(delAuthor, hunk.at.block)
    );
    const { arr, index } = containerOf(doc, hunk.at.block);
    if (!Array.isArray(arr)) continue;
    if (hunk.table && Array.isArray((hunk.table as any).rows)) {
      const table = JSON.parse(JSON.stringify(hunk.table));
      for (const row of table.rows) {
        row.rowFormat = {
          ...(row.rowFormat ?? {}),
          revisionIds: [mark.revisionId]
        };
        for (const cell of row.cells ?? []) {
          for (const para of cell.blocks ?? []) {
            if (!Array.isArray(para?.inlines)) continue;
            const chars = flattenForDisplay(para);
            for (const c of chars) c.revisionIds.push(mark.revisionId);
            para.inlines = rebuildInlines(chars);
            para.characterFormat = {
              ...(para.characterFormat ?? {}),
              revisionIds: [mark.revisionId]
            };
          }
        }
      }
      arr.splice(Math.min(index, arr.length), 0, table);
      continue;
    }
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
