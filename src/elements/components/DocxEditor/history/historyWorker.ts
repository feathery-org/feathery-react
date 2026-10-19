import { executeHistoryTask } from './historyComputation';

// Dedicated worker entry: no React, editor instance, credentials or network I/O.
self.onmessage = async (event: MessageEvent) => {
  const { id, type, input } = event.data;
  try {
    self.postMessage({ id, result: await executeHistoryTask(type, input) });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error instanceof Error ? error.message : 'History calculation failed'
    });
  }
};
