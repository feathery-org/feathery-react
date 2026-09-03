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
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerId;
  clearTimer?: (id: TimerId) => void;
}

export interface AutosaveScheduler {
  /** An edit happened; (re)arm the debounce. */
  touch(): void;
  /** Save now (explicit Save / session close). Resolves when the save the caller
   *  triggered has settled; a no-op resolve when the gate is blocked or clean. */
  flush(): Promise<void>;
  status(): SaveStatus;
  /** Stop all timers (unmount). */
  cancel(): void;
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
  // Resolvers for flush() callers waiting on the current save to settle.
  let waiters: Array<() => void> = [];

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

  const settleWaiters = () => {
    const pending = waiters;
    waiters = [];
    pending.forEach((resolve) => resolve());
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
      return;
    }

    inFlight = true;
    coalesced = false;
    dirty = false;
    firstPendingAt = null;
    setStatus('saving');

    options
      .save()
      .then(() => {
        inFlight = false;
        attempt = 0;
        if (coalesced || dirty) {
          coalesced = false;
          dirty = true;
          setStatus('dirty');
          armDebounced();
        } else {
          setStatus('saved');
        }
      })
      .catch(() => {
        inFlight = false;
        dirty = true; // still unsaved; retry with backoff
        setStatus('error');
        arm(backoff[Math.min(attempt, backoff.length - 1)]);
        attempt += 1;
      })
      .finally(settleWaiters);
  };

  return {
    touch() {
      const at = now();
      lastEditAt = at;
      if (firstPendingAt === null) firstPendingAt = at;
      dirty = true;
      if (!inFlight) setStatus('dirty');
      armDebounced();
    },
    flush() {
      clearArm();
      if (inFlight) {
        // A save is running; wait for it, then let its coalesced re-run persist
        // the newer edits.
        return new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (!dirty) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        runSave();
      });
    },
    status() {
      return status;
    },
    cancel() {
      clearArm();
    }
  };
}
