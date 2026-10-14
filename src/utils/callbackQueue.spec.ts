import CallbackQueue from './callbackQueue';
import { featheryWindow } from './browser';

const newQueue = () => new CallbackQueue({ buttons: [] }, jest.fn());

describe('CallbackQueue', () => {
  // addCallback rethrows each rejection as an uncaught error, as the page sees it
  let uncaught: unknown[];
  const onError = (event: ErrorEvent) => {
    uncaught.push(event.error);
    event.preventDefault();
  };
  const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));
  beforeEach(() => {
    uncaught = [];
    featheryWindow().addEventListener('error', onError);
  });
  afterEach(async () => {
    await nextTask();
    featheryWindow().removeEventListener('error', onError);
  });

  it('rethrows a rejection so a throwing rule still reaches the console and Sentry', async () => {
    const error = new Error('rule threw');
    newQueue().addCallback(Promise.reject(error));

    // The rethrow is scheduled once the rejection handler has run
    await Promise.resolve();
    await nextTask();

    expect(uncaught).toEqual([error]);
  });

  it('drops a rejected promise once it settles, so the queue drains and a later all() resolves', async () => {
    const cq = newQueue();
    cq.addCallback(Promise.reject(new Error('boom')));
    expect(cq.awaiting).toBe(true);

    // addCallback's own rejection handler was attached before this call,
    // so by the time this settles the rejection has already been forgotten.
    await cq.all().catch(() => undefined);

    expect(cq.queue).toHaveLength(0);
    for (let i = 0; i < 10 && cq.awaiting; i++) {
      await Promise.resolve();
    }
    expect(cq.awaiting).toBe(false);
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
});
