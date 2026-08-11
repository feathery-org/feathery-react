// When an edit becomes a commit.
//
// A content control reconciles on Enter, or when the caret LEAVES it - Tab, a
// click into another field or into prose - or when the editor itself loses focus,
// so clicking into a toolbar or side panel never strands an edit. Never
// mid-typing: reconciling every keystroke would renormalize text under the
// user's cursor.
//
// Blur is detected two ways, because neither alone is sufficient on this build:
//
//   - the caret's BLOCK PATH, i.e. selection.startOffset minus its final
//     character offset ("0;2;1;1;0;0" -> "0;2;1;1;0"). Typing inside one cell
//     only moves the final component, so the prefix is stable while typing and
//     changes the moment the caret enters a different cell or paragraph.
//   - the currentContentControl reference, for the cases the engine does report.
//
// The path is the load-bearing half. selection.currentContentControl reports the
// ENCLOSING control, so every cell of a marker-wrapped table reports the same
// [[table=...]] wrapper and prose reports nothing at all - reference comparison
// alone would never fire when tabbing between cells in a table. Checking both is
// strictly better than either: same-paragraph moves the path cannot see are still
// caught by Enter and by editor blur.
//
// Undo and redo are the subtle case. History has just restored field cells to
// exactly what the user expects to see, so that must not be treated as a pending
// edit. Instead a formulas-only reconcile runs shortly after, which recomputes
// totals without rewriting fields: a recorded rewrite there would clear the redo
// stack, and a suppressed one would corrupt undo. Debounced because one undo can
// fire several contentChange events, and it covers the toolbar buttons as well as
// the hotkeys.
//
// Framework-free on purpose: React wiring belongs to the hook that calls this.

import { ReconciliationController } from './controller';
import { ContentControlLike, SyncfusionEditorLike } from './editorAdapter';

export interface CommitTriggerOptions {
  /**
   * Delay before the post-undo formulas-only reconcile. One undo can emit
   * several contentChange events; this collapses them.
   */
  selfHealDelayMs?: number;
  /**
   * Delay before an Enter commit, letting the editor finish applying the key
   * first.
   */
  enterDelayMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (id: unknown) => void;
}

export interface CommitTriggers {
  /** Call from the editor's contentChange event. */
  onContentChange(): void;
  /** Call from the editor's selectionChange event. */
  onSelectionChange(): void;
  /** Call when the editor's editable surface loses focus. */
  onEditorBlur(): void;
  /** Call from the editor's keyDown event. */
  onKeyDown(key: string | undefined): void;
  /** Clear the pending-edit flag, e.g. after the controller commits. */
  clearPendingEdit(): void;
  /** True when an edit is waiting for a commit trigger. */
  hasPendingEdit(): boolean;
  /** Cancel any scheduled work. */
  dispose(): void;
}

export function createCommitTriggers(
  editor: SyncfusionEditorLike,
  controller: ReconciliationController,
  {
    selfHealDelayMs = 60,
    enterDelayMs = 30,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (id) => clearTimeout(id as any)
  }: CommitTriggerOptions = {}
): CommitTriggers {
  let pendingEdit = false;
  let editedControl: ContentControlLike | null = null;
  let editedBlockPath: string | null = null;
  let selfHealTimer: unknown = null;
  let enterTimer: unknown = null;

  const currentControl = (): ContentControlLike | null =>
    editor.selection?.currentContentControl || null;

  /**
   * The caret's position minus its character offset, so it identifies the cell or
   * paragraph rather than where in it the caret sits.
   */
  const currentBlockPath = (): string | null => {
    const offset = editor.selection?.startOffset;
    if (typeof offset !== 'string' || !offset) return null;
    const lastSeparator = offset.lastIndexOf(';');
    return lastSeparator === -1 ? offset : offset.slice(0, lastSeparator);
  };

  const commit = (): void => {
    pendingEdit = false;
    controller.flush();
  };

  return {
    onContentChange(): void {
      const history = editor.editorHistoryModule;
      if (history && (history.isUndoing || history.isRedoing)) {
        pendingEdit = false;
        clearTimeoutFn(selfHealTimer);
        selfHealTimer = setTimeoutFn(
          () => controller.flush({ mode: 'self-heal' }),
          selfHealDelayMs
        );
        return;
      }
      if (controller.phase === 'idle') {
        pendingEdit = true;
        editedControl = currentControl();
        editedBlockPath = currentBlockPath();
      }
      // Keeps the controller's busy-phase bookkeeping honest even in manual mode.
      controller.notifyContentChange();
    },

    onSelectionChange(): void {
      if (!pendingEdit || controller.phase !== 'idle') return;
      const path = currentBlockPath();
      const movedBlock =
        editedBlockPath !== null && path !== null && path !== editedBlockPath;
      if (movedBlock || currentControl() !== editedControl) commit();
    },

    onEditorBlur(): void {
      if (pendingEdit) commit();
    },

    onKeyDown(key: string | undefined): void {
      if (key !== 'Enter') return;
      clearTimeoutFn(enterTimer);
      enterTimer = setTimeoutFn(commit, enterDelayMs);
    },

    clearPendingEdit(): void {
      pendingEdit = false;
    },

    hasPendingEdit(): boolean {
      return pendingEdit;
    },

    dispose(): void {
      clearTimeoutFn(selfHealTimer);
      clearTimeoutFn(enterTimer);
      pendingEdit = false;
      editedControl = null;
      editedBlockPath = null;
    }
  };
}
