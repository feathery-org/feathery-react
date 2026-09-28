// Debounced autosave for the docx editor. Mirrors the document-index sync shape
// in assistant/tools/docx/documentIndex.ts: one save in flight at a time, a
// coalesced re-run when edits land mid-save, an idle debounce with a hard
// ceiling so a stream of edits still saves, and exponential backoff on failure.
//
// Timers and the clock are injectable so every rule is unit-testable without
// real time. `canSave` is the gate: when it is false a due save is skipped and
// reported 'blocked' rather than fired (the binding soft-gate, an open document,
// or an assistant write batch).
import { SaveStatus } from './types';
import {
  canRetryDocumentError,
  DocumentPersistenceError
} from '../../../../utils/documentPersistence';

export const AUTOSAVE_IDLE_MS = 3000;
export const AUTOSAVE_MAX_INTERVAL_MS = 20000;
export const AUTOSAVE_BACKOFF_MS = [5000, 15000, 45000];

type TimerId = ReturnType<typeof setTimeout>;

export interface AutosaveSchedulerOptions {
  save: () => Promise<void>;
  canSave: () => boolean;
  onStatus?: (status: SaveStatus) => void;
  idleMs?: number;
  maxIntervalMs?: number;
  backoffMs?: number[];
  maxAttempts?: number;
  onError?: (error: unknown) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerId;
  clearTimer?: (id: TimerId) => void;
}

export interface AutosaveScheduler {
  /** An edit happened; (re)arm the debounce. */
  touch(): void;
  /** Save now (explicit Save / session close). Resolves when the save the caller
   *  triggered has settled; rejects if blocked or cancelled. */
  flush(): Promise<void>;
  status(): SaveStatus;
  /** Stop all timers (unmount). */
  cancel(): void;
  /** Resume after the user has addressed an error. */
  retry(): void;
}

export function createAutosaveScheduler(
  options: AutosaveSchedulerOptions
): AutosaveScheduler {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));
  const idleMs = options.idleMs ?? AUTOSAVE_IDLE_MS;
  const maxIntervalMs = options.maxIntervalMs ?? AUTOSAVE_MAX_INTERVAL_MS;
  const backoff = options.backoffMs ?? AUTOSAVE_BACKOFF_MS;

  let status: SaveStatus = 'clean';
  let dirty = false;
  let firstPendingAt: number | null = null;
  let lastEditAt = 0;
  let inFlight = false;
  let coalesced = false; // edits arrived while a save was running
  let attempt = 0; // backoff index after failures
  let timer: TimerId | null = null;
  let paused = false;
  let halted = false;
  let generation = 0;
  // Resolvers for flush() callers waiting on the current save to settle.
  let waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];

  const setStatus = (next: SaveStatus) => {
    if (next === status) return;
    status = next;
    options.onStatus?.(next);
  };

  const clearArm = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const arm = (delay: number) => {
    if (paused) return;
    clearArm();
    timer = setTimer(() => {
      timer = null;
      runSave();
    }, Math.max(0, delay));
  };

  const armDebounced = () => {
    if (inFlight || firstPendingAt === null) return;
    const idleTarget = lastEditAt + idleMs;
    const ceiling = firstPendingAt + maxIntervalMs;
    arm(Math.min(idleTarget, ceiling) - now());
  };

  const settleWaiters = (error?: unknown) => {
    const pending = waiters;
    waiters = [];
    pending.forEach(({ resolve, reject }) =>
      error ? reject(error) : resolve()
    );
  };

  const runSave = () => {
    if (inFlight) {
      coalesced = true;
      return;
    }
    if (!dirty) {
      settleWaiters();
      return;
    }
    if (!options.canSave()) {
      setStatus('blocked');
      // Retry once the gate is likely clear; a later touch() re-arms sooner.
      arm(idleMs);
      settleWaiters(
        new DocumentPersistenceError(
          'Document save is blocked. Finish the current edit and retry.',
          'blocked'
        )
      );
      return;
    }

    inFlight = true;
    const startedGeneration = generation;
    coalesced = false;
    dirty = false;
    firstPendingAt = null;
    setStatus('saving');

    options
      .save()
      .then(() => {
        inFlight = false;
        if (paused || startedGeneration !== generation) {
          if (!paused) armDebounced();
          return;
        }
        attempt = 0;
        if (coalesced || dirty) {
          coalesced = false;
          dirty = true;
          setStatus('dirty');
          armDebounced();
        } else {
          setStatus('saved');
        }
        settleWaiters();
      })
      .catch((error) => {
        inFlight = false;
        if (paused || startedGeneration !== generation) {
          if (!paused) armDebounced();
          return;
        }
        dirty = true; // still unsaved; retry with backoff
        setStatus('error');
        attempt += 1;
        halted =
          !canRetryDocumentError(error) ||
          attempt >= (options.maxAttempts ?? 4);
        if (!halted) {
          const retryAfter =
            (error as { retryAfterMs?: number })?.retryAfterMs ?? 0;
          arm(
            Math.max(
              retryAfter,
              backoff[Math.min(attempt - 1, backoff.length - 1)]
            )
          );
        }
        options.onError?.(error);
        settleWaiters(error);
      });
  };

  return {
    touch() {
      paused = false;
      const at = now();
      lastEditAt = at;
      if (firstPendingAt === null) firstPendingAt = at;
      dirty = true;
      if (!halted) {
        if (!inFlight) setStatus('dirty');
        armDebounced();
      }
    },
    flush() {
      if (paused && !dirty) return Promise.resolve();
      paused = false;
      halted = false;
      attempt = 0;
      clearArm();
      if (inFlight) {
        // A save is running; wait for it, then let its coalesced re-run persist
        // the newer edits.
        return new Promise<void>((resolve, reject) =>
          waiters.push({ resolve, reject })
        );
      }
      if (!dirty) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.push({ resolve, reject });
        runSave();
      });
    },
    status() {
      return status;
    },
    cancel() {
      paused = true;
      generation++;
      dirty = false;
      firstPendingAt = null;
      halted = false;
      attempt = 0;
      clearArm();
      settleWaiters(
        new DocumentPersistenceError('Document save was cancelled', 'cancelled')
      );
    },
    retry() {
      paused = false;
      halted = false;
      attempt = 0;
      if (dirty) arm(0);
    }
  };
}
