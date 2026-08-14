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
import { reconcileBoundDocument } from '../../../elements/components/DocxEditor/bindings/reconcileRegistry';

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
    const result = await applyDocumentEdits(editor, input ?? {});
    // These edits are user-origin as far as bindings are concerned, and some of
    // them - an inserted row above all - change what formulas depend on. Settle
    // the document now rather than leaving it inconsistent until the user's next
    // commit. A no-op when the document has no bindings.
    reconcileBoundDocument(editor);
    return result;
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
