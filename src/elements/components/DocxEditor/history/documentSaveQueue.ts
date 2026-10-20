/** Ordered document writes. A failed snapshot stays ahead of newer edits until
 * a retry succeeds; callers never need to reconstruct it from the live editor. */
export function createDocumentSaveQueue() {
  type Job = {
    generation: number;
    write: () => Promise<unknown>;
    resolve: (result: unknown) => void;
    reject: (error: unknown) => void;
  };
  const jobs: Job[] = [];
  let running: Promise<unknown> | null = null;
  let lastResult: unknown;
  let generation = 0;

  const flush = (): Promise<unknown> => {
    if (running) return running;
    if (!jobs.length) return Promise.resolve(lastResult);
    let failed = false;
    running = (async () => {
      while (jobs.length) {
        const job = jobs[0];
        try {
          const result = await job.write();
          if (job.generation === generation) lastResult = result;
          jobs.shift();
          job.resolve(result);
        } catch (error) {
          failed = true;
          // Retain every snapshot, but settle every waiting caller. A subsequent
          // explicit retry starts at the failed write, not at today's document.
          jobs.forEach((pending) => pending.reject(error));
          throw error;
        }
      }
      return lastResult;
    })().finally(() => {
      running = null;
      if (!failed && jobs.length) flush().catch(() => undefined);
    });
    return running;
  };

  return {
    submit(write: () => Promise<unknown>): Promise<unknown> {
      const result = new Promise((resolve, reject) => {
        jobs.push({ write, resolve, reject, generation });
      });
      flush().catch(() => undefined);
      return result;
    },
    flush,
    resetResult() {
      generation++;
      lastResult = undefined;
    },
    pending: () => jobs.length > 0
  };
}
