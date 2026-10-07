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
// leaves redo a no-op and strips remaining bindings - so the CALLER must not
// flush during replay (attachBindings checks). The callback itself still
// fires: a redone insert re-clones the row and needs its attribution hint
// recorded, which is pure note-taking and safe mid-replay. The native history
// finishes, commitTriggers schedules a formulas-only self-heal, and the next
// adopting reconcile consumes the hint.

import { InsertedRowsHint } from './core/sfdtAdapter';
import { tableRowsAt } from './core/tableDeleteImpact';
import { SfdtDocument } from './core/sfdtTypes';
import {
  pruneDetachedContentControls,
  withContentControlLocksBypassed,
  SyncfusionEditorLike
} from './editorAdapter';
import { isApplyingNativeStructuralMutations } from './nativeStructuralAdapter';

type RowCommand = (...args: unknown[]) => unknown;

const activeRowCommands = new WeakSet<SyncfusionEditorLike>();

/** Native selection events must wait until the inserted rows are attributed. */
export function isRunningRowCommand(editor: SyncfusionEditorLike): boolean {
  return activeRowCommands.has(editor);
}

/** A top-level table cell's hierarchical offset: s;b;row;cell;para;offset. */
const CELL_OFFSET_PARTS = 6;

/**
 * The selection's table location before an insert: the one moment above/below
 * and the cursor row are both known. The reconcile snapshot alone cannot tell
 * an inserted clone from its original (insert-above and copy-below serialize
 * identically), so this is where the truth gets recorded.
 */
interface InsertSite {
  sectionIndex: number;
  blockIndex: number;
  rowStart: number;
  rowEnd: number;
  rowCount: number;
}

function captureInsertSite(editor: SyncfusionEditorLike): InsertSite | null {
  try {
    const anyEditor = editor as SyncfusionEditorLike & Record<string, any>;
    if (!editor.documentHelper?.contentControlCollection?.length) return null;
    const offsets = [
      anyEditor.selection?.startOffset,
      anyEditor.selection?.endOffset
    ].map((offset) =>
      String(offset ?? '')
        .split(';')
        .map(Number)
    );
    for (const parts of offsets) {
      if (
        parts.length !== CELL_OFFSET_PARTS ||
        parts.some((n) => !Number.isInteger(n))
      )
        return null;
    }
    const [start, end] = offsets;
    if (start[0] !== end[0] || start[1] !== end[1]) return null;
    const doc = JSON.parse(editor.serialize()) as SfdtDocument;
    const rows = tableRowsAt(doc, start[0], start[1]);
    if (!rows) return null;
    return {
      sectionIndex: start[0],
      blockIndex: start[1],
      rowStart: Math.min(start[2], end[2]),
      rowEnd: Math.max(start[2], end[2]),
      rowCount: rows.length
    };
  } catch {
    return null;
  }
}

/** Which rows the insert created: measured, not guessed from the count arg. */
function insertedRowsHint(
  editor: SyncfusionEditorLike,
  site: InsertSite,
  above: boolean
): InsertedRowsHint | undefined {
  try {
    const doc = JSON.parse(editor.serialize()) as SfdtDocument;
    const rows = tableRowsAt(doc, site.sectionIndex, site.blockIndex);
    const delta = rows ? rows.length - site.rowCount : 0;
    if (delta <= 0) return undefined;
    const first = above ? site.rowStart : site.rowEnd + 1;
    return {
      sectionIndex: site.sectionIndex,
      blockIndex: site.blockIndex,
      rowIndices: Array.from({ length: delta }, (_, i) => first + i)
    };
  } catch {
    return undefined;
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
 * Run `onRowChange` immediately after each native insert or delete. An insert
 * passes the rows it created, so adoption re-adopts exactly those; a delete
 * passes nothing, which also clears any stale hint. Returns a function that
 * puts the original methods back, so a detached instance is left as we found it.
 */
export function watchRowCommands(
  editor: SyncfusionEditorLike,
  onRowChange: (insertedRows?: InsertedRowsHint) => void
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
      running = true;
      try {
        // Captured during replay too: a REDO re-invokes insertRow and re-clones
        // the row, so redo needs attribution as much as the first insert did.
        // Recording positions is side-effect-free; the caller gates flushing.
        const site = name === 'insertRow' ? captureInsertSite(editor) : null;
        let result: unknown;
        activeRowCommands.add(editor);
        try {
          result = allowRowCommandDuringReplay(editor, () =>
            original.apply(this, args)
          );
        } finally {
          activeRowCommands.delete(editor);
        }
        pruneDetachedContentControls(editor);
        try {
          onRowChange(
            site ? insertedRowsHint(editor, site, args[0] === true) : undefined
          );
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
