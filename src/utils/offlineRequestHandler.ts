import { useEffect } from 'react';
import { featheryWindow, runningInClient } from './browser';
import {
  TYPE_MESSAGES_TO_IGNORE,
  checkResponseSuccess
} from './featheryClient/integrationClient';

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

export function useOfflineRequestHandler(
  hasRedirected: React.RefObject<boolean>
) {
  useEffect(() => {
    const handleOnline = () => {
      offlineRequestHandler.replayRequests();
    };

    if (!runningInClient()) return;

    featheryWindow().addEventListener('online', handleOnline);
    return () => featheryWindow().removeEventListener('online', handleOnline);
  }, []);

  offlineRequestHandler.ignoreNetworkErrors = hasRedirected;

  useEffect(() => {
    async function checkAndReplayRequests() {
      if (!offlineRequestHandler.isReplayingRequests) {
        const hasRequestsInDB = await offlineRequestHandler.checkIndexedDB();
        if (hasRequestsInDB) {
          await offlineRequestHandler.replayRequests();
        }
      }
    }

    checkAndReplayRequests();
  }, []);
}

export class OfflineRequestHandler {
  public isReplayingRequests = false;
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly dbVersion: number;
  private readonly maxRetryAttempts: number;
  private readonly retryDelayMs: number;
  onlineSignals: any[];
  private indexedDBSupported: boolean;
  public ignoreNetworkErrors: React.RefObject<boolean> | undefined;

  constructor(
    dbName: string,
    storeName: string,
    dbVersion: number,
    maxRetryAttempts: number,
    retryDelayMs: number
  ) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbVersion = dbVersion;
    this.maxRetryAttempts = maxRetryAttempts;
    this.retryDelayMs = retryDelayMs;
    this.onlineSignals = [];
    this.indexedDBSupported = typeof indexedDB !== 'undefined';
    this.ignoreNetworkErrors = undefined;
  }

  // Check if any requestes stored in indexedDB
  public async checkIndexedDB(): Promise<boolean> {
    const { store } = await this.getDbTransaction('readonly');
    const count = await new Promise<number>((resolve) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
    });

    return count > 0;
  }

  public async prioritizeOffline(): Promise<boolean> {
    if (this.isReplayingRequests) {
      return true;
    }
    return await this.checkIndexedDB();
  }

  public _addOnlineSignal(signal: any) {
    this.onlineSignals.push(signal);
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
  public async saveRequest(
    request: Request,
    type: string,
    stepKey?: string
  ): Promise<void> {
    const keepalive =
      request.keepalive !== undefined
        ? request.keepalive
        : ['POST', 'PATCH', 'PUT'].includes(request.method);

    // If IndexedDB is unsupported, we cannot store requests to replay
    if (!this.indexedDBSupported) return;

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
      console.error('Error adding request to IndexedDB:', error);
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
  public async replayRequests() {
    if (!this.indexedDBSupported) {
      return;
    }

    if (!navigator.onLine) {
      // If offline, block until requests are replayed from online event handler
      await new Promise((resolve) => this._addOnlineSignal(resolve));
      return;
    }

    if (this.isReplayingRequests) {
      return;
    }

    this.isReplayingRequests = true;

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
            requests.push(cursor.value as SerializedRequest);
            cursor.continue();
          } else {
            requests.sort((a, b) => a.timestamp - b.timestamp);
            resolve(requests);
          }
        };
      });

      const submitRequests = allRequests.filter((req) => req.type === 'submit');
      await this.replayRequestsInParallel(submitRequests);

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
        await this.replayRequestsInParallel(requestsForStep);
      }

      this.onlineSignals.forEach((signal) => signal());
      this.onlineSignals = [];
    } finally {
      this.isReplayingRequests = false;

      // Check if there are any new requests in IndexedDB and trigger replayRequests again
      if (navigator.onLine) {
        const requestsInDB = await this.checkIndexedDB();
        if (requestsInDB) {
          await this.replayRequests();
        }
      }
    }
  }

  private async replayRequestsInParallel(requests: SerializedRequest[]) {
    await Promise.all(
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

        while (!success && attempts < this.maxRetryAttempts) {
          try {
            const response = await fetch(url, fetchOptions);
            await checkResponseSuccess(response);
            success = true;
            await this.removeRequest();
          } catch (error: any) {
            if (
              (this.ignoreNetworkErrors?.current ||
                TYPE_MESSAGES_TO_IGNORE.includes(error.message)) &&
              error instanceof TypeError
            ) {
              return;
            }
            attempts++;
            await this.delay(this.retryDelayMs);
          }

          if (!navigator.onLine) {
            // If offline, block until requests are replayed from online event handler
            await new Promise((resolve) => this._addOnlineSignal(resolve));
            return;
          }

          if (attempts === this.maxRetryAttempts) {
            break;
          }
        }
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
