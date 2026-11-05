import {
  PresentationLoader,
  releasePreparedDeck
} from '../loading/PresentationLoader';
import { preparePackage } from '../loading/preparePackage';
import { sampleBytes } from './harness';

jest.mock('../loading/pptxWorkerSource', () => ({
  __esModule: true,
  default: 'worker code'
}));

// Mirrors production: the worker prepares off the caller and posts the result
// back, so a background prefetch is cached instead of parsed on the main thread.
class FakeWorker {
  onmessage: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage({ id, bytes }: { id: number; bytes: Uint8Array }) {
    Promise.resolve().then(() => {
      try {
        this.onmessage?.({ data: { id, result: preparePackage(bytes) } });
      } catch (error) {
        this.onmessage?.({ data: { id, error: String(error) } });
      }
    });
  }
  terminate() {}
}

const originalFetch = global.fetch;
const OriginalWorker = global.Worker;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
let loader: PresentationLoader;
let fetchMock: jest.Mock;
const controller = () => new AbortController();
beforeEach(() => {
  loader = new PresentationLoader();
  fetchMock = jest.fn().mockImplementation(async () => ({
    ok: true,
    arrayBuffer: async () => sampleBytes().buffer
  }));
  global.fetch = fetchMock;
  global.Worker = jest.fn(() => new FakeWorker()) as unknown as typeof Worker;
  URL.createObjectURL = jest.fn(() => 'blob:worker');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  loader.dispose();
  global.fetch = originalFetch;
  global.Worker = OriginalWorker;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

it('reuses prepared thumbnails and package bytes without refetching on first selection', async () => {
  await loader.prefetch('a', '/a.pptx', controller().signal);
  const deck = await loader.load('a', '/a.pptx', controller().signal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(deck.slides).toHaveLength(9);
  loader.dispose();
  // Ownership transferred: disposing speculative caches leaves the live deck intact.
  expect(deck.pkg.toBytes().length).toBeGreaterThan(0);
  releasePreparedDeck(deck);
});

it('evicts old speculative decks and does not reuse an old URL after regeneration', async () => {
  for (const id of ['a', 'b', 'c'])
    await loader.prefetch(id, `/${id}`, controller().signal);
  const a = await loader.load('a', '/a', controller().signal);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  releasePreparedDeck(a);
  const b = await loader.load('b', '/new-b', controller().signal);
  expect(fetchMock).toHaveBeenLastCalledWith('/new-b', expect.anything());
  releasePreparedDeck(b);
});

it('promotes an in-flight prefetch without a second request or losing its result on background cancellation', async () => {
  let finish: ((value: unknown) => void) | undefined;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const background = controller();
  const prefetch = loader.prefetch('a', '/a', background.signal);
  const active = loader.load('a', '/a', controller().signal);
  // load() imports the worker boundary before taking over the pending job.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  background.abort();
  if (!finish) throw new Error('Fetch was not started');
  finish({ ok: true, arrayBuffer: async () => sampleBytes().buffer });
  const deck = await active;
  await prefetch;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(deck.slides).toHaveLength(9);
  releasePreparedDeck(deck);
});

it('aborts a different speculative request when the user selects a document', async () => {
  let speculativeSignal: AbortSignal | undefined;
  fetchMock.mockImplementationOnce(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        speculativeSignal = signal;
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      })
  );
  const prefetch = loader.prefetch('a', '/a', controller().signal);
  const deck = await loader.load('b', '/b', controller().signal);
  expect(speculativeSignal?.aborted).toBe(true);
  await prefetch;
  releasePreparedDeck(deck);
});

it('skips oversized speculative decks while allowing the user to open them', async () => {
  loader.dispose();
  loader = new PresentationLoader(1);
  await loader.prefetch('large', '/large', controller().signal);
  const deck = await loader.load('large', '/large', controller().signal);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(deck.slides).toHaveLength(9);
  releasePreparedDeck(deck);
});

it('skips a background prefetch instead of parsing on the main thread when no worker is available', async () => {
  global.Worker = undefined as unknown as typeof Worker;
  // A speculative prefetch must not fall back to a main-thread parse: nothing is
  // cached, so the first real selection fetches and parses it in the foreground.
  await loader.prefetch('a', '/a.pptx', controller().signal);
  const deck = await loader.load('a', '/a.pptx', controller().signal);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(deck.slides).toHaveLength(9);
  releasePreparedDeck(deck);
});
