// Robin's document engine for a mounted editor: one session per opened document, mounted under
// the form instance so the form's `liveDocument` accessor reaches it.
import {
  journalFor,
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
import { settleTurnWhenIdle } from './robinTurnGuard';

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
  editorId?: string,
  journal?: SessionOptions['journal'],
  onActivity?: () => void
): DocumentSession {
  return new DocumentSession({
    pack: docxPack,
    host: createHost(editor),
    target: { type: 'envelope', id: envelopeId },
    ...(editorId ? { editorId } : {}),
    ...(journal ? { journal } : {}),
    ...robinMarks(editor, onActivity)
  });
}

/**
 * The session options that put Robin's marks on the editor and report replaced documents;
 * `onActivity` hears each turn start and each write.
 */
export function robinMarks(
  editor: LiveEditor,
  onActivity?: () => void
): Pick<SessionOptions, 'onTurnChange' | 'writing' | 'onReplaced'> {
  return {
    onTurnChange: (turnId) => {
      setRobinTurnActive(editor, turnId !== null);
      if (turnId !== null) onActivity?.();
    },
    writing: (commit) => {
      const out = whileRobinWrites(editor, commit);
      onActivity?.();
      return out;
    },
    onReplaced: () => documentReplaced(editor)
  };
}

/**
 * Mount an opened document for Robin, on a form whose Robin root is mounted: the session is
 * created at once (one read of the document), so it owns its cards from the start, a reloaded
 * document's engine-owned cards included. Undo and redo are routed through the engine. A session
 * that cannot be created leaves the document unmounted for Robin and is tried again on first use.
 * Returns the unmount, which also ends any editing turn so the rail stops treating selection moves
 * as Robin's.
 */
export function mountRobinDocument({
  formKey,
  slot,
  editor,
  envelopeId
}: RobinDocumentMount): () => void {
  let unroute = () => {};
  let guard: { activity(): void; dispose(): void } | null = null;
  const mounted = lazySession(newEditorId(), (editorId) => {
    // the form session's journal: a resent write finds its record after a remount
    const session = createRobinSession(
      editor,
      envelopeId,
      editorId,
      journalFor(formKey),
      () => guard?.activity()
    );
    // the turn mark clears itself if the form's settle signal never comes
    guard = settleTurnWhenIdle(editor, session);
    // undo and redo go to the editor when it has an entry, else to the engine (decision D4)
    unroute = registerHistoryRoute(editor, {
      undo: () => session.undo(),
      redo: () => session.redo(),
      engineHas: (direction) => session.history.depth[direction] > 0
    });
    return session;
  });
  const unmount = mountDocument(formKey, slot, mounted);
  // created at open, where Robin is: the rail asking about a card never builds it mid-keystroke
  mounted.get();
  // the rail asks the engine first about Robin's cards, for the ones it must resolve itself
  const unregister = registerCardResolver(editor, {
    owns: (changeSetId) => !!mounted.get()?.ownsCard(changeSetId),
    resolve: (changeSetId, accept) =>
      !!mounted.get()?.resolveCard(changeSetId, accept),
    settle: (resolve) => {
      const session = mounted.get();
      return session ? session.settle(resolve) : resolve();
    }
  });
  return () => {
    guard?.dispose();
    unroute();
    unregister();
    unmount();
    mounted.peek()?.finishTurn();
  };
}
