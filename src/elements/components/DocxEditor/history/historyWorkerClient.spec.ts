import { createHistoryExecutor } from './historyWorkerClient';
import { computeHistoryTask } from './historyComputation';
const input = (text: string) => ({
  finalSfdt: JSON.stringify({
    sections: [{ blocks: [{ inlines: [{ text }] }] }]
  }),
  changes: null,
  expectedSha256: null
});
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('shared history worker', () => {
  afterEach(() => jest.useRealTimers());
  it('serializes concurrent document jobs and ignores unrelated replies', async () => {
    jest.useFakeTimers();
    const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
    const run = createHistoryExecutor(() => worker);
    const a = run('stored', input('document A'));
    const b = run('stored', input('document B'));
    await tick();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const first = worker.postMessage.mock.calls[0][0];
    worker.onmessage({ data: { id: first.id + 1, result: 'wrong document' } });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.onmessage({
      data: {
        id: first.id,
        result: computeHistoryTask(first.type, first.input)
      }
    });
    expect((await a).sfdt).toContain('document A');
    await tick();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    const second = worker.postMessage.mock.calls[1][0];
    worker.onmessage({
      data: {
        id: second.id,
        result: computeHistoryTask(second.type, second.input)
      }
    });
    expect((await b).sfdt).toContain('document B');
    jest.advanceTimersByTime(30_000);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('runs selected versions ahead of queued background versions', async () => {
    jest.useFakeTimers();
    const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
    const run = createHistoryExecutor(() => worker);
    const first = run('stored', input('running'), { background: true });
    const background = run('stored', input('background'), { background: true });
    const selected = run('stored', input('selected'));
    const finish = async () => {
      const job = worker.postMessage.mock.calls.at(-1)[0];
      worker.onmessage({
        data: { id: job.id, result: computeHistoryTask(job.type, job.input) }
      });
      await tick();
    };
    await finish();
    await first;
    expect(worker.postMessage.mock.calls[1][0].input.finalSfdt).toContain(
      'selected'
    );
    await finish();
    await selected;
    await finish();
    await background;
    jest.runOnlyPendingTimers();
  });
  it('preserves results if worker creation is blocked', async () => {
    const run = createHistoryExecutor(() => {
      throw new Error('CSP');
    });
    expect(await run('stored', input('draft'))).toEqual(
      computeHistoryTask('stored', input('draft'))
    );
  });
  it('recovers the in-flight save after a worker crash and continues the queue', async () => {
    jest.useFakeTimers();
    const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
    const run = createHistoryExecutor(() => worker);
    const a = run('stored', input('A'));
    const b = run('stored', input('B'));
    await tick();
    worker.onerror({ preventDefault: jest.fn() });
    expect((await a).sfdt).toContain('A');
    expect((await b).sfdt).toContain('B');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
  });
  it('does not strand saves when a worker never responds', async () => {
    jest.useFakeTimers();
    const worker: any = { postMessage: jest.fn(), terminate: jest.fn() };
    const run = createHistoryExecutor(() => worker);
    const result = run('stored', input('draft'));
    await tick();
    jest.advanceTimersByTime(30_000);
    expect((await result).sfdt).toContain('draft');
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
  });
});
