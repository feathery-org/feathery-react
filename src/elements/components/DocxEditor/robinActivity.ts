// Robin's activity on a mounted document editor, for the parts of the editor that must tell
// Robin's changes from the person's: the review rail and the section panel (is Robin editing?),
// and version history (was this change Robin's?).
const WRITING_KEY = '__featheryAssistantWriting';
const TURN_KEY = '__featheryAssistantSession';
const TURN_LISTENERS_KEY = '__featheryAssistantSessionListeners';
const REPLACED_LISTENERS_KEY = '__featheryRobinReplacedListeners';
const WRITE_START_LISTENERS_KEY = '__featheryRobinWriteStartListeners';

type Marked = Record<string, any>;
type Listener<A extends unknown[]> = (...args: A) => void;

/** Robin is writing to the document right now: the editor's change events are Robin's. */
export function isRobinWriting(editor: unknown): boolean {
  return !!(editor as Marked | null | undefined)?.[WRITING_KEY];
}

/**
 * Robin is editing this document: writing right now, or inside an editing turn (between its
 * writes, while the person may also type).
 */
export function isRobinEditing(editor: unknown): boolean {
  const ed = editor as Marked | null | undefined;
  return !!ed?.[WRITING_KEY] || !!ed?.[TURN_KEY];
}

/**
 * Run `write` with the editor marked as Robin writing; the previous mark is put back after. Write
 * start listeners hear it first, while the document is still the one before Robin's change.
 */
export function whileRobinWrites<T>(editor: unknown, write: () => T): T {
  const ed = editor as Marked | null | undefined;
  if (!ed) return write();
  const previous = ed[WRITING_KEY];
  if (!previous) {
    const listeners: Set<Listener<[]>> | undefined =
      ed[WRITE_START_LISTENERS_KEY];
    listeners?.forEach((cb) => {
      try {
        cb();
      } catch {
        // A listener must never stop Robin's write.
      }
    });
  }
  ed[WRITING_KEY] = true;
  try {
    return write();
  } finally {
    ed[WRITING_KEY] = previous;
  }
}

function listenersOf<A extends unknown[]>(
  ed: Marked,
  key: string
): Set<Listener<A>> {
  return (ed[key] ??= new Set<Listener<A>>());
}

/** Robin's editing turn on this editor started (true) or settled (false). Edge-only. */
export function setRobinTurnActive(editor: unknown, active: boolean): void {
  const ed = editor as Marked | null | undefined;
  if (!ed) return;
  const next = !!active;
  if (!!ed[TURN_KEY] === next) return;
  ed[TURN_KEY] = next;
  const listeners: Set<Listener<[boolean]>> | undefined =
    ed[TURN_LISTENERS_KEY];
  listeners?.forEach((cb) => cb(next));
}

/** Hear Robin's turn starting and settling on this editor (edges only). Returns the unsubscribe. */
export function onRobinTurnChange(
  editor: unknown,
  cb: (active: boolean) => void
): () => void {
  const ed = editor as Marked | null | undefined;
  if (!ed) return () => undefined;
  const listeners = listenersOf<[boolean]>(ed, TURN_LISTENERS_KEY);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Hear Robin about to write to the document, before its change lands. Returns the unsubscribe. */
export function onRobinWriteStart(editor: unknown, cb: () => void): () => void {
  const ed = editor as Marked | null | undefined;
  if (!ed) return () => undefined;
  const listeners = listenersOf<[]>(ed, WRITE_START_LISTENERS_KEY);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * The document was replaced whole (a structural write, a card resolved, an undo through Robin's
 * history). Opening a document fires no change event in the editor, so whoever replaced it says
 * so here, and the editor's change handling runs as it does for any edit.
 */
export function documentReplaced(editor: unknown): void {
  const ed = editor as Marked | null | undefined;
  const listeners: Set<Listener<[]>> | undefined = ed?.[REPLACED_LISTENERS_KEY];
  listeners?.forEach((cb) => cb());
}

/** Hear the document being replaced whole. Returns the unsubscribe. */
export function onDocumentReplaced(
  editor: unknown,
  cb: () => void
): () => void {
  const ed = editor as Marked | null | undefined;
  if (!ed) return () => undefined;
  const listeners = listenersOf<[]>(ed, REPLACED_LISTENERS_KEY);
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
