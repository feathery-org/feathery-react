// Adapter from the assistant's async tool contract to the single hardened
// SyncFusion operation engine used by the in-form DocumentEditorContainer.
import type { DocxBridge } from '../assistantToolDispatch';
import {
  applyDocumentEdits,
  findDocumentOccurrences,
  getDocumentInventory
} from './syncfusionDocumentOps';

const unavailable = (message: string) => ({
  ok: false,
  error: 'editor_unavailable',
  message
});

export const createDocxEditorBridge = (getEditor: () => any): DocxBridge => ({
  getDocumentInventory: async (input) => {
    const editor = getEditor();
    return editor
      ? getDocumentInventory(editor, input ?? {})
      : unavailable('No in-form document editor is ready.');
  },
  applyDocumentEdits: async (input) => {
    const editor = getEditor();
    return editor
      ? applyDocumentEdits(editor, input ?? {})
      : unavailable('No in-form document editor is ready.');
  },
  findDocumentOccurrences: async (input) => {
    const editor = getEditor();
    return editor
      ? findDocumentOccurrences(editor, input ?? {})
      : unavailable('No in-form document editor is ready.');
  }
});

export { readSelection as readDocxSelection } from './syncfusionDocumentOps';
