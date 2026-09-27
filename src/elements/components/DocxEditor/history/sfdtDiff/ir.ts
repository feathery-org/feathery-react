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
  /** The OUTERMOST enclosing table object (same doc as `raw`), when inside a
   *  table. Lets a whole-table deletion carry its real structure without a
   *  path lookup, which goes stale once slices move blocks. */
  rawTable?: unknown;
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
  rawTable: unknown,
  out: FlatBlock[]
): void {
  const chars: FlatChar[] = [];
  const fmts = new Map<string, Record<string, unknown>>();
  flattenInlines(para.inlines ?? [], chars, fmts);
  const paraFmt = para.paragraphFormat ?? {};
  out.push({
    path,
    rowPath,
    ...(rawTable ? { rawTable } : {}),
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
  rawTable: unknown,
  out: FlatBlock[]
): void {
  blocks.forEach((block, index) => {
    const here = [...path, index];
    if (isParagraph(block)) {
      flattenParagraph(block, here, rowPath, rawTable, out);
    } else if (isTable(block)) {
      // A nested table's paragraphs keep the OUTERMOST table (its path is what
      // hunk grouping keys on).
      const tableRef = rawTable ?? block;
      block.rows.forEach((row: any, r: number) => {
        const rp = [...here, 'rows', r];
        (row.cells ?? []).forEach((cell: any, c: number) => {
          flattenBlocks(
            cell.blocks ?? [],
            [...rp, 'cells', c, 'blocks'],
            rp,
            tableRef,
            out
          );
        });
      });
    } else if (Array.isArray(block.blocks)) {
      // Block-level content control wrapper.
      flattenBlocks(block.blocks, [...here, 'blocks'], rowPath, rawTable, out);
    }
  });
}

export function flattenSfdt(sfdt: any): FlatDoc {
  const blocks: FlatBlock[] = [];
  (sfdt?.sections ?? []).forEach((section: any, s: number) => {
    flattenBlocks(section.blocks ?? [], [s, 'blocks'], undefined, null, blocks);
    for (const [name, region] of Object.entries(section.headersFooters ?? {})) {
      flattenBlocks(
        (region as any)?.blocks ?? [],
        [s, 'headersFooters', name, 'blocks'],
        undefined,
        null,
        blocks
      );
    }
  });
  return { blocks };
}

/** Body/header/footer are separate document regions, never alignment peers. */
export function regionKey(path: BlockPath): string {
  return JSON.stringify(path.slice(0, path[1] === 'headersFooters' ? 3 : 1));
}

export function visitDocumentRegions(
  doc: any,
  visit: (blocks: any[]) => void
): void {
  for (const section of doc?.sections ?? []) {
    visit(section?.blocks ?? []);
    for (const region of Object.values(section?.headersFooters ?? {}))
      visit((region as any)?.blocks ?? []);
  }
}

/** Paragraph count of a table, counted the way flattenSfdt flattens it (cell
 *  paragraphs, nested tables and block content controls included). */
export function tableParagraphCount(table: any): number {
  let count = 0;
  const walk = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (isParagraph(b)) count++;
      else if (isTable(b))
        for (const r of b.rows ?? [])
          for (const c of r?.cells ?? []) walk(c?.blocks ?? []);
      else if (Array.isArray(b?.blocks)) walk(b.blocks);
    }
  };
  for (const r of table?.rows ?? [])
    for (const c of r?.cells ?? []) walk(c?.blocks ?? []);
  return count;
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

export function hash32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// Image payloads longer than this are digested; short strings (already a
// digest, or an icon reference) are left as-is. Kept in sync with the guard in
// normalizeForDiff so a slice stripped here matches F digested at diff time.
export const IMAGE_DIGEST_MIN_LENGTH = 64;
export const IMAGE_DIGEST_PREFIX = 'sha:';

export interface NormalizeOptions {
  /** Replace long image payloads with a short digest. On for diffing (keeps
   *  snapshots small/comparable); OFF when normalising a document for DISPLAY,
   *  which must keep the real image bytes. Default true. */
  digestImages?: boolean;
  /** Render these live revisions as rejected before stripping revision
   *  metadata. Used when accepting a suggestion: the resulting document is
   *  the content state immediately before that confirmation. */
  rejectRevisionIds?: Iterable<string>;
}

export function normalizeForDiff(
  sfdt: any,
  options: NormalizeOptions = {}
): any {
  const digestImages = options.digestImages ?? true;
  const doc = JSON.parse(JSON.stringify(sfdt ?? {}));
  const deletions = revisionIdsOfType(doc, 'Deletion');
  const moveFrom = revisionIdsOfType(doc, 'MoveFrom');
  const dropIds = new Set([...deletions, ...moveFrom]);
  const rejected = new Set(
    Array.from(options.rejectRevisionIds ?? [], (id) => String(id))
  );
  if (rejected.size) {
    const insertions = revisionIdsOfType(doc, 'Insertion');
    const moveTo = revisionIdsOfType(doc, 'MoveTo');
    for (const id of rejected) {
      if (insertions.has(id) || moveTo.has(id)) dropIds.add(id);
      if (deletions.has(id) || moveFrom.has(id)) dropIds.delete(id);
    }
  }
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
          digestImages &&
          typeof next.imageString === 'string' &&
          next.imageString.length > IMAGE_DIGEST_MIN_LENGTH
        ) {
          next.imageString = `${IMAGE_DIGEST_PREFIX}${hash32(
            next.imageString
          )}`;
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
    blocks: walkBlocks(section.blocks ?? []),
    ...(section.headersFooters
      ? {
          headersFooters: Object.fromEntries(
            Object.entries(section.headersFooters).map(([key, region]) => [
              key,
              {
                ...(region as any),
                blocks: walkBlocks((region as any)?.blocks ?? [])
              }
            ])
          )
        }
      : {})
  }));
  delete doc.revisions;
  return doc;
}

/** Legacy wire fields call this sha256, but it is a non-cryptographic
 * FNV-1a x2 fingerprint. Keep UTF-16 code-unit ordering for stored versions. */
export function contentHash(sfdt: any): string {
  const s = JSON.stringify(sfdt);
  let reverse = 0x811c9dc5;
  for (let i = s.length - 1; i >= 0; i--) {
    reverse ^= s.charCodeAt(i);
    reverse = Math.imul(reverse, 0x01000193) >>> 0;
  }
  return hash32(s) + reverse.toString(16).padStart(8, '0');
}
