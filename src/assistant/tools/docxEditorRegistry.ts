// Runtime registry for DocumentEditorContainer's live SyncFusion editor.
// The assistant bridge stays SyncFusion-free and resolves this opaque instance
// only when a document tool is called.
type EditorInstanceId = string | object;
const editors = new Map<EditorInstanceId, any>();

const resolveEditorInstanceId = (
  editorInstanceId: string | undefined,
  editor: any
): EditorInstanceId => editorInstanceId ?? editor;

const describeEditorInstance = (editorInstanceId: EditorInstanceId): string =>
  typeof editorInstanceId === 'string'
    ? `"${editorInstanceId}"`
    : '<anonymous editor>';

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
): boolean => {
  if (!editor) return false;
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  const activeInstanceId = editors.keys().next().value as
    | EditorInstanceId
    | undefined;
  if (
    activeInstanceId !== undefined &&
    activeInstanceId !== resolvedInstanceId
  ) {
    console.error(
      'Feathery: only one document editor is supported per form. ' +
        `Ignored ${describeEditorInstance(resolvedInstanceId)} because ` +
        `${describeEditorInstance(activeInstanceId)} is already registered.`
    );
    return false;
  }
  editors.set(resolvedInstanceId, editor);
  listeners.forEach((listener) => {
    try {
      listener(editor);
    } catch {
      /* see above: registration is load-bearing for the document tools */
    }
  });
  return true;
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
