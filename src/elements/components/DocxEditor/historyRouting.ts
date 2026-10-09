// Undo and redo through Robin's routing (decision D4) wherever the editor has a document session:
// the toolbar buttons, Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) in the document, and the same chords
// pressed in the review rail. Without a session everything goes to the editor's own history, as
// before.
import { historyRouteFor } from '../../../robin/document/mounts';

const nativeHistory = (editor: any) =>
  editor?.editorHistory ?? editor?.editorHistoryModule;

export function undoDocument(editor: any): void {
  const route = historyRouteFor(editor);
  if (route) route.undo();
  else nativeHistory(editor)?.undo?.();
}

export function redoDocument(editor: any): void {
  const route = historyRouteFor(editor);
  if (route) route.redo();
  else nativeHistory(editor)?.redo?.();
}

/** Which history chord a key event is, if any. */
export function historyChord(event: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = String(event.key ?? '').toLowerCase();
  if (key === 'y') return 'redo';
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return null;
}

/**
 * Route the document's own undo and redo chords. Installs one keyDown listener; only when the
 * editor has a route is the event taken from the editor (isHandled), so an editor without a
 * session keeps its native behaviour untouched.
 */
export function installHistoryRouting(editor: any): () => void {
  if (!editor?.addEventListener) return () => {};
  const onKeyDown = (args: any) => {
    const chord = historyChord(args?.event ?? {});
    if (!chord || !historyRouteFor(editor)) return;
    args.isHandled = true;
    args.event?.preventDefault?.();
    if (chord === 'undo') undoDocument(editor);
    else redoDocument(editor);
  };
  editor.addEventListener('keyDown', onKeyDown);
  return () => {
    try {
      editor.removeEventListener?.('keyDown', onKeyDown);
    } catch {
      // a destroyed editor has nothing to detach from
    }
  };
}
