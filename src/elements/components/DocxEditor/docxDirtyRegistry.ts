import { featheryWindow, runningInClient } from '../../../utils/browser';

// Legacy fallback so editors rendered without a formId still get guarded.
const DEFAULT_FORM_ID = '__legacy_document_form__';

// formId -> containerIds of mounted editors with unsaved changes
const dirtyByForm = new Map<string, Set<string>>();
let listenerAttached = false;

const beforeUnloadHandler = (event: any) => {
  event.preventDefault();
  // Legacy method of doing this for Chrome/Edge < 119
  event.returnValue = true;
};

// The browser unload warning is armed only while at least one editor is dirty
const syncUnloadListener = () => {
  if (!runningInClient()) return;
  const anyDirty = [...dirtyByForm.values()].some((set) => set.size > 0);
  if (anyDirty && !listenerAttached) {
    featheryWindow().addEventListener('beforeunload', beforeUnloadHandler);
    listenerAttached = true;
  } else if (!anyDirty && listenerAttached) {
    featheryWindow().removeEventListener('beforeunload', beforeUnloadHandler);
    listenerAttached = false;
  }
};

const formKey = (formId?: string) => formId || DEFAULT_FORM_ID;

export const setDocxEditorDirty = (
  formId: string | undefined,
  containerId: string,
  dirty: boolean
) => {
  const key = formKey(formId);
  if (dirty) {
    const set = dirtyByForm.get(key) ?? new Set<string>();
    set.add(containerId);
    dirtyByForm.set(key, set);
  } else {
    const set = dirtyByForm.get(key);
    set?.delete(containerId);
    if (set && set.size === 0) dirtyByForm.delete(key);
  }
  syncUnloadListener();
};

export const clearDocxEditorDirty = (
  formId: string | undefined,
  containerId: string
) => setDocxEditorDirty(formId, containerId, false);

export const hasDirtyDocxEditors = (formId?: string): boolean =>
  (dirtyByForm.get(formKey(formId))?.size ?? 0) > 0;

// Called when the user opts to discard changes so a subsequent redirect
// doesn't re-trigger the browser unload warning
export const discardDocxDirty = (formId?: string) => {
  dirtyByForm.delete(formKey(formId));
  syncUnloadListener();
};

export const _clearDocxDirtyRegistry = () => {
  dirtyByForm.clear();
  syncUnloadListener();
};
