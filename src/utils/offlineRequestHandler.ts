import { useEffect } from 'react';
import { featheryWindow, runningInClient } from './browser';
import { checkResponseSuccess } from './featheryClient/integrationClient';
import { initInfo } from './init';

// Constants for the IndexedDB database
const DB_NAME = 'requestsDB';
const STORE_NAME = 'requestsStore';
const DB_VERSION = 1;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

export interface RequestOptions {
  headers?: {
    'Content-Type'?: string | undefined;
    Authorization?: string;
  };
  method: string;
  body: any;
  keepalive?: boolean;
}

interface SerializedRequestBody {
  type: 'blob' | 'formData' | 'arrayBuffer' | 'text';
  body: ArrayBuffer | Record<string, any> | string;
}

interface SerializedRequest {
  formKey: string;
  url: string;
  method: string;
  headers: string;
  body: SerializedRequestBody['body'];
  bodyType: SerializedRequestBody['type'];
  timestamp: number;
  type: string;
  stepKey?: string;
  keepalive?: boolean;
}

const beforeUnloadEventHandler = (event: any) => {
  // Recommended
  event.preventDefault();

  // Included for legacy support, e.g. Chrome/Edge < 119
  event.returnValue = true;
};

let unloadCounter = 0;

const trackUnload = () => {
  if (unloadCounter === 0)
    featheryWindow().addEventListener('beforeunload', beforeUnloadEventHandler);
  unloadCounter++;
};

const untrackUnload = () => {
  unloadCounter--;
  if (unloadCounter === 0)
    featheryWindow().removeEventListener(
      'beforeunload',
      beforeUnloadEventHandler
    );
};

export function useOfflineRequestHandler(formKey: string) {
  useEffect(() => {
    if (!runningInClient()) return;

    offlineRequestHandler.replayRequests(formKey);
    const handleOnline = () => offlineRequestHandler.replayRequests(formKey);
    featheryWindow().addEventListener('online', handleOnline);
    return () => featheryWindow().removeEventListener('online', handleOnline);
  }, []);
}

export class OfflineRequestHandler {
  private isReplayingRequests: Map<string, boolean>;
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly dbVersion: number;
  private readonly maxRetryAttempts: number;
  private readonly retryDelayMs: number;
  private onlineSignals: Map<string, any[]>;
  private indexedDBSupported: boolean;

  constructor(
    dbName: string,
    storeName: string,
    dbVersion: number,
    maxRetryAttempts: number,
    retryDelayMs: number
  ) {
    this.isReplayingRequests = new Map();
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbVersion = dbVersion;
    this.maxRetryAttempts = maxRetryAttempts;
    this.retryDelayMs = retryDelayMs;
    this.onlineSignals = new Map();
    this.indexedDBSupported = typeof indexedDB !== 'undefined';
  }

  // Check if any requests are stored in indexedDB
  public async dbHasRequest(): Promise<boolean> {
    const { store } = await this.getDbTransaction('readonly');
    const count = await new Promise<number>((resolve) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
    });

    return count > 0;
  }

  public onlineAndReplayed(formKey: string) {
    return new Promise((resolve) => {
      if (!this.onlineSignals.has(formKey)) {
        this.onlineSignals.set(formKey, []);
      }
      this.onlineSignals.get(formKey)!.push(resolve);
    });
  }

  // Open a connection to the IndexedDB database
  public async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      // Good practice to keep onupgradeneeded to handle
      // database creation scenarios (after database deletion by user)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { autoIncrement: true });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getDbTransaction(
    mode: 'readwrite' | 'readonly'
  ): Promise<{ tx: IDBTransaction; store: IDBObjectStore }> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.storeName, mode);
    const store = tx.objectStore(this.storeName);
    return { tx, store };
  }

  // Save request to IndexedDB
  public async runOrSaveRequest(
    run: any,
    formKey: string,
    url: string,
    options: any,
    type: string,
    stepKey?: string
  ): Promise<void> {
    if (navigator.onLine) {
      trackUnload();
      if (
        this.isReplayingRequests.get(formKey) ||
        (await this.dbHasRequest())
      ) {
        // Wait if any requests in IndexedDB or if a replay is ongoing
        await offlineRequestHandler.onlineAndReplayed(formKey);
      }
      // Proceed with normal request sending
      await run();
      untrackUnload();
      return;
    }

    // If IndexedDB is unsupported, we cannot store requests to replay
    if (!this.indexedDBSupported) return;

    const { sdkKey } = initInfo();
    options.headers = { ...options.headers, Authorization: `Token ${sdkKey}` };
    const request = new Request(url, options);

    const keepalive =
      request.keepalive !== undefined
        ? request.keepalive
        : ['POST', 'PATCH', 'PUT'].includes(request.method);

    try {
      const requestClone: Request = request.clone();
      let serializedBody: SerializedRequestBody = { type: 'text', body: '' };

      if (requestClone.method !== 'GET' && requestClone.method !== 'HEAD') {
        serializedBody = await requestClone
          .blob()
          .then(this.serializeRequestBody);
      }

      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const serializedRequest: SerializedRequest = {
        formKey: formKey,
        url: requestClone.url,
        method: requestClone.method,
        headers: JSON.stringify(headers),
        body: serializedBody.body,
        bodyType: serializedBody.type,
        timestamp: Date.now(),
        type,
        stepKey,
        keepalive
      };

      const { tx, store } = await this.getDbTransaction('readwrite');
      const requestPromise = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      store.add(serializedRequest);
      await requestPromise;
    } catch (error) {
      console.warn('Error saving request', error);
    }
  }

  // Helper function to serialize request body based on its type
  private async serializeRequestBody(
    body: any
  ): Promise<SerializedRequestBody> {
    if (body === null) {
      return { type: 'text', body: '' };
    }
    if (body instanceof Blob) {
      return { type: 'blob', body: await body.arrayBuffer() }; // Convert Blob to ArrayBuffer for storage
    } else if (body instanceof FormData) {
      // FormData needs to be converted to a plain object
      const formDataObj: Record<string, any> = {};
      body.forEach((value, key) => {
        formDataObj[key] = value;
      });
      return { type: 'formData', body: formDataObj };
    } else if (body instanceof ArrayBuffer) {
      return { type: 'arrayBuffer', body: body };
    } else {
      // Assume it's text or JSON
      return { type: 'text', body: await body.text() };
    }
  }

  // Replay requests from IndexedDB
  public async replayRequests(formKey: string) {
    if (!this.indexedDBSupported) {
      return;
    }

    if (!navigator.onLine) {
      // If offline, block until requests are replayed from online event handler
      await offlineRequestHandler.onlineAndReplayed(formKey);
      return;
    }

    if (this.isReplayingRequests.get(formKey)) return;
    this.isReplayingRequests.set(formKey, true);
    trackUnload();
    try {
      const { store } = await this.getDbTransaction('readwrite');

      const allRequests: SerializedRequest[] = await new Promise<
        SerializedRequest[]
      >((resolve) => {
        const requests: SerializedRequest[] = [];
        store.openCursor().onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
            .result;
          if (cursor) {
            const request = cursor.value as SerializedRequest;
            if (request.formKey === formKey) {
              requests.push(request);
            }
            cursor.continue();
          } else {
            requests.sort((a, b) => a.timestamp - b.timestamp);
            resolve(requests);
          }
        };
      });

      const submitRequests = allRequests.filter((req) => req.type === 'submit');
      await this.replayRequestsInParallel(submitRequests, formKey);

      const registerEventRequests = allRequests.filter(
        (req) => req.type === 'registerEvent'
      );
      const stepKeys = Array.from(
        new Set(registerEventRequests.map((req) => req.stepKey))
      );

      for (const stepKey of stepKeys) {
        const requestsForStep = registerEventRequests.filter(
          (req) => req.stepKey === stepKey
        );
        await this.replayRequestsInParallel(requestsForStep, formKey);
      }
    } finally {
      this.isReplayingRequests.set(formKey, false);

      // Check if there are any new requests in IndexedDB and trigger replayRequests again
      const requestsInDB = await this.dbHasRequest();
      if (requestsInDB) await this.replayRequests(formKey);

      untrackUnload();
      const signals = this.onlineSignals.get(formKey) || [];
      signals.forEach((signal) => signal());
      this.onlineSignals.delete(formKey);
    }
  }

  private replayRequestsInParallel(
    requests: SerializedRequest[],
    formKey: string
  ) {
    return Promise.all(
      requests.map(async (request) => {
        const { url, method, headers, body, bodyType, keepalive } = request;
        const reconstructedBody = this.reconstructBody(body, bodyType);
        const fetchOptions: RequestInit = {
          method,
          headers: JSON.parse(headers),
          body: reconstructedBody,
          cache: 'no-store',
          keepalive: keepalive
        };

        let attempts = 0;
        let success = false;

        const attemptRequest = async () => {
          while (!success && attempts < this.maxRetryAttempts) {
            try {
              const response = await fetch(url, fetchOptions);
              await checkResponseSuccess(response);
              success = true;
              await this.removeRequest();
            } catch (error: any) {
              attempts++;
              await this.delay(this.retryDelayMs);
            }

            if (!navigator.onLine) {
              // If offline, block until requests are replayed from online event handler
              await offlineRequestHandler.onlineAndReplayed(formKey);
              return;
            }

            if (attempts === this.maxRetryAttempts) {
              break;
            }
          }
        };

        return attemptRequest();
      })
    );
  }

  private async removeRequest() {
    const { store } = await this.getDbTransaction('readwrite');
    await store.clear();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private reconstructBody(
    body: any,
    bodyType: 'blob' | 'formData' | 'arrayBuffer' | 'text'
  ): Blob | FormData | null {
    switch (bodyType) {
      case 'blob':
        return new Blob([body]);
      case 'formData': {
        const formData = new FormData();
        const parsedBody = JSON.parse(body) as Record<string, any>;
        Object.entries(parsedBody).forEach(([key, value]) => {
          formData.append(key, value);
        });
        return formData;
      }
      case 'arrayBuffer':
        return body;
      case 'text':
      default:
        return body;
    }
  }
}

const offlineRequestHandler = new OfflineRequestHandler(
  DB_NAME,
  STORE_NAME,
  DB_VERSION,
  MAX_RETRY_ATTEMPTS,
  RETRY_DELAY_MS
);

export default offlineRequestHandler;
