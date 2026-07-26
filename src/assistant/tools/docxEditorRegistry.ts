// Runtime registry for DocumentEditorContainer's live SyncFusion editor.
// The assistant bridge stays SyncFusion-free and resolves this opaque instance
// only when a document tool is called.
const editors = new Map<string, any>();
const DEFAULT_EDITOR_KEY = '__in_form_document_editor__';

const editorKey = (formUuid?: string) => formUuid || DEFAULT_EDITOR_KEY;

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
  formUuid: string | undefined,
  editor: any
) => {
  if (!editor) return;
  editors.set(editorKey(formUuid), editor);
  listeners.forEach((listener) => {
    try {
      listener(editor);
    } catch {
      /* see above: registration is load-bearing for the document tools */
    }
  });
};

export const unregisterDocxEditor = (
  formUuid: string | undefined,
  editor?: any
) => {
  const key = editorKey(formUuid);
  if (editor && editors.get(key) !== editor) return;
  editors.delete(key);
};

export const getDocxEditor = (formUuid?: string): any => {
  if (formUuid && editors.has(formUuid)) return editors.get(formUuid);
  if (editors.has(DEFAULT_EDITOR_KEY)) return editors.get(DEFAULT_EDITOR_KEY);
  return editors.size === 1 ? editors.values().next().value : undefined;
};

export const _clearDocxEditors = (): void => {
  editors.clear();
  listeners.clear();
};
