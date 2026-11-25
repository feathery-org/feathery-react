/**
 * Test doubles for the offline request queue. jsdom ships neither IndexedDB nor
 * the fetch Request class, so specs install these to drive
 * OfflineRequestHandler through its public methods against one shared store.
 */

type QueuedRow = Record<string, any>;

/**
 * An in-memory stand-in for the slice of the IndexedDB API the queue uses.
 * Install it before constructing the handler, which detects IndexedDB support
 * when it is constructed, and uninstall it after the test.
 */
export function installFakeIndexedDB(formKey: string) {
  const rowsByKey = new Map<number, QueuedRow>();
  let nextKey = 1;
  let isCommitAborting = false;
  // IndexedDB answers through callbacks set after the call returns
  const later = (callback: () => void) => Promise.resolve().then(callback);

  const transactionModes: IDBTransactionMode[] = [];
  let nextTransactionFailure: 'abort' | 'error' | undefined;
  let nextFailingTransactionMode: IDBTransactionMode | undefined;
  let shouldAbortNextCommit = false;
  let nextAbortingCommitMode: IDBTransactionMode | undefined;

  const transaction = (_storeName: string, mode: IDBTransactionMode) => {
    transactionModes.push(mode);
    const tx: any = {};
    const failure =
      !nextFailingTransactionMode || nextFailingTransactionMode === mode
        ? nextTransactionFailure
        : undefined;
    if (failure) nextTransactionFailure = undefined;
    const shouldAbortCommit =
      shouldAbortNextCommit &&
      (!nextAbortingCommitMode || nextAbortingCommitMode === mode);
    if (shouldAbortCommit) shouldAbortNextCommit = false;
    const stagedRows = new Map<number, QueuedRow | undefined>();
    let hasAddition = false;
    const rowAt = (key: number) =>
      stagedRows.has(key) ? stagedRows.get(key) : rowsByKey.get(key);
    let pendingRequests = 0;
    let isFinished = false;
    const finishRequest = () => {
      pendingRequests--;
      later(() => {
        if (!pendingRequests && !isFinished) {
          if (shouldAbortCommit || (hasAddition && isCommitAborting)) {
            fail('abort', 'QuotaExceededError');
            return;
          }
          for (const [key, row] of stagedRows) {
            if (row) rowsByKey.set(key, row);
            else rowsByKey.delete(key);
          }
          isFinished = true;
          tx.oncomplete?.();
        }
      });
    };
    const fail = (event: 'abort' | 'error', message: string) => {
      if (isFinished) return;
      isFinished = true;
      tx.error = new Error(message);
      tx[event === 'abort' ? 'onabort' : 'onerror']?.();
    };
    const scheduleRequest = (operation: () => any) => {
      const request: any = {};
      pendingRequests++;
      later(() => {
        if (isFinished) return;
        if (failure) {
          fail(failure, 'IndexedDB transaction failed');
          return;
        }
        try {
          request.result = operation();
          if (!isFinished) request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
          fail('abort', 'IndexedDB transaction aborted');
        }
        finishRequest();
      });
      return request;
    };
    const store = {
      add: (row: QueuedRow) =>
        scheduleRequest(() => {
          hasAddition = true;
          stagedRows.set(nextKey++, { ...row });
        }),
      get: (key: number) =>
        scheduleRequest(() => {
          const row = rowAt(key);
          return row && { ...row };
        }),
      put: (row: QueuedRow, key: number) =>
        scheduleRequest(() => stagedRows.set(key, { ...row })),
      delete: (key: number) =>
        scheduleRequest(() => stagedRows.set(key, undefined)),
      openCursor: () => {
        const request: any = {};
        const keys = [...new Set([...rowsByKey.keys(), ...stagedRows.keys()])];
        let index = 0;
        const advance = () => {
          const cursorRequest = scheduleRequest(() => {
            while (index < keys.length && !rowAt(keys[index])) index++;
            const key = keys[index];
            return key === undefined
              ? null
              : {
                  key,
                  value: { ...rowAt(key) },
                  continue: () => {
                    index++;
                    advance();
                  },
                  delete: () => store.delete(key),
                  update: (row: QueuedRow) => store.put(row, key)
                };
          });
          cursorRequest.onsuccess = (event: any) => request.onsuccess?.(event);
          cursorRequest.onerror = (event: any) => request.onerror?.(event);
        };
        advance();
        return request;
      }
    };
    tx.objectStore = () => store;
    return tx;
  };

  (global as any).indexedDB = {
    open: () => {
      const request: any = {};
      later(() => {
        request.result = { transaction };
        request.onsuccess?.();
      });
      return request;
    }
  };

  return {
    transactionModes,
    abortNextCommit: (mode?: IDBTransactionMode) => {
      shouldAbortNextCommit = true;
      nextAbortingCommitMode = mode;
    },
    failNextTransaction: (
      event: 'abort' | 'error',
      mode?: IDBTransactionMode
    ) => {
      nextTransactionFailure = event;
      nextFailingTransactionMode = mode;
    },
    /** Rows still queued, oldest first */
    rows: () => [...rowsByKey.values()],
    /** Queue a row as an earlier page or SDK build would have left it */
    seed: (row: QueuedRow) => {
      const key = nextKey++;
      rowsByKey.set(key, {
        formKey,
        method: 'POST',
        headers: '{}',
        body: '{}',
        bodyType: 'text',
        timestamp: key,
        retryAttempts: 0,
        ...row
      });
    },
    abortCommits: (isAborting: boolean) => {
      isCommitAborting = isAborting;
    },
    uninstall: () => {
      delete (global as any).indexedDB;
    }
  };
}

/** A Request stand-in that keeps its body so a queued payload can be read back */
export class FakeRequest {
  url: string;
  method: string;
  headers: Map<string, string>;
  body: any;
  keepalive: boolean;

  constructor(url: string, options: any) {
    this.url = url;
    this.method = options.method;
    this.headers = new Map(Object.entries(options.headers ?? {}));
    this.body = options.body;
    this.keepalive = options.keepalive ?? false;
  }

  clone() {
    return new FakeRequest(this.url, {
      method: this.method,
      headers: Object.fromEntries(this.headers),
      body: this.body,
      keepalive: this.keepalive
    });
  }

  async blob() {
    return this.body instanceof FormData
      ? this.body
      : { text: async () => this.body };
  }

  async formData() {
    return this.body as FormData;
  }
}

/**
 * A fetch Response stand-in carrying only what the replay reads. A string
 * payload is a body that is not JSON, such as a proxy's error page.
 */
export const fakeResponse = (
  status: number,
  payload: Record<string, any> | string = {}
): any => ({
  status,
  ok: status < 300,
  clone: () => fakeResponse(status, payload),
  text: async () =>
    typeof payload === 'string' ? payload : JSON.stringify(payload),
  json: async () =>
    typeof payload === 'string' ? JSON.parse(payload) : payload
});

/** Lets queued promise work run until `isDone`, giving up after a bounded wait */
export const waitUntil = async (isDone: () => boolean) => {
  for (let tick = 0; tick < 100 && !isDone(); tick++)
    await new Promise((resolve) => setTimeout(resolve, 0));
};
