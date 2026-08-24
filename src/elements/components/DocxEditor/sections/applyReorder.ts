// Bridge from a chosen section move to the live Syncfusion editor.
//
// A reorder is decided in pure JSON (moveWordSection/reorderSections) and then
// APPLIED to the live editor. We prefer a NATIVE replay — for a single-section
// relocation, we drive the SDK's own commands (delete + insertSectionBreak +
// pasteContents + section-format/header-footer re-apply) inside ONE
// complex-history group, so the whole reorder is a single native undo/redo unit
// (Ctrl+Z / the toolbar work). Verified in the spike:
//   - single-section move: correct, headers/footers + page setup preserved,
//     clean undo AND redo;
//   - multi-section move: EJ2 redo throws on the multi-step group, so we do not
//     go native for those.
//
// After the native attempt we VERIFY the result (order + moved section's body,
// headers/footers, and copied page-setup). If anything is off — a multi-move,
// an unsupported header variant, a thrown SDK call, or a fidelity mismatch — we
// fall back to editor.open() of the target SFDT: fully correct, but it clears
// native history (no undo for that move). So we never silently lose fidelity.
//
// A refused move (the mutate step returns the input identity-equal) never
// touches the editor — its diagnostics are surfaced and nothing is written.

import {
  Diagnostic,
  isOptimizedSfdt,
  SfdtBlock,
  SfdtDocument,
  SfdtInline,
  SfdtSection
} from '../bindings/core/sfdtTypes';
import { reconcileBoundDocument } from '../bindings/reconcileRegistry';
import {
  MoveArgs,
  MoveResult,
  moveWordSection,
  reorderSections
} from './outline';

/** The Syncfusion surface this module needs. Kept narrow for testability. */
export interface ReorderEditor {
  serialize(): string;
  open(sfdt: string): void;
  selection?: {
    startOffset?: string;
    select?: (start: string, end: string) => void;
    /** Settable page-setup properties for the section holding the caret. */
    sectionFormat?: Record<string, unknown>;
    goToHeader?: () => void;
    goToFooter?: () => void;
    closeHeaderFooter?: () => void;
  };
  /** The Editor module — `documentEditor.editor`. */
  editor?: {
    delete?: () => void;
    insertSectionBreak?: () => void;
    pasteContents?: (sfdt: object) => void;
    /** Starts a complex-history group; lives on the Editor module. */
    initComplexHistory?: (action: string) => void;
  };
  /** The history module — `documentEditor.editorHistory`. */
  editorHistory?: {
    updateComplexHistory?: () => void;
    currentHistoryInfo?: unknown;
  };
  documentHelper?: {
    viewerContainer?: { scrollTop: number; scrollLeft: number } | null;
  };
}

export interface ApplyReorderCallbacks {
  /** Mark the document dirty — the SDK writes may not fire a gated contentChange. */
  markDirty?: () => void;
  /** Every move's diagnostics (refusal errors, or warnings on a move). */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export interface ApplyReorderResult {
  moved: boolean;
  diagnostics: Diagnostic[];
}

// Hierarchical-index offset large enough to clamp to a paragraph's end.
const END_OFFSET = 2147483647;

// Every reorder GESTURE (one drag or chevron press) may apply as several native
// complex-history groups — a multi-section selection is several single-section
// relocations. We tag all groups from one gesture with the SAME batch action
// (`ReorderSections#<seq>`); installReorderUndoBatching then collapses the whole
// gesture back into a single undo/redo. A plain counter (no Date/random) so
// resume/replay stays deterministic.
let reorderBatchSeq = 0;
const BATCH_PREFIX = 'ReorderSections#';

type HistoryModule = NonNullable<ReorderEditor['editorHistory']> & {
  undo?: () => void;
  redo?: () => void;
  undoStack?: Array<{ action?: unknown }>;
  redoStack?: Array<{ action?: unknown }>;
  __reorderBatchPatched?: boolean;
};

// The action id on the top of a history stack, but only when it's one of ours.
const topBatchId = (stack?: Array<{ action?: unknown }>): string | null => {
  const top = stack && stack.length ? stack[stack.length - 1] : undefined;
  const action = top?.action;
  return typeof action === 'string' && action.startsWith(BATCH_PREFIX)
    ? action
    : null;
};

/**
 * Wrap `editorHistory.undo`/`redo` so ONE call collapses a whole reorder gesture
 * — several native groups all tagged with the same `ReorderSections#<seq>` — into
 * a single undo/redo. Any other history entry (a normal edit) passes straight
 * through to the original single call. Idempotent: guarded per history instance,
 * and a no-op on editors that don't expose undo/redo (e.g. test fakes).
 */
export function installReorderUndoBatching(editor: ReorderEditor): void {
  const hist = editor.editorHistory as HistoryModule | undefined;
  if (!hist || hist.__reorderBatchPatched) return;
  const origUndo =
    typeof hist.undo === 'function' ? hist.undo.bind(hist) : undefined;
  const origRedo =
    typeof hist.redo === 'function' ? hist.redo.bind(hist) : undefined;
  if (!origUndo || !origRedo) return;

  hist.undo = function reorderAwareUndo(): void {
    const id = topBatchId(hist.undoStack);
    if (id == null) {
      origUndo();
      return;
    }
    // Drain every contiguous group of this gesture. The guard bounds the loop
    // in case a stack somehow never shrinks.
    let guardCount = 0;
    while (topBatchId(hist.undoStack) === id && guardCount++ < 500) origUndo();
  };

  hist.redo = function reorderAwareRedo(): void {
    const id = topBatchId(hist.redoStack);
    if (id == null) {
      origRedo();
      return;
    }
    let guardCount = 0;
    while (topBatchId(hist.redoStack) === id && guardCount++ < 500) origRedo();
  };

  hist.__reorderBatchPatched = true;
}

const errorResult = (
  code: string,
  message: string,
  onDiagnostics?: (d: Diagnostic[]) => void
): ApplyReorderResult => {
  const diagnostics: Diagnostic[] = [
    { severity: 'error', code, message, path: [] }
  ];
  onDiagnostics?.(diagnostics);
  return { moved: false, diagnostics };
};

interface ViewSnapshot {
  scrollTop?: number;
  scrollLeft?: number;
}

function captureScroll(editor: ReorderEditor): ViewSnapshot {
  try {
    const host = editor.documentHelper?.viewerContainer;
    if (host) return { scrollTop: host.scrollTop, scrollLeft: host.scrollLeft };
  } catch {
    /* nothing to capture */
  }
  return {};
}

/* ---------------- native single-section move ---------------- */

// First run of text anywhere in a block's inlines, recursing into content
// controls (a heading wrapped in a content control keeps its text one level
// down).
const inlineText = (inlines: SfdtInline[] | undefined): string => {
  for (const inl of inlines || []) {
    if (typeof inl?.text === 'string' && inl.text) return inl.text;
    if (Array.isArray(inl?.inlines)) {
      const nested = inlineText(inl.inlines);
      if (nested) return nested;
    }
  }
  return '';
};

const firstText = (section: SfdtSection | undefined): string => {
  for (const b of section?.blocks || []) {
    const t = inlineText(b?.inlines);
    if (t) return t;
  }
  return '';
};

const countTables = (blocks: SfdtBlock[] | undefined): number => {
  let n = 0;
  for (const b of blocks || []) {
    if (Array.isArray(b?.rows)) n += 1;
    if (Array.isArray(b?.blocks)) n += countTables(b.blocks);
  }
  return n;
};

// True when a section carries any non-empty header/footer variant.
const hasHeadersFooters = (section: SfdtSection | undefined): boolean => {
  const hf = (section?.headersFooters || {}) as Record<
    string,
    { blocks?: unknown[] } | undefined
  >;
  return Object.values(hf).some(
    (variant) =>
      !!variant && Array.isArray(variant.blocks) && variant.blocks.length > 0
  );
};

const hfText = (variant: { blocks?: SfdtBlock[] } | undefined): string => {
  let t = '';
  for (const b of variant?.blocks || []) t += inlineText(b?.inlines);
  return t;
};

// A signature of the section order that survives the paste round-trip: leading
// text + table count per section. NOT block count — pasteContents can leave a
// trailing empty paragraph, which must not fail verification.
const orderSignature = (sections: SfdtSection[]): string =>
  sections.map((s) => `${firstText(s)}#${countTables(s.blocks)}`).join('');

function lastBlockIndex(editor: ReorderEditor, sectionIndex: number): number {
  const doc = JSON.parse(editor.serialize()) as SfdtDocument;
  const blocks = (doc.sections?.[sectionIndex]?.blocks || []) as SfdtBlock[];
  return Math.max(0, blocks.length - 1);
}

interface SectionMove {
  /** Live index of the section to move at the time this move runs. */
  from: number;
  /** Live index it moves to. */
  to: number;
  /** Its ORIGINAL index (into the pre-reorder sections array). */
  orig: number;
}

// The sequence of single-section relocations that turns identity order into
// `targetOrder` (selection-sort). A single drag / chevron is one move; a
// multi-section selection is several. Each `from`/`to` is a LIVE index at the
// point that move runs, so the moves can be replayed on the editor in order.
function movePlan(targetOrder: number[]): SectionMove[] {
  const n = targetOrder.length;
  const cur = Array.from({ length: n }, (_, i) => i);
  const moves: SectionMove[] = [];
  for (let p = 0; p < n; p++) {
    const desired = targetOrder[p];
    const from = cur.indexOf(desired);
    if (from === p) continue;
    moves.push({ from, to: p, orig: desired });
    cur.splice(from, 1);
    cur.splice(p, 0, desired);
  }
  return moves;
}

function nativeEditorReady(editor: ReorderEditor): boolean {
  const sel = editor.selection;
  const ed = editor.editor;
  return !!(
    sel?.select &&
    ed?.delete &&
    ed?.insertSectionBreak &&
    ed?.pasteContents &&
    ed?.initComplexHistory &&
    editor.editorHistory?.updateComplexHistory
  );
}

// Perform the one section move via SDK commands, grouped as one undo unit.
// Throws on any SDK failure (the caller falls back to open()).
function nativeSingleMove(
  editor: ReorderEditor,
  from: number,
  to: number,
  source: SfdtSection,
  n: number,
  action: string
): void {
  const sel = editor.selection as NonNullable<ReorderEditor['selection']>;
  const ed = editor.editor as NonNullable<ReorderEditor['editor']>;
  const hist = editor.editorHistory as NonNullable<
    ReorderEditor['editorHistory']
  >;
  // nativeEditorReady() guaranteed these exist. BIND each to its owner — the SDK
  // methods use `this` internally, so an unbound `const f = ed.delete; f()` call
  // throws ("Cannot read properties of undefined").
  const select = (sel.select as (a: string, b: string) => void).bind(sel);
  const del = (ed.delete as () => void).bind(ed);
  const insertBreak = (ed.insertSectionBreak as () => void).bind(ed);
  const paste = (ed.pasteContents as (sfdt: object) => void).bind(ed);
  const beginGroup = (ed.initComplexHistory as (action: string) => void).bind(
    ed
  );
  const endGroup = (hist.updateComplexHistory as () => void).bind(hist);

  beginGroup(action);
  try {
    // 1. Delete the source section (whole section incl. its break).
    if (from < n - 1) {
      select(`${from};0;0`, `${from + 1};0;0`);
    } else {
      const prev = from - 1;
      select(
        `${prev};${lastBlockIndex(editor, prev)};${END_OFFSET}`,
        `${from};${lastBlockIndex(editor, from)};${END_OFFSET}`
      );
    }
    del();

    // 2. Create an empty section at the destination.
    const lenAfter = n - 1;
    if (to < lenAfter) {
      select(`${to};0;0`, `${to};0;0`);
    } else {
      const last = lenAfter - 1;
      const at = `${last};${lastBlockIndex(editor, last)};${END_OFFSET}`;
      select(at, at);
    }
    insertBreak();

    // 3. Fill it with the source body.
    select(`${to};0;0`, `${to};0;0`);
    paste({ sections: [{ blocks: source.blocks || [] }] });

    // 4. Re-apply page setup (pasteContents carries body only).
    const format = sel.sectionFormat;
    if (format) {
      select(`${to};0;0`, `${to};0;0`);
      const srcSF = (source.sectionFormat || {}) as Record<string, unknown>;
      for (const key of Object.keys(srcSF)) {
        const value = srcSF[key];
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          try {
            format[key] = value;
          } catch {
            /* unsettable key — verify() will fall back if it mattered */
          }
        }
      }
    }

    // NOTE: headers/footers are intentionally NOT reproduced natively — driving
    // goToHeader()+pasteContents() corrupts the header widget tree and crashes
    // the next layout. Sections that HAVE per-section headers/footers skip the
    // native path entirely (see tryNativeReplay) and go through open().
  } finally {
    endGroup();
  }
}

// A moved section keeps fidelity: its headers/footers (there should be none —
// HF sections skip native) and its copied page-setup match the source.
function sectionFidelityOK(
  moved: SfdtSection | undefined,
  source: SfdtSection
): boolean {
  if (!moved) return false;
  const srcHF = (source.headersFooters || {}) as Record<string, any>;
  const gotHF = (moved.headersFooters || {}) as Record<string, any>;
  for (const key of Object.keys(srcHF)) {
    if (hfText(srcHF[key]) !== hfText(gotHF[key])) return false;
  }
  const srcSF = (source.sectionFormat || {}) as Record<string, unknown>;
  const gotSF = (moved.sectionFormat || {}) as Record<string, unknown>;
  for (const key of Object.keys(srcSF)) {
    const value = srcSF[key];
    if (
      (typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean') &&
      gotSF[key] !== value
    ) {
      return false;
    }
  }
  return true;
}

// Try to apply the reorder natively. Every relocation runs as its OWN
// complex-history group (a single multi-step group breaks EJ2 redo), so a
// multi-section move is several native undo units — but each undoes/redoes
// cleanly. Returns true only when every move applied AND the final document
// verifies; false means the caller should open().
function tryNativeReplay(
  editor: ReorderEditor,
  originalSfdt: SfdtDocument,
  targetSfdt: SfdtDocument
): boolean {
  const origSecs = originalSfdt.sections || [];
  const targetSecs = targetSfdt.sections || [];
  const n = origSecs.length;
  if (n < 2 || targetSecs.length !== n) return false;
  if (!nativeEditorReady(editor)) return false;

  // reorderSections/moveWordSection share section objects by identity, so the
  // permutation is recoverable by object identity.
  const targetOrder = targetSecs.map((s) => origSecs.indexOf(s));
  if (targetOrder.some((i) => i < 0)) return false;

  const moves = movePlan(targetOrder);
  if (moves.length === 0) return false;

  // Any moved section with per-section headers/footers crashes the native
  // header re-render → fall back to open() for the whole reorder.
  if (moves.some((m) => hasHeadersFooters(origSecs[m.orig]))) return false;

  // Ensure the undo/redo wrapper is present, and tag every group of this
  // gesture with one batch id so a multi-section move undoes/redoes in one press.
  installReorderUndoBatching(editor);
  const batchAction = `${BATCH_PREFIX}${(reorderBatchSeq += 1)}`;
  try {
    for (const m of moves) {
      nativeSingleMove(editor, m.from, m.to, origSecs[m.orig], n, batchAction);
    }
  } catch {
    return false;
  }

  // Verify the final document: order + each moved section's fidelity (at its
  // final position, targetOrder.indexOf(orig)).
  let after: SfdtDocument;
  try {
    after = JSON.parse(editor.serialize()) as SfdtDocument;
  } catch {
    return false;
  }
  const secs = after.sections || [];
  if (orderSignature(secs) !== orderSignature(targetSecs)) return false;
  for (const m of moves) {
    const finalIndex = targetOrder.indexOf(m.orig);
    if (!sectionFidelityOK(secs[finalIndex], origSecs[m.orig])) return false;
  }
  return true;
}

/* ---------------- commit ---------------- */

function revealAndSettle(
  editor: ReorderEditor,
  view: ViewSnapshot,
  revealSection: number | null
): void {
  // Moving whole sections shifts every ['sections', s, ...] path, so the
  // binding index must be rebuilt. No-op when the document has no bindings.
  reconcileBoundDocument(editor);
  if (revealSection != null && editor.selection?.select) {
    try {
      const at = `${revealSection};0;0`;
      editor.selection.select(at, at);
      return;
    } catch {
      /* fall through to scroll restore */
    }
  }
  try {
    const host = editor.documentHelper?.viewerContainer;
    if (host) {
      if (view.scrollTop != null) host.scrollTop = view.scrollTop;
      if (view.scrollLeft != null) host.scrollLeft = view.scrollLeft;
    }
  } catch {
    /* best effort */
  }
}

// Apply the target document. Native replay when possible (single-section move,
// full fidelity) → native undo/redo; otherwise open() (clears history).
function commitDocument(
  editor: ReorderEditor,
  originalSfdt: SfdtDocument,
  targetSfdt: SfdtDocument,
  revealSection: number | null
): void {
  const view = captureScroll(editor);
  const applied = tryNativeReplay(editor, originalSfdt, targetSfdt);
  if (!applied) editor.open(JSON.stringify(targetSfdt));
  revealAndSettle(editor, view, revealSection);
}

// Shared commit path: serialize → run `mutate` → on change, apply + mark dirty.
// A refusal (mutate returns the input identity-equal) surfaces its diagnostics
// and leaves the editor untouched.
function commit(
  editor: ReorderEditor,
  mutate: (sfdt: SfdtDocument) => MoveResult,
  { markDirty, onDiagnostics }: ApplyReorderCallbacks
): ApplyReorderResult {
  // Fold in anything the user typed but has not committed before we serialize,
  // so applying the reorder cannot drop it. No-op without bindings.
  reconcileBoundDocument(editor);

  let raw: string;
  try {
    raw = editor.serialize();
  } catch (error) {
    return errorResult(
      'serialize-failed',
      `could not read the document: ${
        (error as Error)?.message || String(error)
      }`,
      onDiagnostics
    );
  }

  let sfdt: SfdtDocument;
  try {
    sfdt = JSON.parse(raw) as SfdtDocument;
  } catch {
    return errorResult(
      'parse-failed',
      'the document could not be parsed',
      onDiagnostics
    );
  }

  if (isOptimizedSfdt(sfdt)) {
    return errorResult(
      'optimized-sfdt',
      'reordering is unavailable for this document (abbreviated SFDT keys)',
      onDiagnostics
    );
  }

  const result = mutate(sfdt);
  // Refusal (or no-op): mutate returns the input identity-equal.
  if (result.sfdt === sfdt) {
    onDiagnostics?.(result.diagnostics);
    return { moved: false, diagnostics: result.diagnostics };
  }

  commitDocument(editor, sfdt, result.sfdt, result.movedTo);
  markDirty?.();
  onDiagnostics?.(result.diagnostics);
  return { moved: true, diagnostics: result.diagnostics };
}

/**
 * Move a single section (the ↑/↓ chevrons). Returns whether the document
 * changed, plus the diagnostics to display.
 */
export function applyReorder(
  editor: ReorderEditor,
  move: MoveArgs,
  callbacks: ApplyReorderCallbacks = {}
): ApplyReorderResult {
  return commit(editor, (sfdt) => moveWordSection(sfdt, move), callbacks);
}

/**
 * Apply an explicit new section order (a drag commit, including a multi-section
 * selection). `order` is a permutation of [0..n-1].
 */
export function applyReorderTo(
  editor: ReorderEditor,
  order: number[],
  callbacks: ApplyReorderCallbacks = {}
): ApplyReorderResult {
  return commit(editor, (sfdt) => reorderSections(sfdt, order), callbacks);
}
