/**
 * The editor's undo groups (nested `initComplexHistory`s), driven from outside it: open one around
 * several edits so one undo takes them all back, and close every group a failed edit left open.
 */
type Obj = Record<string, any>;
type Editor = Obj;

export const historyOf = (editor: Editor): Obj | undefined =>
  (editor.editorHistory ?? editor.editorHistoryModule) as Obj | undefined;

/** How many undo groups the editor has open (nested `initComplexHistory`s). */
export function openUndoGroups(editor: Editor): number {
  return (
    (historyOf(editor)?.historyInfoStack as unknown[] | undefined)?.length ?? 0
  );
}

/**
 * Close the editor's undo groups down to `depth`, innermost first, each into the one around it:
 * after a step that threw inside its own group (the editor's contents rebuild opens one), what it
 * did is still part of the change's group, so undoing that group takes it back, and the person's
 * own undo is never left inside a group that never closes.
 */
export function closeUndoGroups(editor: Editor, depth: number): void {
  const history = historyOf(editor);
  for (let open = openUndoGroups(editor); open > depth; ) {
    history?.updateComplexHistory?.();
    const now = openUndoGroups(editor);
    if (now >= open) break;
    open = now;
  }
}

/**
 * `run` as the editor's one undo group (one `initComplexHistory`), unless a group is already open,
 * whose part it then is: a change and the derived content refreshed after it undo together.
 */
export function inUndoGroup(editor: Editor, run: () => void): void {
  const module = editor.editorModule as Obj | undefined;
  const depth = openUndoGroups(editor);
  if (
    !historyOf(editor)?.currentHistoryInfo &&
    typeof module?.initComplexHistory === 'function'
  )
    module.initComplexHistory('Grouping');
  try {
    run();
  } finally {
    closeUndoGroups(editor, depth);
  }
}
