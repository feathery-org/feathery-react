import {
  createAutosaveScheduler,
  AUTOSAVE_IDLE_MS,
  AUTOSAVE_MAX_INTERVAL_MS,
  AUTOSAVE_BACKOFF_MS
} from './autosaveScheduler';

// A manual timer queue + clock so idle/ceiling/backoff are exact and no real
// time passes. advance() fires due timers in order and drains microtasks after
// each, so the async save chain settles deterministically.
function makeClock() {
  let t = 0;
  let seq = 1;
  let timers: Array<{ id: number; fireAt: number; fn: () => void }> = [];
  const drain = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  };
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = seq++;
      timers.push({ id, fireAt: t + ms, fn });
      return id as any;
    },
    clearTimer: (id: any) => {
      timers = timers.filter((x) => x.id !== id);
    },
    async advance(ms: number) {
      const target = t + ms;
      for (;;) {
        const due = timers
          .filter((x) => x.fireAt <= target)
          .sort((a, b) => a.fireAt - b.fireAt);
        if (!due.length) break;
        const next = due[0];
        timers = timers.filter((x) => x.id !== next.id);
        t = next.fireAt;
        next.fn();
        await drain();
      }
      t = target;
    },
    drain
  };
}

function deferred() {
  let resolveFn!: () => void;
  let rejectFn!: (e?: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

describe('createAutosaveScheduler', () => {
  it('ignores a cancelled request failure after a new session resumes', async () => {
    const clock = makeClock();
    const old = deferred();
    const onError = jest.fn();
    const save = jest
      .fn()
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(undefined);
    const scheduler = createAutosaveScheduler({
      save,
      onError,
      canSave: () => true,
      ...clock
    });
    scheduler.touch();
    await clock.advance(AUTOSAVE_IDLE_MS);
    scheduler.cancel();
    scheduler.touch();
    old.reject(new Error('old document failed'));
    await clock.drain();
    await clock.advance(AUTOSAVE_IDLE_MS);
    expect(onError).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('stops transient retries after the ceiling and resumes only on explicit retry', async () => {
    const clock = makeClock();
    const save = jest.fn().mockRejectedValue(new Error('offline'));
    const scheduler = createAutosaveScheduler({
      save,
      canSave: () => true,
      maxAttempts: 3,
      ...clock
    });
    scheduler.touch();
    await clock.advance(200_000);
    scheduler.touch();
    await clock.advance(200_000);
    expect(save).toHaveBeenCalledTimes(3);
    save.mockResolvedValue(undefined);
    scheduler.retry();
    await clock.advance(0);
    expect(save).toHaveBeenCalledTimes(4);
    expect(scheduler.status()).toBe('saved');
  });
  it('rejects a blocked explicit flush instead of leaving its caller waiting', async () => {
    const clock = makeClock();
    const scheduler = createAutosaveScheduler({
      save: async () => undefined,
      canSave: () => false,
      ...clock
    });
    scheduler.touch();
    let outcome = 'waiting';
    scheduler.flush().then(
      () => {
        outcome = 'saved';
      },
      () => {
        outcome = 'blocked';
      }
    );
    await clock.drain();
    expect(outcome).toBe('blocked');
    expect(scheduler.status()).toBe('blocked');
    scheduler.cancel();
  });

  it('saves after the idle window, not before', async () => {
    const clock = makeClock();
    const save = jest.fn().mockResolvedValue(undefined);
    const s = createAutosaveScheduler({
      save,
      canSave: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    s.touch();
    await clock.advance(AUTOSAVE_IDLE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    expect(s.status()).toBe('dirty');

    await clock.advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('saved');
  });

  it('cancellation releases a pending flush and prevents a late failure retry', async () => {
    const clock = makeClock();
    const request = deferred();
    const save = jest.fn(() => request.promise);
    const scheduler = createAutosaveScheduler({
      save,
      canSave: () => true,
      ...clock
    });
    scheduler.touch();
    let outcome = 'waiting';
    scheduler.flush().then(
      () => {
        outcome = 'saved';
      },
      () => {
        outcome = 'cancelled';
      }
    );
    scheduler.cancel();
    await clock.drain();
    expect(outcome).toBe('cancelled');
    request.reject(new Error('offline'));
    await clock.drain();
    await clock.advance(100_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('resets the idle window on each edit but saves by the max interval', async () => {
    const clock = makeClock();
    const save = jest.fn().mockResolvedValue(undefined);
    const s = createAutosaveScheduler({
      save,
      canSave: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    // An edit every 2s keeps the 3s idle window from ever elapsing...
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_INTERVAL_MS; elapsed += 2000) {
      s.touch();
      await clock.advance(2000);
    }
    // ...but the 20s ceiling forces exactly one save.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces edits that land during an in-flight save into one more save', async () => {
    const clock = makeClock();
    const gate = deferred();
    const save = jest
      .fn()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValue(undefined);
    const s = createAutosaveScheduler({
      save,
      canSave: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    s.touch();
    await clock.advance(AUTOSAVE_IDLE_MS); // first save starts, now in flight
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('saving');

    s.touch(); // edit during the in-flight save
    gate.resolve(); // first save finishes
    await clock.drain();
    expect(s.status()).toBe('dirty'); // re-armed for the coalesced edit

    await clock.advance(AUTOSAVE_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('reports blocked and does not save while the gate is closed', async () => {
    const clock = makeClock();
    const save = jest.fn().mockResolvedValue(undefined);
    let allowed = false;
    const s = createAutosaveScheduler({
      save,
      canSave: () => allowed,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    s.touch();
    await clock.advance(AUTOSAVE_IDLE_MS);
    expect(save).not.toHaveBeenCalled();
    expect(s.status()).toBe('blocked');

    allowed = true;
    await clock.advance(AUTOSAVE_IDLE_MS); // the blocked retry fires
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('saved');
  });

  it('retries with backoff after a failure', async () => {
    const clock = makeClock();
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const s = createAutosaveScheduler({
      save,
      canSave: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    s.touch();
    await clock.advance(AUTOSAVE_IDLE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('error');

    // Nothing before the first backoff step; the retry succeeds after it.
    await clock.advance(AUTOSAVE_BACKOFF_MS[0] - 1);
    expect(save).toHaveBeenCalledTimes(1);
    await clock.advance(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(s.status()).toBe('saved');
  });

  it('does not retry a permanent server rejection', async () => {
    const clock = makeClock();
    const save = jest.fn().mockRejectedValue(
      Object.assign(new Error('Session is no longer current'), {
        status: 400
      })
    );
    const scheduler = createAutosaveScheduler({
      save,
      canSave: () => true,
      ...clock
    });
    scheduler.touch();
    await clock.advance(200_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(scheduler.status()).toBe('error');
    scheduler.cancel();
  });

  it('flush saves immediately and resolves when the save settles', async () => {
    const clock = makeClock();
    const save = jest.fn().mockResolvedValue(undefined);
    const s = createAutosaveScheduler({
      save,
      canSave: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    s.touch();
    await s.flush(); // no waiting for the idle window
    expect(save).toHaveBeenCalledTimes(1);
    expect(s.status()).toBe('saved');
  });

  it('flush on a clean scheduler resolves without saving', async () => {
    const clock = makeClock();
    const save = jest.fn().mockResolvedValue(undefined);
    const s = createAutosaveScheduler({
      save,
      canSave: () => true,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer
    });

    await s.flush();
    expect(save).not.toHaveBeenCalled();
    expect(s.status()).toBe('clean');
  });
});
