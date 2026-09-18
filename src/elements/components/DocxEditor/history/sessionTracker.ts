// A version is one editing session. This pure state machine decides where one
// session ends and the next begins, and when an author switch inside a session
// marks a slice boundary. It holds no editor and no timers of its own — the
// hook drives it (calling checkIdle on a timer) and injects the clock, so every
// rule here is unit-testable without a real editor.
import { v4 as uuidv4 } from 'uuid';

import { DocxSaveMeta, VersionAuthor } from './types';

/** A session closes after this long with no edits. */
export const SESSION_IDLE_MS = 300_000; // 5 minutes

export type CloseReason = 'idle' | 'turn_end' | 'explicit_save' | 'reset';

/** The fields the autosave PATCH carries to group its saves into one row. */
export interface SessionMeta {
  sessionId: string;
  sessionStartedAt: string; // ISO 8601
  authors: DocxSaveMeta['authors'];
}

export interface SessionTrackerOptions {
  now?: () => number;
  idleMs?: number;
  /** Post-edit observers must let checkIdle close before another edit lands. */
  closeIdleOnEdit?: boolean;
  /** The author whose slice just ended (an actor switch, before close). The
   *  hook serializes the document here and stores it as that author's slice. */
  onSliceBoundary?: (author: VersionAuthor) => void;
  /** A session ended; the hook flushes and closes it. Carries the closing
   *  session's meta (it is cleared internally first) and fires before the next
   *  session can start. */
  onClose?: (reason: CloseReason, meta: SessionMeta) => void;
}

export interface SessionTracker {
  noteEdit(actor: VersionAuthor): void;
  noteTurnEnd(): void;
  noteExplicitSave(): void;
  /** Close the session if it has gone idle. The hook calls this on a timer. */
  checkIdle(): void;
  reset(): void;
  isOpen(): boolean;
  currentMeta(): SessionMeta | null;
}

export function createSessionTracker(
  options: SessionTrackerOptions = {}
): SessionTracker {
  const now = options.now ?? Date.now;
  const idleMs = options.idleMs ?? SESSION_IDLE_MS;

  let sessionId: string | null = null;
  let startedAt = 0;
  let lastEditAt = 0;
  let currentAuthor: VersionAuthor | null = null;
  // Stable identities when supplied; legacy default actors retain their wire shape.
  let authors: DocxSaveMeta['authors'] = [];

  const recordAuthor = (actor: VersionAuthor) => {
    const entry = {
      kind: actor.kind,
      label: actor.label,
      ...(!['you', 'user', 'robin', 'assistant'].includes(actor.key)
        ? { key: actor.key }
        : {})
    };
    if (
      !authors.some(
        (a) =>
          a.kind === entry.kind &&
          (a.key ?? a.label) === (entry.key ?? entry.label)
      )
    )
      authors.push(entry);
  };

  const start = (actor: VersionAuthor, at: number) => {
    sessionId = uuidv4();
    startedAt = at;
    lastEditAt = at;
    currentAuthor = actor;
    authors = [];
    recordAuthor(actor);
  };

  const buildMeta = (): SessionMeta | null => {
    if (!sessionId) return null;
    return {
      sessionId,
      sessionStartedAt: new Date(startedAt).toISOString(),
      authors: [...authors]
    };
  };

  const close = (reason: CloseReason) => {
    const meta = buildMeta();
    if (!meta) return;
    sessionId = null;
    currentAuthor = null;
    authors = [];
    options.onClose?.(reason, meta);
  };

  return {
    noteEdit(actor) {
      const at = now();
      if (
        options.closeIdleOnEdit !== false &&
        sessionId &&
        at - lastEditAt >= idleMs
      )
        close('idle');
      if (!sessionId) {
        start(actor, at);
        return;
      }
      // An actor switch ends the outgoing author's slice at the current
      // document state before the incoming author's edits are attributed.
      if (currentAuthor && currentAuthor.key !== actor.key) {
        options.onSliceBoundary?.(currentAuthor);
        currentAuthor = actor;
      }
      recordAuthor(actor);
      lastEditAt = at;
    },
    noteTurnEnd() {
      close('turn_end');
    },
    noteExplicitSave() {
      close('explicit_save');
    },
    checkIdle() {
      if (sessionId && now() - lastEditAt >= idleMs) close('idle');
    },
    reset() {
      close('reset');
    },
    isOpen() {
      return sessionId !== null;
    },
    currentMeta() {
      return buildMeta();
    }
  };
}
