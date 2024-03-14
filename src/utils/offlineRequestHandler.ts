import { useEffect } from 'react';
import { featheryWindow } from './browser';

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

export function useOfflineRequestHandler() {
  useEffect(() => {
    const handleOnline = () => {
      if (!offlineRequestHandler.isReplayingRequests) {
        offlineRequestHandler.replayRequests();
      }
    };

    const windowObj = featheryWindow();
    if (windowObj && windowObj.addEventListener) {
      windowObj.addEventListener('online', handleOnline);
    }

    return () => {
      if (windowObj && windowObj.removeEventListener) {
        windowObj.removeEventListener('online', handleOnline);
      }
    };
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
  }

  public _addOnlineSignal(signal: any) {
    this.onlineSignals.push(signal);
  }

  // Open a connection to the IndexedDB database
  public async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

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

  // TODO: handle case where browser does not support IndexDB. Just run the
  //  request directly with no offline support.
  // Save request to IndexedDB
  public async saveRequest(
    request: Request,
    type: string,
    stepKey?: string
  ): Promise<void> {
    const db = await this.openDatabase();
    try {
      const getTransaction = async () => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        return { tx, store };
      };
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
      const { tx, store } = await getTransaction();
      const requestPromise = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      store.add(serializedRequest);
      await requestPromise;
      console.log('Request successfully added: ', request, type, stepKey);
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

  // TODO: what does performance look like while using IndexDB?
  // Replay requests from IndexedDB
  public async replayRequests() {
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
      const db = await this.openDatabase();
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);

      const requestsByStep: Record<string, SerializedRequest[]> = {};

      await new Promise<void>((resolve) => {
        store.openCursor().onsuccess = (event: Event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
            .result;
          if (cursor) {
            const request = cursor.value as SerializedRequest;
            if (request.stepKey) {
              if (!requestsByStep[request.stepKey]) {
                requestsByStep[request.stepKey] = [];
              }
              requestsByStep[request.stepKey].push(request);
            }
            cursor.continue();
          } else {
            // All entries have been collected, resolve the promise
            resolve();
          }
        };
      });

      // Replay submitCustom requests immediately
      const submitCustomRequests = await this.getRequestsByType('submitCustom');
      await this.replayRequestsInParallel(submitCustomRequests);

      // Replay submitStep requests immediately
      const submitStepRequests = await this.getRequestsByType('submitStep');
      await this.replayRequestsInParallel(submitStepRequests);

      const stepKeys = Object.keys(requestsByStep);
      stepKeys.sort((a, b) => {
        const firstRequest = requestsByStep[a][0];
        const secondRequest = requestsByStep[b][0];
        return firstRequest.timestamp - secondRequest.timestamp;
      });

      for (const stepKey of stepKeys) {
        const requests = requestsByStep[stepKey];
        const completeStepRequests = requests.filter(
          (req) => req.type === 'completeStep'
        );
        const loadStepRequests = requests.filter(
          (req) => req.type === 'loadStep'
        );

        await this.replayRequestsInParallel(completeStepRequests);
        await this.replayRequestsInParallel(loadStepRequests);
      }

      this.onlineSignals.forEach((signal) => signal());
      this.onlineSignals = [];
    } finally {
      this.isReplayingRequests = false;

      // Check if there are any new requests in IndexedDB and trigger replayRequests again
      if (navigator.onLine) {
        const db = await this.openDatabase();
        const tx = db.transaction(this.storeName, 'readonly');
        const store = tx.objectStore(this.storeName);
        const count = await new Promise<number>((resolve) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
        });

        if (count > 0) {
          this.replayRequests();
        }
      }
    }
  }

  private async getRequestsByType(type: string): Promise<SerializedRequest[]> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.storeName, 'readonly');
    const store = tx.objectStore(this.storeName);

    return new Promise<SerializedRequest[]>((resolve) => {
      const requests: SerializedRequest[] = [];
      store.openCursor().onsuccess = (event: Event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
          .result;
        if (cursor) {
          const request = cursor.value as SerializedRequest;
          if (request.type === type) {
            requests.push(request);
          }
          cursor.continue();
        } else {
          resolve(requests);
        }
      };
    });
  }

  private async replayRequestsInParallel(requests: SerializedRequest[]) {
    await Promise.all(
      requests.map(async (request) => {
        const { url, method, headers, body, bodyType } = request;
        const reconstructedBody = this.reconstructBody(body, bodyType);
        const fetchOptions: RequestInit = {
          method,
          headers: JSON.parse(headers),
          body: reconstructedBody
        };

        let attempts = 0;
        let success = false;

        while (!success && attempts < this.maxRetryAttempts) {
          try {
            const response = await fetch(url, fetchOptions);
            if (response.ok) {
              success = true;
              await this.removeRequest();
              console.log('Request replayed and removed: ', request);
            } else {
              attempts++;
              await this.delay(this.retryDelayMs);
            }
          } catch (error) {
            attempts++;
            await this.delay(this.retryDelayMs);
          }

          if (!navigator.onLine) {
            // If offline, block until requests are replayed from online event handler
            await new Promise((resolve) => this._addOnlineSignal(resolve));
            return;
          }

          if (attempts === this.maxRetryAttempts) {
            console.log(
              'Max retry attempts reached for request: ',
              url,
              fetchOptions
            );
            break;
          }
        }
      })
    );
  }

  private async removeRequest() {
    const db = await this.openDatabase();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);
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
