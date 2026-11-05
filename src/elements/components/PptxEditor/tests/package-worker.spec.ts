import { prepareInWorker } from '../loading/packageWorker';
import { sampleBytes } from './harness';

jest.mock('../loading/pptxWorkerSource', () => ({
  __esModule: true,
  default: 'worker code'
}));
const OriginalWorker = global.Worker;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const transport = () => ({
  postMessage: jest.fn(),
  terminate: jest.fn(),
  onmessage: null as null | ((event: any) => void),
  onerror: null as null | ((event: any) => void),
  onmessageerror: null as null | (() => void)
});
let worker: ReturnType<typeof transport>;
beforeEach(() => {
  worker = transport();
  global.Worker = jest.fn(() => worker) as unknown as typeof Worker;
  URL.createObjectURL = jest.fn(() => 'blob:worker');
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  global.Worker = OriginalWorker;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
it('returns the worker result and releases the worker', async () => {
  const promise = prepareInWorker(sampleBytes(), new AbortController().signal);
  const result = { parts: {}, trees: new Map(), estimatedBytes: 12 };
  worker.onmessage?.({ data: { id: 1, result } });
  expect(await promise).toBe(result);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('terminates cancelled work without falling back to synchronous parsing', async () => {
  const controller = new AbortController();
  const promise = prepareInWorker(sampleBytes(), controller.signal);
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('opens the file when CSP prevents starting a worker', async () => {
  global.Worker = jest.fn(() => {
    throw new Error('Blocked by CSP');
  }) as unknown as typeof Worker;
  const prepared = await prepareInWorker(
    sampleBytes(),
    new AbortController().signal
  );
  expect(prepared.trees.has('ppt/presentation.xml')).toBe(true);
});
it('recovers a transport failure using the retained bytes', async () => {
  const promise = prepareInWorker(sampleBytes(), new AbortController().signal);
  worker.onerror?.({ preventDefault: jest.fn() });
  const prepared = await promise;
  expect(prepared.trees.has('ppt/presentation.xml')).toBe(true);
  expect(worker.terminate).toHaveBeenCalledTimes(1);
});
it('reports document parse errors rather than retrying the same malformed document', async () => {
  const promise = prepareInWorker(sampleBytes(), new AbortController().signal);
  worker.onmessage?.({ data: { error: 'Invalid PPTX archive' } });
  await expect(promise).rejects.toThrow('Invalid PPTX archive');
});
