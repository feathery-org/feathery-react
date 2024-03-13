import { useEffect } from 'react';
import { featheryWindow } from './browser';

// Constants for the IndexedDB database
const DB_NAME = 'offlineRequestsDB';
const STORE_NAME = 'offlineRequestsStore';
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
}

export function useOfflineRequestHandler() {
  useEffect(() => {
    const handleOnline = () => {
      offlineRequestHandler.replayRequests();
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
  private dbName: string;
  private storeName: string;
  private dbVersion: number;
  private maxRetryAttempts: number;
  private retryDelayMs: number;

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

  // Save request to IndexedDB
  public async saveRequest(requestToSave: Request): Promise<void> {
    const db = await this.openDatabase();
    try {
      const getTransaction = async () => {
        const tx = db.transaction(this.storeName, 'readwrite');
        const store = tx.objectStore(this.storeName);
        return { tx, store };
      };
      const requestClone: Request = requestToSave.clone();
      let serializedBody: SerializedRequestBody = { type: 'text', body: '' };

      if (requestClone.method !== 'GET' && requestClone.method !== 'HEAD') {
        serializedBody = await requestClone
          .blob()
          .then(this.serializeRequestBody);
      }

      const headers: Record<string, string> = {};
      requestToSave.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const serializedRequest: SerializedRequest = {
        url: requestClone.url,
        method: requestClone.method,
        headers: JSON.stringify(headers),
        body: serializedBody.body,
        bodyType: serializedBody.type,
        timestamp: Date.now()
      };
      const { tx, store } = await getTransaction();
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
    const db = await this.openDatabase();
    const tx = db.transaction(this.storeName, 'readwrite');
    const store = tx.objectStore(this.storeName);

    const requests: SerializedRequest[] = [];

    await new Promise<void>((resolve) => {
      store.openCursor().onsuccess = (event: Event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
          .result;
        if (cursor) {
          requests.push(cursor.value as SerializedRequest);
          cursor.continue();
        } else {
          // All entries have been collected, resolve the promise
          resolve();
        }
      };
    });

    requests.sort((a, b) => a.timestamp - b.timestamp);

    for (const request of requests) {
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
          } else {
            attempts++;
            await this.delay(this.retryDelayMs);
          }
        } catch (error) {
          console.error(`Failed to replay request: ${url}`, error);
          attempts++;
          await this.delay(this.retryDelayMs);
        }

        if (attempts === this.maxRetryAttempts) {
          console.log(`Max retry attempts reached for request url: ${url}`);
          break;
        }
      }
    }

    try {
      await db
        .transaction(this.storeName, 'readwrite')
        .objectStore(this.storeName)
        .clear();
    } catch (error) {
      console.error('Error clearing IndexedDB:', error);
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

function createOfflineRequestHandler(): OfflineRequestHandler {
  return new OfflineRequestHandler(
    DB_NAME,
    STORE_NAME,
    DB_VERSION,
    MAX_RETRY_ATTEMPTS,
    RETRY_DELAY_MS
  );
}

const offlineRequestHandler = createOfflineRequestHandler();

export default offlineRequestHandler;
