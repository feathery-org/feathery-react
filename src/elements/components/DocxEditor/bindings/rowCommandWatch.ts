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

import { SyncfusionEditorLike } from './editorAdapter';

type RowCommand = (...args: unknown[]) => unknown;

const WATCHED: ReadonlyArray<'insertRow' | 'deleteRow'> = [
  'insertRow',
  'deleteRow'
];

/**
 * Call `onRowChange` after every native row insert or delete. Returns a function
 * that puts the original methods back, so a detached instance is left as we
 * found it.
 */
export function watchRowCommands(
  editor: SyncfusionEditorLike,
  onRowChange: () => void
): () => void {
  const editorModule = editor.editorModule as
    | Record<string, RowCommand | undefined>
    | undefined;
  if (!editorModule) return () => undefined;

  const restores: Array<() => void> = [];
  for (const name of WATCHED) {
    const original = editorModule[name];
    if (typeof original !== 'function') continue;
    const patched: RowCommand = function patchedRowCommand(
      this: unknown,
      ...args: unknown[]
    ) {
      const result = original.apply(this, args);
      try {
        onRowChange();
      } catch {
        // A failure here must never break the user's row command.
      }
      return result;
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
