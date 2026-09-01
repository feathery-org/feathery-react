// Make "delete this table" work from anywhere, and never destroy silently.
//
// Syncfusion refuses destructive commands whenever the selection touches a
// lockContentControl control, and refuses SILENTLY: deleteTable returns at the
// canEditContentControl gate. Every bound table is wrapped in exactly such a
// control, so the one gesture users reach for worked only from an unbound
// cell. Deleting a whole table is never the stray partial edit the lock exists
// to prevent, so the wrap below lifts the gate for explicit table deletion -
// from the toolbar button, the native context menu, and (via the keyDown
// route) a whole-table selection plus Delete/Backspace.
//
// Deleting a table can orphan formulas elsewhere that read its values: they
// keep their last computed number, fail every following reconcile, block
// saving, and are themselves non-deletable (del=keep by design). So the wrap
// first dry-runs the deletion (tableDeleteImpact); when dependents exist the
// host confirms with the user, and on confirm the orphaned controls are
// unwrapped to plain text - the same cached-number semantics the export strip
// applies - just before the delete (see performDelete for the undo ordering).

import {
  analyzeTableDeleteImpact,
  TableDeleteImpact
} from './core/tableDeleteImpact';
import { SfdtDocument } from './core/sfdtTypes';
import {
  isContentControlAttached,
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

/**
 * Wrap editorModule.deleteTable and route whole-table Delete/Backspace through
 * it. Returns an uninstaller that puts everything back.
 */
export function installTableDeleteGuard(
  editor: SyncfusionEditorLike,
  options: TableDeleteGuardOptions = {}
): () => void {
  const anyEditor = editor as AnyEditor;
  const module = editor.editorModule as Record<string, any> | undefined;
  const original = module?.deleteTable;
  if (!module || typeof original !== 'function') return () => {};

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
    !!anyEditor.isReadOnly;

  /** Impact for the table under the selection; null when analysis cannot run. */
  const analyze = (): TableDeleteImpact | null => {
    try {
      const offset = String(anyEditor.selection?.startOffset ?? '');
      const [section, block] = offset.split(';').map(Number);
      if (!Number.isInteger(section) || !Number.isInteger(block)) return null;
      const doc = JSON.parse(editor.serialize()) as SfdtDocument;
      return analyzeTableDeleteImpact(doc, section, block);
    } catch {
      return null;
    }
  };

  /** Widget fragments of the table the caret sits in - the one delete takes. */
  const doomedTableWidgets = (): Set<unknown> => {
    const table = (anyEditor.selection?.start as any)?.paragraph?.associatedCell
      ?.ownerTable;
    if (!table) return new Set();
    const splits =
      typeof table.getSplitWidgets === 'function'
        ? table.getSplitWidgets()
        : null;
    return new Set(Array.isArray(splits) && splits.length ? splits : [table]);
  };

  const isInsideAny = (control: any, roots: Set<unknown>): boolean => {
    let widget: any = control?.line?.paragraph;
    const seen = new Set<unknown>();
    while (widget && !seen.has(widget)) {
      seen.add(widget);
      if (roots.has(widget)) return true;
      widget = widget.containerWidget;
    }
    return false;
  };

  /**
   * Unwrap every attached control carrying one of the tags to plain text -
   * except copies inside the doomed table, which the delete takes anyway (a
   * repeated formula shares one tag across all its occurrences).
   *
   * Each unwrap types the control's value over the whole selected control: one
   * ordinary InsertText history entry whose undo replays through hierarchical
   * position indexes. NOT editorModule.removeContentControl(): its undo
   * re-splices the captured marker elements at captured line indexes
   * (base-history-info revertContentControl), which go stale as soon as the
   * table restore reflows the paragraph - the control comes back empty next to
   * the text and the engine then writes the value into it, duplicating it.
   */
  const unwrapControls = (tags: string[], doomed: Set<unknown>): void => {
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
            String(entry.contentControlProperties?.tag || '') === tag &&
            !isInsideAny(entry, doomed)
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

  // Unwraps happen BEFORE the delete, then the whole set is one grouped
  // history entry, so a single undo restores the table and re-wraps the prose
  // formulas together (group revert runs children last-to-first: the table
  // reflow lands before the InsertText undos, which replay through
  // hierarchical positions and so survive it). Grouping is safe with THESE
  // entry types: the earlier teardown crash came from removeContentControl's
  // revert pushing its own entry onto the undo stack while it also stayed in
  // the group's modifiedActions - double membership, double destroy, and the
  // second destroy reads the owner the first one nulled. InsertText and
  // DeleteTable revert through the standard path where only the group moves
  // between stacks.
  const performDelete = (
    impact: TableDeleteImpact,
    self: unknown,
    args: unknown[],
    anchor: string
  ): unknown => {
    const tags = impact.orphans.flatMap((orphan) => orphan.tags);
    const history = editor.editorHistoryModule as Record<string, any> | null;
    let grouped = false;
    if (
      tags.length &&
      !history?.currentHistoryInfo &&
      typeof module.initComplexHistory === 'function'
    ) {
      module.initComplexHistory('Grouping');
      grouped = true;
    }
    running = true;
    try {
      if (tags.length) {
        // insertText/delete are gated like everything else; the whole-control
        // selection is exactly what the lock would otherwise block.
        withContentControlLocksBypassed(module, () =>
          unwrapControls(tags, doomedTableWidgets())
        );
        try {
          // Unwrapping moved the selection; the delete acts on the anchor.
          if (anchor) anyEditor.selection?.select?.(anchor, anchor);
        } catch {
          // Selection restore is best effort; deleteTable checks the caret.
        }
      }
      return withContentControlLocksBypassed(module, () =>
        original.apply(self, args)
      );
    } finally {
      running = false;
      if (grouped) history?.updateComplexHistory?.();
      try {
        options.onDeleted?.();
      } catch {
        // A reconcile failure must never break the user's delete.
      }
    }
  };

  const patched = function patchedDeleteTable(
    this: unknown,
    ...args: unknown[]
  ): unknown {
    // Replay re-invokes deleteTable with the restored selection, which can sit
    // inside a locked control; the gate would silently eat the redo entry.
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
      return performDelete(impact, this, args, anchor);
    options
      .confirm(impact)
      .then((confirmed) => {
        if (!confirmed || anyEditor.isDestroyed) return;
        // Every caller invokes this as module.deleteTable(), so the deferred
        // apply on `module` matches the synchronous receiver.
        performDelete(impact, module, args, anchor);
      })
      .catch(() => undefined);
    return undefined;
  };
  module.deleteTable = patched;

  // Whole-table selection + Delete/Backspace: today a silent no-op on bound
  // tables. Reroute to deleteTable; plain tables keep native Word behavior.
  const onKeyDown = (args: any): void => {
    try {
      const key = args?.event?.key;
      if (key !== 'Delete' && key !== 'Backspace') return;
      if (passthrough()) return;
      if (!(anyEditor.selection as any)?.isTableSelected?.()) return;
      const impact = analyze();
      if (!impact?.tableId) return;
      args.isHandled = true;
      module.deleteTable();
    } catch {
      // Failing open leaves the native (blocked) behavior, never breaks keys.
    }
  };
  anyEditor.addEventListener?.('keyDown', onKeyDown);

  return () => {
    if (module.deleteTable === patched) module.deleteTable = original;
    try {
      anyEditor.removeEventListener?.('keyDown', onKeyDown);
    } catch {
      // A destroyed instance dereferences null internals; nothing to undo.
    }
  };
}
