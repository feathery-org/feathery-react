// Robin's document engine for a mounted editor: the docx pack registered once, and one session per
// opened document, mounted under the form instance so the form's `liveDocument` accessor reaches it.
import { setAssistantSessionActive } from '../../../assistant/tools/docx/syncfusionDocumentOps';
import {
  mountDocument,
  registerCardResolver
} from '../../../robin/document/mounts';
import { getPack, registerPack } from '../../../robin/document/pack';
import { DocumentSession } from '../../../robin/document/session';
import {
  createHost,
  docxPack,
  LiveEditor
} from '../../../robin/document/formats/docx-sfdt';

/** Register the docx pack; safe to call on every mount. */
export function ensureDocxPack(): void {
  if (getPack(docxPack.format) !== docxPack) registerPack(docxPack);
}

export interface RobinDocumentMount {
  /** The form instance the editor renders in: the key the form context reads by. */
  formKey: string;
  /** The schema container id; with several editors in a form, the first slot is the one described. */
  slot: string;
  editor: LiveEditor;
  envelopeId: string;
}

/**
 * Create the session for a just-opened document and mount it. Returns the unmount, which also
 * ends any editing turn so the rail stops treating selection moves as Robin's. Returns null when
 * the session cannot be created: the engine must never break the editor it serves.
 */
export function mountRobinDocument({
  formKey,
  slot,
  editor,
  envelopeId
}: RobinDocumentMount): (() => void) | null {
  let session: DocumentSession;
  try {
    ensureDocxPack();
    session = new DocumentSession({
      pack: docxPack,
      host: createHost(editor),
      target: { type: 'envelope', id: envelopeId },
      // The flag the rail and the section panel already read for "Robin is editing".
      onTurnChange: (turnId) =>
        setAssistantSessionActive(
          editor as unknown as Parameters<typeof setAssistantSessionActive>[0],
          turnId !== null
        )
    });
  } catch (error) {
    console.debug('Feathery: Robin document session unavailable.', error);
    return null;
  }
  const unmount = mountDocument(formKey, slot, session);
  // the rail asks the engine first for the cards it must resolve itself
  const unregister = registerCardResolver(editor, {
    owns: (changeSetId) => session.ownsCard(changeSetId),
    resolve: (changeSetId, accept) => session.resolveCard(changeSetId, accept)
  });
  return () => {
    unregister();
    unmount();
    session.finishTurn();
  };
}
