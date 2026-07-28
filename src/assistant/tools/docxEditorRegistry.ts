// Runtime registry for DocumentEditorContainer's live SyncFusion editor.
// The assistant bridge stays SyncFusion-free and resolves this opaque instance
// only when a document tool is called.
type EditorInstanceId = string | object;
const editors = new Map<EditorInstanceId, any>();

const resolveEditorInstanceId = (
  editorInstanceId: string | undefined,
  editor: any
): EditorInstanceId => editorInstanceId ?? editor;

// Consumers that need to react to an editor appearing, not just resolve one on
// demand (the document indexer). Registration order is not controllable - the
// editor can register before or after a subscriber mounts - so `subscribe`
// replays every editor already registered. Subscribers must therefore be
// idempotent for a given editor.
type DocxEditorListener = (editor: any) => void;
const listeners = new Set<DocxEditorListener>();

export const subscribeDocxEditors = (
  listener: DocxEditorListener
): (() => void) => {
  listeners.add(listener);
  editors.forEach((editor) => {
    try {
      listener(editor);
    } catch {
      /* a broken subscriber must never break editor registration */
    }
  });
  return () => listeners.delete(listener);
};

export const registerDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any
) => {
  if (!editor) return;
  editors.set(resolveEditorInstanceId(editorInstanceId, editor), editor);
  listeners.forEach((listener) => {
    try {
      listener(editor);
    } catch {
      /* see above: registration is load-bearing for the document tools */
    }
  });
};

export const unregisterDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any
) => {
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  if (editors.get(resolvedInstanceId) !== editor) return;
  editors.delete(resolvedInstanceId);
};

export const getDocxEditor = (editorInstanceId?: string): any => {
  if (editorInstanceId && editors.has(editorInstanceId)) {
    return editors.get(editorInstanceId);
  }
  return editors.size === 1 ? editors.values().next().value : undefined;
};

export const _clearDocxEditors = (): void => {
  editors.clear();
  listeners.clear();
};
