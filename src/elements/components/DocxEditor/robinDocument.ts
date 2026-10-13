// Robin's document engine for a mounted editor: one session per opened document, mounted under
// the form instance so the form's `liveDocument` accessor reaches it.
import {
  mountDocument,
  registerCardResolver,
  registerHistoryRoute
} from '../../../robin/document/mounts';
import {
  DocumentSession,
  SessionOptions
} from '../../../robin/document/session';
import {
  createHost,
  docxPack,
  LiveEditor
} from '../../../robin/document/formats/docx-sfdt';
import {
  documentReplaced,
  setRobinTurnActive,
  whileRobinWrites
} from './robinActivity';

export interface RobinDocumentMount {
  /** The form instance the editor renders in: the key the form context reads by. */
  formKey: string;
  /** The schema container id; with several editors in a form, the first slot is the one described. */
  slot: string;
  editor: LiveEditor;
  envelopeId: string;
}

/**
 * The engine session over an opened document, wired to the editor as the product mounts it: its
 * turn and its writes carry Robin's marks, so the rail tells Robin's changes from the person's and
 * version history attributes them; a document it replaces whole is reported as an edit.
 */
export function createRobinSession(
  editor: LiveEditor,
  envelopeId: string
): DocumentSession {
  return new DocumentSession({
    pack: docxPack,
    host: createHost(editor),
    target: { type: 'envelope', id: envelopeId },
    ...robinMarks(editor)
  });
}

/** The session options that put Robin's marks on the editor and report replaced documents. */
export function robinMarks(
  editor: LiveEditor
): Pick<SessionOptions, 'onTurnChange' | 'writing' | 'onReplaced'> {
  return {
    onTurnChange: (turnId) => setRobinTurnActive(editor, turnId !== null),
    writing: (commit) => whileRobinWrites(editor, commit),
    onReplaced: () => documentReplaced(editor)
  };
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
    session = createRobinSession(editor, envelopeId);
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
  // undo and redo go to the editor when it has an entry, else to the engine (decision D4)
  const unroute = registerHistoryRoute(editor, {
    undo: () => session.undo(),
    redo: () => session.redo()
  });
  return () => {
    unroute();
    unregister();
    unmount();
    session.finishTurn();
  };
}
