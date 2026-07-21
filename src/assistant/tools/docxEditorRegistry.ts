// Runtime registry that connects the in-form `docx_editor` field's mounted
// SyncFusion DocumentEditor to the Assist ops. The field registers its live
// editor instance here on mount (via onEditorReady) and removes it on unmount;
// AssistantChat's default docx bridge reads it back to drive
// getDocumentInventory / applyDocumentEdits against the actual editor.
//
// This module is SyncFusion-free: it only holds the opaque editor object the
// field hands in - it never imports or constructs SyncFusion.

// Keyed by form instance id (_internalId) so multiple forms can coexist.
const editors = new Map<string, any>();

export const registerDocxEditor = (
  formUuid: string | undefined,
  editor: any
): void => {
  if (!formUuid || !editor) return;
  editors.set(formUuid, editor);
};

export const unregisterDocxEditor = (
  formUuid: string | undefined,
  editor?: any
): void => {
  if (!formUuid) return;
  // Only clear if it's still the editor we registered (guards against a
  // remount that already replaced the entry).
  if (editor && editors.get(formUuid) !== editor) return;
  editors.delete(formUuid);
};

// Resolve the editor for a form. When no id is given (or it isn't registered)
// and exactly one editor is registered, return that one - the common
// single-editor docx surface. Ambiguity (2+) with no matching id returns
// undefined rather than guessing.
export const getDocxEditor = (formUuid?: string): any => {
  if (formUuid && editors.has(formUuid)) return editors.get(formUuid);
  if (editors.size === 1) return editors.values().next().value;
  return undefined;
};

// Test/teardown helper.
export const _clearDocxEditors = (): void => editors.clear();
