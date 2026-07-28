// Runtime registry for DocumentEditorContainer's live SyncFusion editor.
// The assistant bridge stays SyncFusion-free and resolves this opaque instance
// only when a document tool is called.
type EditorInstanceId = string | object;
type EditorRegistration = {
  instanceId: EditorInstanceId;
  editor: any;
};
let registration: EditorRegistration | undefined;

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
// replays the editor already registered. Subscribers must therefore be
// idempotent for a given editor.
type DocxEditorListener = (editor: any) => void;
const listeners = new Set<DocxEditorListener>();

export const subscribeDocxEditors = (
  listener: DocxEditorListener
): (() => void) => {
  listeners.add(listener);
  if (registration) {
    try {
      listener(registration.editor);
    } catch {
      /* a broken subscriber must never break editor registration */
    }
  }
  return () => listeners.delete(listener);
};

export const registerDocxEditor = (
  editorInstanceId: string | undefined,
  editor: any
): boolean => {
  if (!editor) return false;
  const resolvedInstanceId = resolveEditorInstanceId(editorInstanceId, editor);
  if (registration && registration.instanceId !== resolvedInstanceId) {
    console.error(
      'Feathery: only one document editor is supported per form. ' +
        `Ignored ${describeEditorInstance(resolvedInstanceId)} because ` +
        `${describeEditorInstance(
          registration.instanceId
        )} is already registered.`
    );
    return false;
  }
  registration = { instanceId: resolvedInstanceId, editor };
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
  if (
    registration?.instanceId !== resolvedInstanceId ||
    registration.editor !== editor
  ) {
    return;
  }
  registration = undefined;
};

// Existing assistant callers pass a form instance id. It is intentionally not
// a selector now that this registry permits exactly one editor.
export function getDocxEditor(editorInstanceId?: string): any;
export function getDocxEditor(): any {
  return registration?.editor;
}

export const _clearDocxEditors = (): void => {
  registration = undefined;
  listeners.clear();
};
