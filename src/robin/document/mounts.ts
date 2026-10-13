/**
 * Mounted documents, keyed by form instance: what the form's document accessor reads.
 *
 * A mounted editor registers its session under the form instance it renders in and a slot (the
 * schema container id), and unregisters with the function `mountDocument` returns. One form may
 * mount several editors; the descriptor names one of them, the one in the lexically first slot, so
 * the choice follows the schema and not mount order. `dispatch` routes by the payload's editor id,
 * so a request reaches the editor it was made for or fails as `wrong-editor`.
 *
 * A mounted document's session may be created on first use (`lazySession`): mounting an editor
 * costs nothing where Robin never runs, and the session reads the document when Robin first asks.
 */
import {
  Descriptor,
  DispatchOutcome,
  Selection,
  Verb,
  VerbResult,
  WriteInput,
  dispatchFailure,
  parseBridgePayload,
  parseVerbInput
} from './envelope';
import { WriteJournal } from './loop';
import { DocumentSession } from './session';

/** A mounted document's session, created when first used. */
export interface MountedSession {
  readonly editorId: string;
  /** The session, created now if it was not yet; null when it cannot be created. */
  get(): DocumentSession | null;
  /** The session if it was created. */
  peek(): DocumentSession | null;
}

/**
 * A session created by `create` the first time it is used. A creation that throws leaves the
 * document unmounted for Robin (and is tried again on the next use): the engine must never break
 * the editor it serves.
 */
export function lazySession(
  editorId: string,
  create: (editorId: string) => DocumentSession
): MountedSession {
  let session: DocumentSession | null = null;
  return {
    editorId,
    get() {
      if (!session)
        try {
          session = create(editorId);
        } catch (error) {
          console.debug('Feathery: Robin document session unavailable.', error);
          return null;
        }
      return session;
    },
    peek: () => session
  };
}

const created = (session: DocumentSession): MountedSession => ({
  editorId: session.editorId,
  get: () => session,
  peek: () => session
});

interface Slot {
  slot: string;
  session: MountedSession;
}

const forms = new Map<string, Map<string, Slot>>();

/** Register a session; returns the unregister function, which removes only this registration. */
export function mountDocument(
  formKey: string,
  slot: string,
  session: DocumentSession | MountedSession
): () => void {
  let slots = forms.get(formKey);
  if (!slots) {
    slots = new Map();
    forms.set(formKey, slots);
  }
  const entry = {
    slot,
    session: session instanceof DocumentSession ? created(session) : session
  };
  slots.set(slot, entry);
  return () => {
    const current = forms.get(formKey);
    if (current?.get(slot) !== entry) return;
    current.delete(slot);
    if (!current.size) forms.delete(formKey);
  };
}

/** The documents mounted in a form, the descriptor's first. */
function slotsOf(formKey: string): MountedSession[] {
  return [...(forms.get(formKey)?.values() ?? [])]
    .sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0))
    .map((s) => s.session);
}

/** The sessions mounted in a form, the descriptor's first; creates any not yet created. */
export function mountedDocuments(formKey: string): DocumentSession[] {
  return slotsOf(formKey)
    .map((s) => s.get())
    .filter((s): s is DocumentSession => s !== null);
}

/** One document action: its payload in (section 10.1), its outcome out (section 10.2). */
export type DocumentAction = (payload: unknown) => DispatchOutcome;

export interface LiveDocumentAccessor {
  /** Section 9: what the form sends as `context.liveDocument`; null when no document is mounted. */
  descriptor(selection?: Selection): Descriptor | null;
  /** Section 10: the four document actions, `document_outline` to `document_write`. */
  outline: DocumentAction;
  read: DocumentAction;
  find: DocumentAction;
  write: DocumentAction;
  /** The form's Robin turn settled: every mounted document ends its editing turn. */
  finishTurn(): void;
  /**
   * The business document type the mounted document's template declares, for the request context
   * beside the descriptor. Always null today: nothing the SDK loads carries it yet. It will come
   * from the document template's metadata (a declared type on the template the Generate Documents
   * action names), read here once the form schema delivers it.
   */
  documentType(): string | null;
}

const journals = new Map<string, WriteJournal<VerbResult>>();

/**
 * The form session's write journal (contract 10.3): every document session mounted in the form
 * shares it, so a resent write finds its record after the editor remounted.
 */
export function journalFor(formKey: string): WriteJournal<VerbResult> {
  let journal = journals.get(formKey);
  if (!journal) {
    journal = new WriteJournal<VerbResult>();
    journals.set(formKey, journal);
  }
  return journal;
}

/** A resent write the journal recorded, answered without an editor (it remounted since). */
function recordedWrite(formKey: string, raw: unknown): DispatchOutcome | null {
  const parsed = parseBridgePayload(raw);
  if (!parsed.ok) return null;
  const input = parseVerbInput('write', parsed.value.input);
  if (!input.ok) return null;
  const recorded = journals
    .get(formKey)
    ?.replay(parsed.value.turnId, input.value as WriteInput);
  if (!recorded) return null;
  return {
    status: 'ok',
    result: {
      ...recorded,
      editorId: parsed.value.editorId,
      target: { ...parsed.value.target },
      // a committed write's result carries the outline hash after it
      outlineHash: (recorded as { outlineHash: string }).outlineHash
    }
  };
}

export function liveDocumentAccessor(formKey: string): LiveDocumentAccessor {
  const action =
    (verb: Verb): DocumentAction =>
    (payload) => {
      const sessions = slotsOf(formKey);
      const editorId =
        payload && typeof payload === 'object'
          ? (payload as { editorId?: unknown }).editorId
          : undefined;
      const session = sessions.find((s) => s.editorId === editorId)?.get();
      if (session) return session.dispatch(verb, payload);
      const recorded =
        verb === 'write' ? recordedWrite(formKey, payload) : null;
      if (recorded) return recorded;
      if (!sessions.length)
        return dispatchFailure(
          'not-mounted',
          'No document editor is mounted in this form.'
        );
      const parsed = parseBridgePayload(payload);
      if (!parsed.ok) return parsed.failure;
      return dispatchFailure(
        'wrong-editor',
        'The request named an editor that is not mounted in this form.'
      );
    };
  return {
    descriptor(selection) {
      const [first] = slotsOf(formKey);
      return first?.get()?.descriptor(selection) ?? null;
    },
    outline: action('outline'),
    read: action('read'),
    find: action('find'),
    write: action('write'),
    finishTurn() {
      // a session not yet created has no turn to finish
      for (const session of slotsOf(formKey)) session.peek()?.finishTurn();
    },
    documentType() {
      return null;
    }
  };
}

/**
 * A review card the engine resolves itself (a structural card, or one the editor's own accept or
 * reject cannot settle), looked up by the editor the rail renders for: the rail asks first and
 * resolves natively only when the engine does not own the card.
 */
export interface CardResolver {
  owns(changeSetId: string): boolean;
  /** Accept or reject the card; true when it was resolved. */
  resolve(changeSetId: string, accept: boolean): boolean;
}

const resolvers = new WeakMap<object, CardResolver>();

/** Register the resolver for an editor; returns the unregister, which removes only this one. */
export function registerCardResolver(
  editor: object,
  resolver: CardResolver
): () => void {
  resolvers.set(editor, resolver);
  return () => {
    if (resolvers.get(editor) === resolver) resolvers.delete(editor);
  };
}

export function cardResolverFor(editor: unknown): CardResolver | undefined {
  return editor && typeof editor === 'object'
    ? resolvers.get(editor)
    : undefined;
}

/**
 * Undo and redo for an editor with a document session (decision D4): the editor's own entry when
 * it has one, else the engine's. The toolbar and Ctrl+Z / Ctrl+Y go through this when an editor
 * has one, and straight to the editor's history otherwise.
 */
export interface HistoryRoute {
  undo(): void;
  redo(): void;
  /**
   * Whether the engine holds an entry in that direction: the keyboard chord is taken from the
   * editor only then, so an editor whose history is all its own keeps its keys as they were.
   */
  engineHas(direction: 'undo' | 'redo'): boolean;
}

const routes = new WeakMap<object, HistoryRoute>();

export function registerHistoryRoute(
  editor: object,
  route: HistoryRoute
): () => void {
  routes.set(editor, route);
  return () => {
    if (routes.get(editor) === route) routes.delete(editor);
  };
}

export function historyRouteFor(editor: unknown): HistoryRoute | undefined {
  return editor && typeof editor === 'object' ? routes.get(editor) : undefined;
}
