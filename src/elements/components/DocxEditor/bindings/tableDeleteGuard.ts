// Make "delete this table/row" work from anywhere, and never destroy silently.
//
// Syncfusion refuses destructive commands whenever the selection touches a
// lockContentControl control, and refuses SILENTLY: deleteTable and deleteRow
// return at the canEditContentControl gate. Every bound table is wrapped in
// exactly such a control and formula cells lock their contents, so the
// gestures users reach for worked only from an unbound cell. Deleting a whole
// table or row is never the stray partial edit the lock exists to prevent, so
// the wraps below lift the gate for those explicit gestures - the toolbar
// buttons, the native context menu, and (via the keyDown route) a whole-table
// selection plus Delete/Backspace.
//
// A deletion can orphan formulas elsewhere that read the deleted values: they
// keep their last computed number, fail every following reconcile, block
// saving, and are themselves non-deletable (del=keep by design). So the wraps
// first dry-run the deletion (tableDeleteImpact); when dependents exist the
// host confirms with the user, and on confirm the surviving orphaned controls
// are unwrapped to plain text - the same cached-number semantics the export
// strip applies. The delete runs FIRST, then the unwraps: dying copies of a
// repeated tag are pruned by then, so tag lookup alone finds the survivors.
// The whole set is one grouped history entry - a single undo restores the
// table/row and re-wraps the prose formulas together. Grouping is safe with
// these entry types: the earlier teardown crash came from removeContentControl
// reverts pushing their own entry onto the undo stack while it also stayed in
// the group's modifiedActions (double membership, double destroy); InsertText
// and Delete entries revert through the standard path where only the group
// moves between stacks.

import {
  analyzeRowDeleteImpact,
  analyzeTableDeleteImpact,
  TableDeleteImpact
} from './core/tableDeleteImpact';
import { SfdtDocument } from './core/sfdtTypes';
import {
  isContentControlAttached,
  normalizeContentControlCollection,
  pruneDetachedContentControls,
  withContentControlLocksBypassed,
  SyncfusionEditorLike
} from './editorAdapter';
import { isApplyingNativeStructuralMutations } from './nativeStructuralAdapter';

export type {
  TableDeleteImpact,
  OrphanedFormula
} from './core/tableDeleteImpact';

export interface TableDeleteGuardOptions {
  /**
   * Asked before a deletion that orphans formulas elsewhere. Resolving false
   * cancels; absent means proceed (headless hosts still get consistent
   * documents, just without the prompt).
   */
  confirm?: (impact: TableDeleteImpact) => Promise<boolean>;
  /** Runs after a completed delete (and unwraps), for a reconcile. */
  onDeleted?: () => void;
}

type AnyEditor = SyncfusionEditorLike & Record<string, any>;

/** A top-level table cell's hierarchical index: s;b;row;cell;para;offset. */
const CELL_OFFSET_PARTS = 6;

/**
 * Wrap editorModule.deleteTable/deleteRow and route whole-table
 * Delete/Backspace through the table wrap. Returns an uninstaller.
 * Install BEFORE rowCommandWatch so its wrapper stays outermost and its
 * post-command reconcile fires after the grouped history entry closes.
 */
export function installTableDeleteGuard(
  editor: SyncfusionEditorLike,
  options: TableDeleteGuardOptions = {}
): () => void {
  const anyEditor = editor as AnyEditor;
  const module = editor.editorModule as Record<string, any> | undefined;
  const originalTable = module?.deleteTable;
  const originalRow = module?.deleteRow;
  if (!module || typeof originalTable !== 'function') return () => {};

  let running = false;
  const replaying = (): boolean => {
    const history = editor.editorHistoryModule;
    return !!history?.isUndoing || !!history?.isRedoing;
  };
  const passthrough = (): boolean =>
    running ||
    isApplyingNativeStructuralMutations() ||
    replaying() ||
    !!anyEditor.enableTrackChanges ||
    !!anyEditor.isReadOnly ||
    // No content controls, nothing to guard - skip the serialize dry run.
    !editor.documentHelper?.contentControlCollection?.length;

  /** [section, block, row] triples for both selection ends, or null. */
  const selectionCellParts = (): { start: number[]; end: number[] } | null => {
    const start = String(anyEditor.selection?.startOffset ?? '')
      .split(';')
      .map(Number);
    const end = String(anyEditor.selection?.endOffset ?? '')
      .split(';')
      .map(Number);
    // Deeper than one cell level means a nested table: the native command
    // targets the inner table while the block index names the outer one, so
    // the dry run would analyze the wrong thing - fall back to native.
    if (start.length !== CELL_OFFSET_PARTS || end.length !== CELL_OFFSET_PARTS)
      return null;
    if (start.some((n) => !Number.isInteger(n))) return null;
    if (end.some((n) => !Number.isInteger(n))) return null;
    if (start[0] !== end[0] || start[1] !== end[1]) return null;
    return { start, end };
  };

  const analyzeTable = (): TableDeleteImpact | null => {
    try {
      const parts = selectionCellParts();
      if (!parts) return null;
      const doc = JSON.parse(editor.serialize()) as SfdtDocument;
      return analyzeTableDeleteImpact(doc, parts.start[0], parts.start[1]);
    } catch {
      return null;
    }
  };

  const analyzeRows = (): TableDeleteImpact | null => {
    try {
      const parts = selectionCellParts();
      if (!parts) return null;
      const doc = JSON.parse(editor.serialize()) as SfdtDocument;
      return analyzeRowDeleteImpact(
        doc,
        parts.start[0],
        parts.start[1],
        Math.min(parts.start[2], parts.end[2]),
        Math.max(parts.start[2], parts.end[2])
      );
    } catch {
      return null;
    }
  };

  /**
   * Unwrap every attached control carrying one of the tags to plain text.
   * Runs after the delete, so a repeated tag's dying copies are already gone.
   *
   * Each unwrap types the control's value over the whole selected control: one
   * ordinary InsertText history entry whose undo replays through hierarchical
   * position indexes. NOT editorModule.removeContentControl(): its undo
   * re-splices the captured marker elements at captured line indexes
   * (base-history-info revertContentControl), which go stale as soon as the
   * table restore reflows the paragraph - the control comes back empty next to
   * the text and the engine then writes the value into it, duplicating it.
   */
  const unwrapControls = (tags: string[]): void => {
    const selection = anyEditor.selection as any;
    if (!selection?.selectContentControl || !module.insertText) return;
    pruneDetachedContentControls(editor);
    for (const tag of tags) {
      // Unwrapping reindexes the collection - re-query every pass.
      for (let safety = 0; safety < 100; safety++) {
        const collection =
          editor.documentHelper?.contentControlCollection ?? [];
        const control = collection.find(
          (entry: any) =>
            isContentControlAttached(entry) &&
            String(entry.contentControlProperties?.tag || '') === tag
        );
        if (!control) break;
        // Content-only selection reads the display value...
        selection.selectContentControlInternal?.(control);
        const value = String(selection.text ?? '');
        // ...then the whole control (markers included) gets typed over.
        selection.selectContentControl(control);
        if (value) module.insertText(value);
        else module.delete?.();
        pruneDetachedContentControls(editor);
      }
    }
  };

  // Ordering and grouping differ by scope, and both matter for undo:
  //
  //   table - delete FIRST, unwrap after, all in ONE grouped entry (a single
  //   undo restores everything). Dying copies of a repeated tag are pruned by
  //   the delete, so tag lookup finds only survivors; the unwraps all live
  //   OUTSIDE the deleted table, so the group's reverse-order revert (inserts
  //   undone before the table restore) never relayouts under them.
  //
  //   row - unwrap FIRST, delete after, NO native grouping. Row entries are
  //   table-clone based, and any grouped revert touching one crashes this
  //   Syncfusion version on detached widgets (reLayout reads a stale
  //   bodyWidget; same fragility rowCommandWatch documents for insertRow, and
  //   probed both group orderings). The entries stay sequential - each undo
  //   cycle is the safe native one, with a full relayout between - and the
  //   undo/redo wrap below chains them into one user gesture instead. The
  //   unwrap-first order keeps every intermediate frame consistent: the row
  //   restore (and relayout) lands before the InsertText reverts replay. A
  //   dying-row twin of an orphan tag gets unwrapped too - harmless, the
  //   delete takes the plain text with it and its own undo restores it.
  let atomicSetCounter = 0;
  const atomicSetIds = new WeakMap<object, number>();

  const performDelete = (
    impact: TableDeleteImpact,
    fn: (...args: unknown[]) => unknown,
    self: unknown,
    args: unknown[],
    anchor: string
  ): unknown => {
    const tags = impact.orphans.flatMap((orphan) => orphan.tags);
    const unwrapFirst = impact.scope === 'row';
    const history = editor.editorHistoryModule as Record<string, any> | null;
    // The stack is lazily created on the first recorded edit; absent means 0.
    const stackBefore = Array.isArray(history?.undoStack)
      ? history?.undoStack.length
      : 0;
    let grouped = false;
    if (
      tags.length &&
      impact.scope === 'table' &&
      !history?.currentHistoryInfo &&
      typeof module.initComplexHistory === 'function'
    ) {
      module.initComplexHistory('Grouping');
      grouped = true;
    }
    running = true;
    try {
      // insertText/delete are gated like everything else; the whole-control
      // selection is exactly what the lock would otherwise block.
      if (unwrapFirst && tags.length) {
        withContentControlLocksBypassed(module, () => unwrapControls(tags));
        try {
          // Unwrapping moved the selection; the delete acts on the anchor.
          if (anchor) anyEditor.selection?.select?.(anchor, anchor);
        } catch {
          // Selection restore is best effort; the command checks the caret.
        }
      }
      const result = withContentControlLocksBypassed(module, () =>
        fn.apply(self, args)
      );
      if (!unwrapFirst && tags.length)
        withContentControlLocksBypassed(module, () => unwrapControls(tags));
      return result;
    } finally {
      running = false;
      if (grouped) history?.updateComplexHistory?.();
      // Mark the ungrouped entries as one atomic set for the undo/redo chain.
      if (!grouped && tags.length) {
        const pushed = (history?.undoStack ?? []).slice(stackBefore);
        if (pushed.length > 1) {
          const setId = ++atomicSetCounter;
          for (const entry of pushed)
            if (entry && typeof entry === 'object')
              atomicSetIds.set(entry, setId);
        }
      }
      // The delete + unwraps also re-register controls; keep document order.
      try {
        normalizeContentControlCollection(editor);
      } catch {
        // Healing is best effort.
      }
      try {
        options.onDeleted?.();
      } catch {
        // A reconcile failure must never break the user's delete.
      }
      // The confirmation dialog stole keyboard focus; without this, the
      // Ctrl+Z right after a confirmed delete goes nowhere.
      try {
        anyEditor.focusIn?.();
      } catch {
        // Focus is a nicety; a torn-down editor must not break the delete.
      }
    }
  };

  // One user gesture undoes/redoes a whole atomic set: after the native call
  // consumes an entry belonging to a set, keep calling it while the next entry
  // on that stack belongs to the SAME set. Every inner call is a complete
  // native cycle (revert + relayout + fresh selection), which is exactly why
  // this works where initComplexHistory crashes.
  const history = editor.editorHistoryModule as Record<string, any> | null;
  const chainAtomicSet = (
    original: (...args: unknown[]) => unknown,
    stackKey: 'undoStack' | 'redoStack'
  ) =>
    function chained(this: any, ...args: unknown[]): unknown {
      const stack = this?.[stackKey];
      const top = Array.isArray(stack) ? stack[stack.length - 1] : undefined;
      const setId = top ? atomicSetIds.get(top) : undefined;
      const result = original.apply(this, args);
      if (setId !== undefined) {
        for (let safety = 0; safety < 100; safety++) {
          const current = this?.[stackKey];
          if (!Array.isArray(current)) break;
          const next = current[current.length - 1];
          if (!next || atomicSetIds.get(next) !== setId) break;
          const lengthBefore = current.length;
          original.apply(this, args);
          // A refused call (read-only, disabled history) must not spin here.
          if (current.length === lengthBefore) break;
        }
      }
      // Undo re-registers restored controls at the END of the collection, and
      // every Syncfusion lookup assumes document order - out of order, a
      // restored control loses chrome, lock, and engine writes.
      try {
        normalizeContentControlCollection(editor);
      } catch {
        // Healing is best effort; the undo itself already happened.
      }
      return result;
    };
  const originalUndo = history?.undo;
  const originalRedo = history?.redo;
  const patchedUndo =
    history && typeof originalUndo === 'function'
      ? chainAtomicSet(originalUndo, 'undoStack')
      : null;
  const patchedRedo =
    history && typeof originalRedo === 'function'
      ? chainAtomicSet(originalRedo, 'redoStack')
      : null;
  if (history && patchedUndo) history.undo = patchedUndo;
  if (history && patchedRedo) history.redo = patchedRedo;

  const makePatched = (
    original: (...args: unknown[]) => unknown,
    analyze: () => TableDeleteImpact | null
  ) =>
    function patchedDelete(this: unknown, ...args: unknown[]): unknown {
      // Replay re-invokes the command with the restored selection, which can
      // sit inside a locked control; the gate would silently eat the entry.
      if (replaying())
        return withContentControlLocksBypassed(module, () =>
          original.apply(this, args)
        );
      if (passthrough()) return original.apply(this, args);
      const impact = analyze();
      // Unrecognizable selection or document: exactly the native behavior.
      if (!impact) return original.apply(this, args);
      const anchor = String(anyEditor.selection?.startOffset ?? '');
      if (!impact.orphans.length || !options.confirm)
        return performDelete(impact, original, this, args, anchor);
      options
        .confirm(impact)
        .then((confirmed) => {
          if (anyEditor.isDestroyed) return;
          if (!confirmed) {
            // Cancel also stole focus; hand it back so typing/undo work.
            try {
              anyEditor.focusIn?.();
            } catch {
              // Focus is a nicety only.
            }
            return;
          }
          // Every caller invokes these as module methods, so the deferred
          // apply on `module` matches the synchronous receiver.
          performDelete(impact, original, module, args, anchor);
        })
        .catch(() => undefined);
      return undefined;
    };

  const patchedTable = makePatched(originalTable, analyzeTable);
  module.deleteTable = patchedTable;
  const patchedRow =
    typeof originalRow === 'function'
      ? makePatched(originalRow, analyzeRows)
      : null;
  if (patchedRow) module.deleteRow = patchedRow;

  // Whole-table or whole-row selection + Delete/Backspace: today a silent
  // no-op on bound tables (the selection fully contains locked controls).
  // Reroute to the guarded deleteTable/deleteRow; plain tables and partial
  // selections keep native Word behavior.
  const onKeyDown = (args: any): void => {
    try {
      const key = args?.event?.key;
      if (key !== 'Delete' && key !== 'Backspace') return;
      if (passthrough()) return;
      const selection = anyEditor.selection as any;
      if (selection?.isTableSelected?.()) {
        const impact = analyzeTable();
        if (!impact?.tableId) return;
        args.isHandled = true;
        module.deleteTable();
        return;
      }
      if (selection?.isRowSelected?.()) {
        const impact = analyzeRows();
        if (!impact?.tableId) return;
        args.isHandled = true;
        module.deleteRow();
      }
    } catch {
      // Failing open leaves the native (blocked) behavior, never breaks keys.
    }
  };
  anyEditor.addEventListener?.('keyDown', onKeyDown);

  return () => {
    if (module.deleteTable === patchedTable) module.deleteTable = originalTable;
    if (patchedRow && module.deleteRow === patchedRow)
      module.deleteRow = originalRow;
    try {
      if (history && patchedUndo && history.undo === patchedUndo)
        history.undo = originalUndo;
      if (history && patchedRedo && history.redo === patchedRedo)
        history.redo = originalRedo;
      anyEditor.removeEventListener?.('keyDown', onKeyDown);
    } catch {
      // A destroyed instance dereferences null internals; nothing to undo.
    }
  };
}
