import { useEffect } from 'react';
import { featheryWindow, runningInClient } from './browser';
import { TYPE_MESSAGES_TO_IGNORE } from './featheryClient/integrationClient';
import * as errors from './error';

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

  public _addOnlineSignal(signal: any) {
    this.onlineSignals.push(signal);
  }

  // Open a connection to the IndexedDB database
  public async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

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
    // If IndexedDB is unsupported, directly send the request
    if (!this.indexedDBSupported) {
      try {
        const response = await fetch(request.clone(), {
          cache: 'no-store',
          keepalive: ['POST', 'PATCH', 'PUT'].includes(request.method)
        });
        await this.checkResponseSuccess(response);
      } catch (error: any) {
        if (
          (this.ignoreNetworkErrors?.current ||
            TYPE_MESSAGES_TO_IGNORE.includes(error.message)) &&
          error instanceof TypeError
        ) {
          return;
        }
        throw error;
      }
    }

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
        stepKey
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
            resolve(requests);
          }
        };
      });

      const submitCustomRequests = allRequests.filter(
        (req) => req.type === 'submitCustom'
      );
      const submitStepRequests = allRequests.filter(
        (req) => req.type === 'submitStep'
      );
      await Promise.all([
        this.replayRequestsInParallel(submitCustomRequests),
        this.replayRequestsInParallel(submitStepRequests)
      ]);

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
        requestsForStep.sort((a, b) => a.timestamp - b.timestamp);
        await this.replayRequestsInParallel(requestsForStep);
      }

      this.onlineSignals.forEach((signal) => signal());
      this.onlineSignals = [];
    } finally {
      this.isReplayingRequests = false;

      // Check if there are any new requests in IndexedDB and trigger replayRequests again
      if (navigator.onLine) {
        const { store } = await this.getDbTransaction('readonly');
        const count = await new Promise<number>((resolve) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
        });

        if (count > 0) {
          await this.replayRequests();
        }
      }
    }
  }

  private async replayRequestsInParallel(requests: SerializedRequest[]) {
    await Promise.all(
      requests.map(async (request) => {
        const { url, method, headers, body, bodyType } = request;
        const reconstructedBody = this.reconstructBody(body, bodyType);
        const fetchOptions: RequestInit = {
          method,
          headers: JSON.parse(headers),
          body: reconstructedBody,
          cache: 'no-store',
          keepalive: ['POST', 'PATCH', 'PUT'].includes(method)
        };

        let attempts = 0;
        let success = false;

        while (!success && attempts < this.maxRetryAttempts) {
          try {
            const response = await fetch(url, fetchOptions);
            await this.checkResponseSuccess(response);
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

  private async checkResponseSuccess(response: any) {
    let payload;
    switch (response.status) {
      case 200:
      case 201:
        return;
      case 400:
        payload = JSON.stringify(await response.clone().text());
        console.error(payload.toString());
        return;
      case 401:
        throw new errors.SDKKeyError();
      case 404:
        throw new errors.FetchError("Can't find object");
      case 409:
        location.reload();
        return;
      case 500:
        throw new errors.FetchError('Internal server error');
      default:
        throw new errors.FetchError('Unknown error');
    }
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
