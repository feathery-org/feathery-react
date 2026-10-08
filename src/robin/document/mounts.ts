/**
 * Mounted documents, keyed by form instance: what the form's document accessor reads.
 *
 * A mounted editor registers its session under the form instance it renders in and a slot (the
 * schema container id), and unregisters with the function `mountDocument` returns. One form may
 * mount several editors; the descriptor names one of them, the one in the lexically first slot, so
 * the choice follows the schema and not mount order. `dispatch` routes by the payload's editor id,
 * so a request reaches the editor it was made for or fails as `wrong-editor`.
 */
import { Descriptor, Selection, parseBridgePayload } from './envelope';
import type { DispatchOutcome, DocumentSession } from './session';

interface Slot {
  slot: string;
  session: DocumentSession;
}

const forms = new Map<string, Map<string, Slot>>();

/** Register a session; returns the unregister function, which removes only this registration. */
export function mountDocument(
  formKey: string,
  slot: string,
  session: DocumentSession
): () => void {
  let slots = forms.get(formKey);
  if (!slots) {
    slots = new Map();
    forms.set(formKey, slots);
  }
  const entry = { slot, session };
  slots.set(slot, entry);
  return () => {
    const current = forms.get(formKey);
    if (current?.get(slot) !== entry) return;
    current.delete(slot);
    if (!current.size) forms.delete(formKey);
  };
}

/** The sessions mounted in a form, the descriptor's first. */
export function mountedDocuments(formKey: string): DocumentSession[] {
  return [...(forms.get(formKey)?.values() ?? [])]
    .sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0))
    .map((s) => s.session);
}

export interface LiveDocumentAccessor {
  /** Section 9: what the form sends as `context.liveDocument`; null when no document is mounted. */
  descriptor(selection?: Selection): Descriptor | null;
  /** Section 10: one bridge payload in, the bridge response or a dispatch failure out. */
  dispatch(payload: unknown): DispatchOutcome;
  /** The form's Robin turn settled: every mounted document ends its editing turn. */
  finishTurn(): void;
}

export function liveDocumentAccessor(formKey: string): LiveDocumentAccessor {
  return {
    descriptor(selection) {
      const [first] = mountedDocuments(formKey);
      return first ? first.descriptor(selection) : null;
    },
    dispatch(payload) {
      const sessions = mountedDocuments(formKey);
      const editorId =
        payload && typeof payload === 'object'
          ? (payload as { editorId?: unknown }).editorId
          : undefined;
      const session = sessions.find((s) => s.editorId === editorId);
      if (session) return session.dispatch(payload);
      const parsed = parseBridgePayload(payload);
      if (!parsed.ok) return { status: 'error', failure: parsed.failure };
      return {
        status: 'error',
        failure: {
          reason: 'wrong-editor',
          message: sessions.length
            ? 'The request named an editor that is not mounted in this form.'
            : 'No document editor is mounted in this form.'
        }
      };
    },
    finishTurn() {
      for (const session of mountedDocuments(formKey)) session.finishTurn();
    }
  };
}
