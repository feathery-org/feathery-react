// Make undo reach past a structural reconcile.
//
// Adding bindings to a row the user inserted is a STRUCTURAL change, so the
// controller reloads the document through open() - and that throws away
// Syncfusion's entire undo stack. The row insert itself was undoable a moment
// earlier; after the reload there is nothing native left to undo, so Ctrl+Z did
// nothing at all. The controller keeps its own snapshots for exactly this case
// (controller.undo/redo), but nothing was calling them.
//
// Patching editorHistory.undo/redo covers every entry point at once: Ctrl+Z and
// Ctrl+Y land on the same methods (editor.js keycodes 90 and 89) as the toolbar
// buttons, and `editorHistory` is a getter for `editorHistoryModule`, so there is
// only one object to patch.
//
// The rule is deliberately conservative: native history always wins while it has
// anything left. Only once it is exhausted - which is the state a reload leaves
// behind - does a snapshot get used. So ordinary editing behaves exactly as
// before, and a snapshot is reached only when the alternative is doing nothing.

import { SyncfusionEditorLike } from './editorAdapter';

/** The controller's snapshot stacks, as this module needs them. */
export interface SnapshotHistory {
  undo(): boolean;
  redo(): boolean;
}

type HistoryFn = (...args: unknown[]) => unknown;

interface HistoryModuleLike {
  undo?: HistoryFn;
  redo?: HistoryFn;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
}

/**
 * Fall back to `snapshots` when the editor's own history has run out. Returns a
 * function that puts the original methods back.
 */
export function installHistoryBridge(
  editor: SyncfusionEditorLike,
  snapshots: SnapshotHistory
): () => void {
  const history = editor.editorHistoryModule as HistoryModuleLike | undefined;
  const nativeUndo = history?.undo;
  const nativeRedo = history?.redo;
  if (
    !history ||
    typeof nativeUndo !== 'function' ||
    typeof nativeRedo !== 'function'
  ) {
    return () => undefined;
  }

  /**
   * True when the editor still has native history for this direction. Missing
   * capability methods count as "yes", so an unrecognized build keeps its own
   * behaviour rather than having snapshots substituted underneath it.
   */
  const nativeHas = (check: (() => boolean) | undefined): boolean => {
    if (typeof check !== 'function') return true;
    try {
      return !!check.call(history);
    } catch {
      return true;
    }
  };

  const bridge = (
    native: HistoryFn,
    check: (() => boolean) | undefined,
    fromSnapshot: () => boolean
  ): HistoryFn =>
    function bridged(this: unknown, ...args: unknown[]) {
      if (!nativeHas(check)) {
        try {
          // Only stop here if a snapshot was actually restored.
          if (fromSnapshot()) return undefined;
        } catch {
          // A broken snapshot must not swallow the keystroke.
        }
      }
      return native.apply(this, args);
    };

  const patchedUndo = bridge(nativeUndo, history.canUndo, () =>
    snapshots.undo()
  );
  const patchedRedo = bridge(nativeRedo, history.canRedo, () =>
    snapshots.redo()
  );
  history.undo = patchedUndo;
  history.redo = patchedRedo;

  return () => {
    if (history.undo === patchedUndo) history.undo = nativeUndo;
    if (history.redo === patchedRedo) history.redo = nativeRedo;
  };
}
