// Notice a row the user added or removed with the editor's own tools.
//
// Native row commands never reach the controller: Syncfusion's context menu and
// Tab in the last cell call editorModule.insertRow directly - selectNextCell does
// it for the Tab case - and the menu's delete calls deleteRow. No runCommand
// fires, so nothing reconciles: a new row sat empty until some later commit
// trigger happened to adopt it, and a delete left the totals stale just as long.
//
// Wrapping those two methods covers every entry point, and costs nothing per
// keystroke: the alternative was probing the document on every contentChange.
// The wrap is an around-command interceptor: the native command runs, then
// adoption and formula writes are applied in the same turn. insertRow already
// records one table-clone history entry; grouping adoption on top of that
// clone crashes Syncfusion undo, so adoption stays history-invisible.
// Undo/redo replay those same methods with isUndoing/isRedoing set. Flushing
// then would insert content controls or record writes mid-replay, which
// leaves redo a no-op and strips remaining bindings. Let the native history
// finish; commitTriggers schedules a formulas-only self-heal afterwards.

import { rowCarriesRowBindings } from './core/tableDeleteImpact';
import { SfdtDocument } from './core/sfdtTypes';
import {
  pruneDetachedContentControls,
  withContentControlLocksBypassed,
  SyncfusionEditorLike
} from './editorAdapter';
import { isApplyingNativeStructuralMutations } from './nativeStructuralAdapter';

type RowCommand = (...args: unknown[]) => unknown;

export interface RowCommandWatchOptions {
  /**
   * Fired when an insert-above on a bound row is refused (see
   * blocksInsertAbove below), so the host can explain instead of a silent
   * no-op.
   */
  onInsertAboveBlocked?: () => void;
}

/** A top-level table cell's hierarchical offset: s;b;row;cell;para;offset. */
const CELL_OFFSET_PARTS = 6;

/**
 * Insert-above clones the selected row's controls into the new row, giving two
 * rows the same row id. The reconcile snapshot cannot tell which is the copy -
 * insert-above and copy-below produce identical documents - so adopting would
 * silently move the original's value into the new row. Until the live insert
 * can be attributed reliably, refuse insert-above on a bound row; insert-below
 * attributes correctly (later occurrence is the copy) and stays available.
 */
function blocksInsertAbove(editor: SyncfusionEditorLike): boolean {
  try {
    const anyEditor = editor as SyncfusionEditorLike & Record<string, any>;
    if (!editor.documentHelper?.contentControlCollection?.length) return false;
    const parts = String(anyEditor.selection?.startOffset ?? '')
      .split(';')
      .map(Number);
    if (
      parts.length !== CELL_OFFSET_PARTS ||
      parts.some((n) => !Number.isInteger(n))
    )
      return false;
    const doc = JSON.parse(editor.serialize()) as SfdtDocument;
    return rowCarriesRowBindings(doc, parts[0], parts[1], parts[2]);
  } catch {
    return false;
  }
}

const WATCHED: ReadonlyArray<'insertRow' | 'deleteRow'> = [
  'insertRow',
  'deleteRow'
];

/**
 * Redo of DeleteRow re-invokes deleteRow after restoring the history
 * selection, which often lands inside a locked formula control. Syncfusion
 * then returns immediately, consumes the redo entry, and leaves the row in
 * place — later undo/redo of that ghost entry corrupts remaining bindings.
 * History replay is not a user edit, so the lock must not block it.
 */
function allowRowCommandDuringReplay(
  editor: SyncfusionEditorLike,
  run: () => unknown
): unknown {
  const history = editor.editorHistoryModule;
  const module = editor.editorModule as object | undefined;
  if (!module || (!history?.isUndoing && !history?.isRedoing)) return run();
  return withContentControlLocksBypassed(module, run);
}

/**
 * Run `onRowChange` immediately after each native insert or delete. Returns a
 * function that puts the original methods back, so a detached instance is left
 * as we found it.
 */
export function watchRowCommands(
  editor: SyncfusionEditorLike,
  onRowChange: () => void,
  options: RowCommandWatchOptions = {}
): () => void {
  const editorModule = editor.editorModule as
    | Record<string, RowCommand | undefined>
    | undefined;
  if (!editorModule) return () => undefined;

  const restores: Array<() => void> = [];
  let running = false;
  for (const name of WATCHED) {
    const original = editorModule[name];
    if (typeof original !== 'function') continue;
    const patched: RowCommand = function patchedRowCommand(
      this: unknown,
      ...args: unknown[]
    ) {
      if (running || isApplyingNativeStructuralMutations()) {
        const result = original.apply(this, args);
        pruneDetachedContentControls(editor);
        return result;
      }
      const replayHistory = editor.editorHistoryModule;
      if (
        name === 'insertRow' &&
        args[0] === true &&
        !replayHistory?.isUndoing &&
        !replayHistory?.isRedoing &&
        blocksInsertAbove(editor)
      ) {
        try {
          options.onInsertAboveBlocked?.();
        } catch {
          // The hint must never break the refusal itself.
        }
        return undefined;
      }
      running = true;
      try {
        const result = allowRowCommandDuringReplay(editor, () =>
          original.apply(this, args)
        );
        pruneDetachedContentControls(editor);
        const history = editor.editorHistoryModule;
        if (history?.isUndoing || history?.isRedoing) return result;
        try {
          onRowChange();
        } catch {
          // A failure here must never break the user's row command.
        }
        return result;
      } finally {
        running = false;
      }
    };
    editorModule[name] = patched;
    restores.push(() => {
      // Only restore if nothing else re-patched on top of us.
      if (editorModule[name] === patched) editorModule[name] = original;
    });
  }

  return () => {
    for (const restore of restores) restore();
  };
}
