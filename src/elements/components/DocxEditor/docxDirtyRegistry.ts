import {
  clearUnsavedWork,
  setUnsavedWork,
  unsavedWorkSources,
  _clearUnsavedWorkRegistry
} from '../../../utils/unsavedWork';

export const UNSAVED_DOCX_MESSAGE =
  'You have unsaved changes in the document editor. If you leave now, your changes will be lost.';

// The document editor's slice of the form-wide unsaved-work registry, which
// owns the browser unload listener and the leave prompt.
const sourceId = (containerId: string) => `docx:${containerId}`;

export const setDocxEditorDirty = (
  formId: string | undefined,
  containerId: string,
  dirty: boolean
) =>
  setUnsavedWork(
    formId,
    sourceId(containerId),
    dirty ? UNSAVED_DOCX_MESSAGE : null
  );

export const clearDocxEditorDirty = (
  formId: string | undefined,
  containerId: string
) => clearUnsavedWork(formId, sourceId(containerId));

export const hasDirtyDocxEditors = (formId?: string): boolean =>
  unsavedWorkSources(formId).some((id) => id.startsWith('docx:'));

export const _clearDocxDirtyRegistry = () => _clearUnsavedWorkRegistry();
