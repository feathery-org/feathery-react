// Document outline: reorderable Word sections over the raw SFDT JSON.
//
// Ported from the syncfusion-json POC (src/outline.js, Word-section model).
// A "section" here is one entry in the top-level `sections[]` array — a real
// Word layout section with its own sectionFormat and headers/footers.
// Reordering is a permutation of that array.
//
// Same contract as the binding engine's adapter modules: pure functions,
// immutable updates via structural sharing (setAt), and diagnostics instead of
// throws. On any blocking diagnostic a move returns the INPUT document
// identity-equal, so a refused move can never partially rewrite the document.

import { setAt } from '../bindings/core/sfdtAdapter';
import {
  Diagnostic,
  DiagnosticSeverity,
  isOptimizedSfdt,
  SfdtBlock,
  SfdtDocument,
  SfdtInline,
  SfdtSection
} from '../bindings/core/sfdtTypes';

/** One reorderable Word section, in document order. */
export interface SectionNode {
  /** Positional — recompute (via readSections) after every move; never cache. */
  index: number;
  /** Positional id `ws-<index>`; stable only within a single read. */
  id: string;
  label: string;
  /** Short structural description shown under the label (e.g. "Table · 9 rows",
   *  "Heading + table", "Paragraph"). */
  summary: string;
  breakCode: string | null;
  movable: boolean;
}

export interface ReadSectionsResult {
  nodes: SectionNode[];
  diagnostics: Diagnostic[];
}

export interface MoveResult {
  sfdt: SfdtDocument;
  diagnostics: Diagnostic[];
  /** New index of the moved section, or null when the move was refused. */
  movedTo: number | null;
}

export interface MoveArgs {
  index: number;
  /** Relative move (-1 up, +1 down). Ignored when targetIndex is given. */
  delta?: number;
  /** Drag destination — the section index the drop landed on. */
  targetIndex?: number | null;
  /** Which edge of targetIndex the drop landed on. */
  position?: 'before' | 'after';
}

/* ---------------- traversal helpers ---------------- */

function eachInlineDeep(
  node: { inlines?: SfdtInline[] },
  fn: (inl: SfdtInline) => void
): void {
  for (const inl of node.inlines || []) {
    if (!inl) continue;
    fn(inl);
    if (Array.isArray(inl.inlines)) eachInlineDeep(inl, fn);
  }
}

// Every block reachable from `blocks`, including block-CC wrappers and
// paragraphs nested in table cells.
function eachBlockDeep(
  blocks: SfdtBlock[] | undefined,
  fn: (block: SfdtBlock) => void
): void {
  for (const b of blocks || []) {
    if (!b) continue;
    fn(b);
    if (Array.isArray(b.blocks)) eachBlockDeep(b.blocks, fn);
    if (Array.isArray(b.rows)) {
      for (const row of b.rows)
        for (const cell of row.cells || []) eachBlockDeep(cell.blocks, fn);
    }
  }
}

function eachInlineUnder(
  block: SfdtBlock,
  fn: (inl: SfdtInline) => void
): void {
  eachBlockDeep([block], (blk) => {
    if (Array.isArray(blk.inlines)) eachInlineDeep(blk, fn);
  });
}

function diag(
  list: Diagnostic[],
  severity: DiagnosticSeverity,
  code: string,
  message: string
): void {
  list.push({ severity, code, message, path: [] });
}

/* ---------------- validation ---------------- */

// The paired inline markers whose two ends must not be separated by a move,
// and how to recognise each end. Shapes verified in the POC against the pinned
// 34.1.31 SFDT keyword table.
interface MarkerInline extends SfdtInline {
  bookmarkType?: number;
  commentCharacterType?: number;
  commentId?: unknown;
  name?: unknown;
  editRangeId?: unknown;
  editableRangeStart?: { editRangeId?: unknown };
}

interface PairKind {
  code: string;
  label: string;
  isStart: (inl: MarkerInline) => boolean;
  isEnd: (inl: MarkerInline) => boolean;
  idOf: (inl: MarkerInline) => unknown;
}

const PAIR_KINDS: PairKind[] = [
  {
    code: 'split-bookmark',
    label: 'bookmark',
    isStart: (i) => i.bookmarkType === 0,
    isEnd: (i) => i.bookmarkType === 1,
    idOf: (i) => i.name
  },
  {
    code: 'split-comment',
    label: 'comment',
    isStart: (i) => i.commentCharacterType === 0,
    isEnd: (i) => i.commentCharacterType === 1,
    idOf: (i) => i.commentId
  },
  {
    code: 'split-edit-range',
    label: 'editable range',
    isStart: (i) =>
      i.editRangeId !== undefined && i.editableRangeStart === undefined,
    isEnd: (i) => i.editableRangeStart !== undefined,
    idOf: (i) =>
      i.editableRangeStart ? i.editableRangeStart.editRangeId : i.editRangeId
  }
];

// All pair-marker ids of one kind found anywhere in a section (body blocks and
// its own headers/footers).
function collectPairIds(section: SfdtSection, spec: PairKind): Set<string> {
  const ids = new Set<string>();
  const add = (inl: SfdtInline): void => {
    const marker = inl as MarkerInline;
    if (!spec.isStart(marker) && !spec.isEnd(marker)) return;
    const id = spec.idOf(marker);
    if (id !== undefined && id !== null) ids.add(String(id));
  };
  for (const b of section.blocks || []) eachInlineUnder(b, add);
  const hf = section.headersFooters || {};
  for (const k of Object.keys(hf)) {
    const part = hf[k];
    if (part && Array.isArray(part.blocks))
      for (const b of part.blocks) eachInlineUnder(b, add);
  }
  return ids;
}

// A pair is split when its two ends fall in different Word sections. Moving the
// section then separates them, corrupting the bookmark/comment/protection.
function sectionSplitDiagnostics(
  sections: SfdtSection[],
  movedIndex: number
): Diagnostic[] {
  const result: Diagnostic[] = [];
  for (const spec of PAIR_KINDS) {
    const inside = collectPairIds(sections[movedIndex], spec);
    if (!inside.size) continue;
    const outside = new Set<string>();
    sections.forEach((s, i) => {
      if (i === movedIndex) return;
      for (const id of collectPairIds(s, spec)) outside.add(id);
    });
    for (const id of inside) {
      if (outside.has(id)) {
        result.push({
          severity: 'error',
          code: spec.code,
          path: [],
          message: `${spec.label} ${JSON.stringify(
            id
          )} spans this section and another; moving would split it`
        });
      }
    }
  }
  return result;
}

/* ---------------- reading ---------------- */

function sectionLabel(blocks: SfdtBlock[] | undefined): string | null {
  for (const b of blocks || []) {
    let s = '';
    eachInlineUnder(b, (inl) => {
      if (typeof inl.text === 'string') s += inl.text;
    });
    if (s.trim()) return s.trim().slice(0, 60);
  }
  return null;
}

const styleOf = (b: SfdtBlock): string =>
  String((b.paragraphFormat as Record<string, unknown>)?.styleName || '');

// A block-level content control (how a bound table is expressed) wraps its real
// content in `.blocks`. Unwrap those so a wrapped table/paragraph is seen as
// the table/paragraph it is, not as an opaque wrapper. Does not descend into
// table cells.
function flattenWrappers(blocks: SfdtBlock[]): SfdtBlock[] {
  const out: SfdtBlock[] = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.contentControlProperties && Array.isArray(b.blocks) && !b.rows) {
      out.push(...flattenWrappers(b.blocks));
    } else {
      out.push(b);
    }
  }
  return out;
}

// A short structural summary of a section, shown as the row's subtitle. Reads
// the section's blocks (unwrapping content-control wrappers): tables (blocks
// with `rows`) vs paragraphs, and whether a heading/title leads it.
function describeSection(rawBlocks: SfdtBlock[]): string {
  const blocks = flattenWrappers(rawBlocks);
  const tables = blocks.filter((b) => Array.isArray(b.rows));
  const paras = blocks.filter((b) => Array.isArray(b.inlines));
  const hasTitle = paras.length > 0 && /^title/i.test(styleOf(paras[0]));
  const hasHeading = paras.some((b) => /^heading/i.test(styleOf(b)));
  const rowCount = tables.reduce((n, t) => n + (t.rows?.length || 0), 0);

  if (tables.length) {
    if (hasHeading) return 'Heading + table';
    if (paras.length) return 'Text + table';
    return `Table · ${rowCount} ${rowCount === 1 ? 'row' : 'rows'}`;
  }
  if (hasTitle) return paras.length > 1 ? 'Title + text' : 'Title';
  if (hasHeading) return paras.length > 1 ? 'Heading + text' : 'Heading';
  if (paras.length <= 1) return 'Paragraph';
  return `${paras.length} paragraphs`;
}

// One node per top-level Word section, in document order. `id` is positional
// (`ws-<index>`), so the caller must re-read after every move rather than cache
// ids.
export function readSections(
  sfdt: SfdtDocument | null | undefined
): ReadSectionsResult {
  const diagnostics: Diagnostic[] = [];
  if (isOptimizedSfdt(sfdt)) {
    diag(
      diagnostics,
      'error',
      'optimized-sfdt',
      'document uses abbreviated SFDT keys; construct the editor with documentEditorSettings.optimizeSfdt = false'
    );
    return { nodes: [], diagnostics };
  }
  if (!sfdt || !Array.isArray(sfdt.sections)) {
    diag(
      diagnostics,
      'error',
      'malformed-sfdt',
      'document has no sections array'
    );
    return { nodes: [], diagnostics };
  }

  const sections = sfdt.sections;
  const nodes: SectionNode[] = sections.map((sec, index) => {
    const blocks: SfdtBlock[] = Array.isArray(sec?.blocks) ? sec.blocks : [];
    const breakCode =
      (sec &&
        sec.sectionFormat &&
        (sec.sectionFormat as Record<string, unknown>).breakCode) ||
      null;
    return {
      index,
      id: `ws-${index}`,
      label: sectionLabel(blocks) || `Section ${index + 1}`,
      summary: describeSection(blocks),
      breakCode: typeof breakCode === 'string' ? breakCode : null,
      movable: sections.length > 1
    };
  });
  return { nodes, diagnostics };
}

/* ---------------- moving ---------------- */

function fail(diagnostics: Diagnostic[], code: string, message: string): void {
  diag(diagnostics, 'error', code, message);
}

// Move a whole Word section. Two call forms:
//   moveWordSection(sfdt, { index, delta: -1 | +1 })
//   moveWordSection(sfdt, { index, targetIndex, position: 'before' | 'after' })
// On any blocking diagnostic the input document is returned identity-equal.
export function moveWordSection(
  sfdt: SfdtDocument,
  { index, delta = 0, targetIndex = null, position = 'before' }: MoveArgs
): MoveResult {
  const diagnostics: Diagnostic[] = [];
  const noop = (): MoveResult => ({ sfdt, diagnostics, movedTo: null });

  if (isOptimizedSfdt(sfdt)) {
    fail(diagnostics, 'optimized-sfdt', 'document uses abbreviated SFDT keys');
    return noop();
  }
  if (!sfdt || !Array.isArray(sfdt.sections)) {
    fail(diagnostics, 'malformed-sfdt', 'document has no sections array');
    return noop();
  }

  const sections = sfdt.sections;
  const n = sections.length;
  if (!(index >= 0 && index < n)) {
    fail(diagnostics, 'section-not-found', `no section at index ${index}`);
    return noop();
  }
  if (n < 2) {
    fail(diagnostics, 'section-not-movable', 'document has only one section');
    return noop();
  }

  // A reorder is not representable as one tracked revision, so refuse rather
  // than silently drop attribution — accept/reject pending changes first.
  const revisions = (sfdt as { revisions?: unknown[] }).revisions;
  if (
    (sfdt as { trackChanges?: boolean }).trackChanges === true ||
    (Array.isArray(revisions) && revisions.length > 0)
  ) {
    fail(
      diagnostics,
      'tracked-changes-present',
      'document has tracked changes; accept or reject them before reordering sections'
    );
    return noop();
  }

  let to: number;
  if (targetIndex != null) {
    if (!(targetIndex >= 0 && targetIndex < n)) {
      fail(
        diagnostics,
        'section-not-found',
        `no section at index ${targetIndex}`
      );
      return noop();
    }
    to = position === 'after' ? targetIndex + 1 : targetIndex;
    if (to > index) to -= 1; // account for removing the source first
  } else {
    to = index + delta;
  }
  if (to === index || to < 0 || to >= n) {
    fail(
      diagnostics,
      'section-at-edge',
      `section ${index} cannot move ${delta < 0 ? 'up' : 'down'} any further`
    );
    return noop();
  }

  const blocking = sectionSplitDiagnostics(sections, index);
  diagnostics.push(...blocking);
  if (blocking.length) return noop();

  const reordered = sections.slice();
  reordered.splice(to, 0, reordered.splice(index, 1)[0]);

  // Post-check: the result must be a permutation of the input BY OBJECT
  // IDENTITY. Catches an SFDT-shape assumption drifting on an EJ2 upgrade
  // instead of silently corrupting a document.
  const original = new Set(sections);
  const seen = new Set<SfdtSection>();
  const isPermutation =
    reordered.length === sections.length &&
    reordered.every(
      (s) => original.has(s) && !seen.has(s) && (seen.add(s), true)
    );
  if (!isPermutation) {
    fail(
      diagnostics,
      'outline-move-mismatch',
      'reordered sections are not a permutation of the original; document left unchanged'
    );
    return noop();
  }

  const next = setAt(sfdt, ['sections'], reordered);
  return { sfdt: next, diagnostics, movedTo: to };
}

// A cross-section paired marker (bookmark/comment/edit-range whose two ends
// live in different sections) is split unless those sections stay a contiguous
// run, in their original relative order, in the new arrangement.
function reorderSplitDiagnostics(
  sections: SfdtSection[],
  order: number[]
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const spec of PAIR_KINDS) {
    const idSections = new Map<string, Set<number>>();
    sections.forEach((section, i) => {
      for (const id of collectPairIds(section, spec)) {
        const set = idSections.get(id) ?? new Set<number>();
        set.add(i);
        idSections.set(id, set);
      }
    });
    for (const [id, secs] of idSections) {
      if (secs.size < 2) continue; // a pair within one section is safe
      const original = [...secs].sort((a, b) => a - b);
      const positions = original
        .map((s) => order.indexOf(s))
        .sort((a, b) => a - b);
      const contiguous = positions.every(
        (p, k) => k === 0 || p === positions[k - 1] + 1
      );
      const run = contiguous
        ? order.slice(positions[0], positions[positions.length - 1] + 1)
        : [];
      const preserved =
        run.length === original.length &&
        run.every((v, k) => v === original[k]);
      if (!preserved) {
        out.push({
          severity: 'error',
          code: spec.code,
          path: [],
          message: `${spec.label} ${JSON.stringify(
            id
          )} spans multiple sections; reordering would split it`
        });
      }
    }
  }
  return out;
}

// Apply an explicit new order (a permutation of [0..n-1]) to sections[]. Used
// for drag commits, including moving a multi-section selection. Same refusal
// semantics as moveWordSection: on any blocking diagnostic the input document
// is returned identity-equal. An unchanged order is a silent no-op.
export function reorderSections(
  sfdt: SfdtDocument,
  order: number[]
): MoveResult {
  const diagnostics: Diagnostic[] = [];
  const noop = (): MoveResult => ({ sfdt, diagnostics, movedTo: null });

  if (isOptimizedSfdt(sfdt)) {
    fail(diagnostics, 'optimized-sfdt', 'document uses abbreviated SFDT keys');
    return noop();
  }
  if (!sfdt || !Array.isArray(sfdt.sections)) {
    fail(diagnostics, 'malformed-sfdt', 'document has no sections array');
    return noop();
  }

  const sections = sfdt.sections;
  const n = sections.length;
  if (n < 2) {
    fail(diagnostics, 'section-not-movable', 'document has only one section');
    return noop();
  }

  // order must be a permutation of [0..n-1].
  const sorted = order.slice().sort((a, b) => a - b);
  const valid = sorted.length === n && sorted.every((v, i) => v === i);
  if (!valid) {
    fail(
      diagnostics,
      'outline-move-mismatch',
      'requested order is not a permutation of the sections'
    );
    return noop();
  }
  // No net change: return the document untouched (a silent no-op).
  if (order.every((v, i) => v === i)) return noop();

  const revisions = (sfdt as { revisions?: unknown[] }).revisions;
  if (
    (sfdt as { trackChanges?: boolean }).trackChanges === true ||
    (Array.isArray(revisions) && revisions.length > 0)
  ) {
    fail(
      diagnostics,
      'tracked-changes-present',
      'document has tracked changes; accept or reject them before reordering sections'
    );
    return noop();
  }

  const blocking = reorderSplitDiagnostics(sections, order);
  diagnostics.push(...blocking);
  if (blocking.length) return noop();

  const reordered = order.map((i) => sections[i]);
  const original = new Set(sections);
  const seen = new Set<SfdtSection>();
  const isPermutation =
    reordered.length === sections.length &&
    reordered.every(
      (s) => original.has(s) && !seen.has(s) && (seen.add(s), true)
    );
  if (!isPermutation) {
    fail(
      diagnostics,
      'outline-move-mismatch',
      'reordered sections are not a permutation of the original; document left unchanged'
    );
    return noop();
  }

  const next = setAt(sfdt, ['sections'], reordered);
  return { sfdt: next, diagnostics, movedTo: null };
}

export function hasBlockingErrors(
  diagnostics: Diagnostic[] | undefined
): boolean {
  return (diagnostics || []).some((d) => d.severity === 'error');
}
