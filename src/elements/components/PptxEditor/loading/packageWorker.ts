import source from './pptxWorkerSource';
import type { PreparedPackage } from './preparePackage';

export const abortError = () =>
  new DOMException('Loading cancelled', 'AbortError');

/** One preparation worker per packet. Cancellation releases speculative work. */
export async function prepareInWorker(
  bytes: Uint8Array,
  signal: AbortSignal
): Promise<PreparedPackage> {
  if (signal.aborted) throw abortError();
  const fallback = async () => {
    const { preparePackage } = await import('./preparePackage');
    if (signal.aborted) throw abortError();
    return preparePackage(bytes);
  };
  if (!source || typeof Worker === 'undefined') return fallback();
  let worker: Worker;
  let url: string | undefined;
  try {
    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch {
    return fallback();
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
  return new Promise<PreparedPackage>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(abortError());
    };
    const failed = () => {
      finish();
      fallback().then(resolve, reject);
    };
    const timer = setTimeout(failed, 30_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      failed();
    };
    worker.onmessageerror = failed;
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    // Keep original bytes for the CSP/transport fallback; never detach them.
    try {
      worker.postMessage({ id: 1, bytes });
    } catch {
      failed();
    }
  });
}
