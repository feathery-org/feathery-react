// Runtime registry for DocumentEditorContainer's live SyncFusion editor.
// The assistant bridge stays SyncFusion-free and resolves this opaque instance
// only when a document tool is called.
const editors = new Map<string, any>();
const DEFAULT_EDITOR_KEY = '__in_form_document_editor__';

const editorKey = (formUuid?: string) => formUuid || DEFAULT_EDITOR_KEY;

export const registerDocxEditor = (
  formUuid: string | undefined,
  editor: any
) => {
  if (editor) editors.set(editorKey(formUuid), editor);
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

export const _clearDocxEditors = (): void => editors.clear();
