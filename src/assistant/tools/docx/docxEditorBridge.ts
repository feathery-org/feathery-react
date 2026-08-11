// Adapter from the assistant's async tool contract to the single hardened
// SyncFusion operation engine used by the in-form DocumentEditorContainer.
import type { DocxBridge } from '../assistantToolDispatch';
import {
  applyDocumentEdits,
  deriveSectionPattern,
  findDocumentOccurrences,
  getDocumentInventory,
  setAssistantSessionActive
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
  getSectionPattern: async (input) => {
    const editor = getEditor();
    return editor
      ? deriveSectionPattern(editor, input ?? {})
      : unavailable('No in-form document editor is ready.');
  },
  applyDocumentEdits: async (input) => {
    const editor = getEditor();
    if (!editor) return unavailable('No in-form document editor is ready.');
    // First write of the turn: guard the rail through the turn's remaining
    // span — the gap before the next tool call is an LLM round-trip no
    // per-call flag can bridge. AssistantChat clears this at turn end, so
    // text-only turns (which never reach here) don't suppress real clicks.
    setAssistantSessionActive(editor, true);
    return applyDocumentEdits(editor, input ?? {});
  },
  findDocumentOccurrences: async (input) => {
    const editor = getEditor();
    return editor
      ? findDocumentOccurrences(editor, input ?? {})
      : unavailable('No in-form document editor is ready.');
  }
});

export { readSelection as readDocxSelection } from './syncfusionDocumentOps';
export { setAssistantSessionActive } from './syncfusionDocumentOps';
