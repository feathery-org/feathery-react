// Bridge from a chosen section move to the live Syncfusion editor.
//
// The reorder is a whole-document rewrite: serialize -> permute sections[] ->
// open() the result. open() is the only way we currently re-render a structural
// change reliably (a select-all + paste path was tried for native undo/redo but
// did not reliably replace a multi-section document; that needs a live spike).
// This preserves what open() throws away (view, bindings) around it.
//
// A refused move (the mutate step returns the input identity-equal) never
// touches the editor — its diagnostics are surfaced and nothing is written.

import {
  Diagnostic,
  isOptimizedSfdt,
  SfdtDocument
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
  };
  documentHelper?: {
    viewerContainer?: { scrollTop: number; scrollLeft: number } | null;
  };
}

export interface ApplyReorderCallbacks {
  /** Mark the document dirty — the paste/open may not fire a gated contentChange. */
  markDirty?: () => void;
  /** Every move's diagnostics (refusal errors, or warnings on a move). */
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

export interface ApplyReorderResult {
  moved: boolean;
  diagnostics: Diagnostic[];
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

// Write a full SFDT string back to the editor and put it in a sane place:
// rebuild the binding index, then reveal the moved section — or, when there is
// nothing to reveal, restore the old scroll.
function commitDocument(
  editor: ReorderEditor,
  sfdtString: string,
  revealSection: number | null
): void {
  const view = captureScroll(editor);
  editor.open(sfdtString);
  // Moving whole sections shifts every ['sections', s, ...] path, so the
  // binding index must be rebuilt from the reordered document. flush()
  // re-serializes and re-scans; a pure reorder is a fixed point so no values
  // change. No-op when the document has no bindings.
  reconcileBoundDocument(editor);
  if (revealSection != null && editor.selection?.select) {
    try {
      // "section;block;offset" — start of the moved section's first block.
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

// Shared commit path: serialize → run `mutate` → on change, re-open + reveal +
// rebuild bindings + mark dirty. A refusal (mutate returns the input
// identity-equal) surfaces its diagnostics and leaves the editor untouched.
function commit(
  editor: ReorderEditor,
  mutate: (sfdt: SfdtDocument) => MoveResult,
  { markDirty, onDiagnostics }: ApplyReorderCallbacks
): ApplyReorderResult {
  // Fold in anything the user typed but has not committed before we serialize,
  // so the reopen cannot drop it. No-op without bindings.
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

  commitDocument(editor, JSON.stringify(result.sfdt), result.movedTo);
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
