import { awaitClientQueues } from '../clientQueues';

const flushMicrotasks = async (times = 50) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

const makeClient = (overrides: Record<string, any> = {}) => ({
  submitQueue: Promise.resolve(),
  eventQueue: Promise.resolve(),
  whenUserEventsReplayed: () => Promise.resolve(),
  ...overrides
});

const deferred = () => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

const expectWaitsFor = async (client: any, release: () => void) => {
  let settled = false;
  const waiting = awaitClientQueues(client).then(() => {
    settled = true;
  });

  await flushMicrotasks();
  expect(settled).toBe(false);

  release();
  await waiting;
  expect(settled).toBe(true);
};

describe('awaitClientQueues', () => {
  it('waits on the eventQueue request', async () => {
    const event = deferred();
    await expectWaitsFor(
      makeClient({ eventQueue: event.promise }),
      event.resolve
    );
  });

  it('waits on the submitQueue request', async () => {
    const submit = deferred();
    await expectWaitsFor(
      makeClient({ submitQueue: submit.promise }),
      submit.resolve
    );
  });

  it('waits on events held for the first interaction to replay', async () => {
    const replay = deferred();
    await expectWaitsFor(
      makeClient({ whenUserEventsReplayed: () => replay.promise }),
      replay.resolve
    );
  });

  it.each(['eventQueue', 'submitQueue'])(
    'does not throw when the %s request rejects',
    async (queue) => {
      const rejected = Promise.reject(new Error('transient 5xx'));
      await expect(
        awaitClientQueues(makeClient({ [queue]: rejected }))
      ).resolves.toBeUndefined();
    }
  );

  it('still waits on a request queued only after the first wait begins', async () => {
    const client: any = makeClient();
    const second = deferred();
    client.eventQueue = Promise.resolve().then(() => {
      client.eventQueue = second.promise;
    });

    await expectWaitsFor(client, second.resolve);
  });
});
