// Robin's document engine for a mounted editor: one session per opened document, mounted under
// the form instance so the form's `liveDocument` accessor reaches it.
import {
  lazySession,
  mountDocument,
  registerCardResolver,
  registerHistoryRoute
} from '../../../robin/document/mounts';
import {
  DocumentSession,
  newEditorId,
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
  envelopeId: string,
  editorId?: string
): DocumentSession {
  return new DocumentSession({
    pack: docxPack,
    host: createHost(editor),
    target: { type: 'envelope', id: envelopeId },
    ...(editorId ? { editorId } : {}),
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
 * Mount an opened document for Robin. Nothing is read until Robin first uses it: the session is
 * created on the first liveDocument read or request, or when the rail asks the engine about one of
 * Robin's cards (so a reloaded document's engine-owned cards are still resolved by the engine).
 * Undo and redo are routed through the engine once the session exists. Returns the unmount, which
 * also ends any editing turn so the rail stops treating selection moves as Robin's.
 */
export function mountRobinDocument({
  formKey,
  slot,
  editor,
  envelopeId
}: RobinDocumentMount): () => void {
  let unroute = () => {};
  const mounted = lazySession(newEditorId(), (editorId) => {
    const session = createRobinSession(editor, envelopeId, editorId);
    // undo and redo go to the editor when it has an entry, else to the engine (decision D4)
    unroute = registerHistoryRoute(editor, {
      undo: () => session.undo(),
      redo: () => session.redo()
    });
    return session;
  });
  const unmount = mountDocument(formKey, slot, mounted);
  // the rail asks the engine first about Robin's cards, for the ones it must resolve itself
  const unregister = registerCardResolver(editor, {
    owns: (changeSetId) => !!mounted.get()?.ownsCard(changeSetId),
    resolve: (changeSetId, accept) =>
      !!mounted.get()?.resolveCard(changeSetId, accept)
  });
  return () => {
    unroute();
    unregister();
    unmount();
    mounted.peek()?.finishTurn();
  };
}
