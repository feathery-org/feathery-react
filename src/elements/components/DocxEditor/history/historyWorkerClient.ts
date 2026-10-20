import source from './historyWorkerSource';
import { executeHistoryTask, HistoryTasks } from './historyComputation';

type WorkerFactory = () => Worker | null;
const createWorker: WorkerFactory = () => {
  if (!source || typeof Worker === 'undefined') return null;
  const url = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' })
  );
  try {
    return new Worker(url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** One shared worker: interactive jobs run ahead of queued background jobs.
 * Save ordering remains owned by each document's existing persistence queue. */
export function createHistoryExecutor(factory: WorkerFactory = createWorker) {
  let worker: Worker | null = null;
  let unavailable = false;
  let nextId = 0;
  const queue: Array<{ background: boolean; start: () => Promise<void> }> = [];
  let running = false;
  const drain = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const selected = queue.findIndex((job) => !job.background);
      const [job] = queue.splice(selected < 0 ? 0 : selected, 1);
      await job.start();
    }
    running = false;
  };
  let idle: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    worker?.terminate();
    worker = null;
  };
  const execute = async <K extends keyof HistoryTasks>(
    type: K,
    input: HistoryTasks[K]['input']
  ): Promise<HistoryTasks[K]['result']> => {
    if (idle) clearTimeout(idle);
    if (!unavailable && !worker) {
      try {
        worker = factory();
        unavailable = !worker;
      } catch {
        unavailable = true;
      }
    }
    // Blocked workers (e.g. an embedding site's CSP) must not lose saves.
    if (!worker) return executeHistoryTask(type, input);
    const current = worker;
    const id = ++nextId;
    try {
      return await new Promise<HistoryTasks[K]['result']>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          current.onmessage = null;
          current.onerror = null;
          current.onmessageerror = null;
        };
        const failed = () => {
          finish();
          unavailable = true;
          stop();
          reject(new Error('History worker unavailable'));
        };
        const timer = setTimeout(failed, 30_000);
        current.onerror = (event) => {
          event.preventDefault();
          failed();
        };
        current.onmessageerror = failed;
        current.onmessage = (event) => {
          if (event.data.id !== id) return;
          finish();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.result);
        };
        try {
          current.postMessage({ id, type, input });
        } catch {
          failed();
        }
      });
    } catch (error) {
      // Retry only a transport failure; deterministic computation errors stay errors.
      if (!unavailable) throw error;
      return executeHistoryTask(type, input);
    } finally {
      idle = setTimeout(stop, 30_000);
    }
  };
  return <K extends keyof HistoryTasks>(
    type: K,
    input: HistoryTasks[K]['input'],
    options: { background?: boolean } = {}
  ): Promise<HistoryTasks[K]['result']> =>
    new Promise((resolve, reject) => {
      queue.push({
        background: !!options.background,
        start: async () => {
          try {
            resolve(await execute(type, input));
          } catch (error) {
            reject(error);
          }
        }
      });
      drain();
    });
}

export const runHistoryTask = createHistoryExecutor();
