import CallbackQueue from './callbackQueue';

const newQueue = () => new CallbackQueue({ buttons: [] }, jest.fn());

describe('CallbackQueue', () => {
  it('removes a rejected promise from the queue once it settles', async () => {
    const cq = newQueue();
    cq.addCallback(Promise.reject(new Error('boom')));

    // addCallback's own .then(forget, forget) was attached before this call,
    // so by the time this settles the rejection has already been forgotten.
    await cq.all().catch(() => undefined);

    expect(cq.queue).toHaveLength(0);
  });

  it('resolves a later all() instead of re-rejecting on a stale, already-forgotten failure', async () => {
    const cq = newQueue();
    cq.addCallback(Promise.reject(new Error('old failure')));
    await cq.all().catch(() => undefined);
    expect(cq.queue).toHaveLength(0);

    await expect(cq.all()).resolves.toEqual([]);
  });

  it('still fails all() for a new promise added after an old, already-settled rejection', async () => {
    const cq = newQueue();
    cq.addCallback(Promise.reject(new Error('old failure')));
    await cq.all().catch(() => undefined);

    let rejectNew: (err: Error) => void = () => undefined;
    const pending = new Promise<void>((resolve, reject) => {
      rejectNew = reject;
    });
    cq.addCallback(pending);

    const allPromise = cq.all();
    let settled = false;
    allPromise.then(
      () => (settled = true),
      () => (settled = true)
    );
    await Promise.resolve();
    await Promise.resolve();
    // Still in flight: the new promise hasn't settled yet.
    expect(settled).toBe(false);

    rejectNew(new Error('new failure'));
    await expect(allPromise).rejects.toThrow('new failure');
  });

  it('resets awaiting once the queue drains, even when a queued promise rejected', async () => {
    const cq = newQueue();
    cq.addCallback(Promise.reject(new Error('boom')));
    expect(cq.awaiting).toBe(true);

    for (let i = 0; i < 10 && cq.awaiting; i++) {
      await Promise.resolve();
    }

    expect(cq.awaiting).toBe(false);
  });
});
