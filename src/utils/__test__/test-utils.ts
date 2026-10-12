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

  const openCursor = () => {
    const request: any = {};
    const keys = [...rowsByKey.keys()];
    let index = 0;
    const advance = () => {
      while (index < keys.length && !rowsByKey.has(keys[index])) index++;
      const key = keys[index];
      const result =
        key === undefined
          ? null
          : {
              key,
              value: { ...rowsByKey.get(key) },
              continue: () => {
                index++;
                later(advance);
              },
              delete: () => rowsByKey.delete(key),
              update: (row: QueuedRow) => rowsByKey.set(key, { ...row })
            };
      request.onsuccess?.({ target: { result } });
    };
    later(advance);
    return request;
  };

  const transaction = () => {
    const tx: any = {};
    tx.objectStore = () => ({
      add: (row: QueuedRow) => {
        // A quota failure surfaces at commit, as an aborted transaction
        if (isCommitAborting) {
          tx.error = new Error('QuotaExceededError');
          later(() => tx.onabort?.());
          return;
        }
        rowsByKey.set(nextKey++, { ...row });
        later(() => tx.oncomplete?.());
      },
      get: (key: number) => {
        const request: any = {};
        later(() => {
          const row = rowsByKey.get(key);
          request.result = row && { ...row };
          request.onsuccess?.();
        });
        return request;
      },
      put: (row: QueuedRow, key: number) => rowsByKey.set(key, { ...row }),
      delete: (key: number) => rowsByKey.delete(key),
      openCursor
    });
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
