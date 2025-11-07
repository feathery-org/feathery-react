import { useEffect } from 'react';
import { featheryWindow, runningInClient } from './browser';
import { initInfo } from './init';
import type FeatheryClient from './featheryClient';
import { checkResponseSuccess } from './featheryClient/utils';
import { isInteractionDetected } from './interactionState';

// Constants for the IndexedDB database
const DB_NAME = 'requestsDB';
const STORE_NAME = 'requestsStore';
const DB_VERSION = 1;
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2000;
const INDEXEDDB_ACCESS_DENIED_ERRORS = [
  'IDBFactory.open() called in an invalid security context',
  'denied permission'
];

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

interface RequestMetadata {
  fieldKey?: string;
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
  key?: IDBValidKey;
  metadata?: RequestMetadata;
}

const beforeUnloadEventHandler = (event: any) => {
  // allow navigation if user has not interacted with form
  if (!isInteractionDetected()) return;

  event.preventDefault();
  // Support legacy browsers, e.g. Chrome/Edge < 119
  event.returnValue = true;
};

let unloadCounter = 0;

const trackUnload = () => {
  if (unloadCounter === 0)
    featheryWindow().addEventListener('beforeunload', beforeUnloadEventHandler);
  unloadCounter++;
};

export const untrackUnload = (force = false) => {
  unloadCounter = force ? 0 : unloadCounter - 1;
  if (unloadCounter === 0)
    featheryWindow().removeEventListener(
      'beforeunload',
      beforeUnloadEventHandler
    );
};

export function useOfflineRequestHandler(client: FeatheryClient) {
  useEffect(() => {
    if (!runningInClient() || !client) return;

    client.offlineRequestHandler.replayRequests();
    const handleOnline = () => client.offlineRequestHandler.replayRequests();
    featheryWindow().addEventListener('online', handleOnline);
    return () => featheryWindow().removeEventListener('online', handleOnline);
  }, [client]);
}

/**
 * OfflineRequestHandler manages HTTP request reliability for forms.
 * Failed requests are queued in IndexedDB and replayed when connectivity is restored.
 *
 * Behavior:
 * - When online: attempts requests immediately, but queues them if network errors occur
 * - When offline: immediately queues all requests for later replay
 * - Prevent page unload while requests are pending
 * - Replays requests in chronological order
 */
export class OfflineRequestHandler {
  private isReplayingRequests: Map<string, boolean>;
  private readonly formKey: string;
  private readonly dbName: string;
  private readonly storeName: string;
  private readonly dbVersion: number;
  private readonly maxRetryAttempts: number;
  private readonly retryDelayMs: number;
  private onlineSignals: Map<string, any[]>;
  private indexedDBSupported: boolean;
  private errorCallback?: (error: string) => void;

  constructor(formKey: string, errorCallback?: (error: string) => void) {
    this.isReplayingRequests = new Map();
    this.formKey = formKey;
    this.dbName = DB_NAME;
    this.storeName = STORE_NAME;
    this.dbVersion = DB_VERSION;
    this.maxRetryAttempts = MAX_RETRY_ATTEMPTS;
    this.retryDelayMs = RETRY_DELAY_MS;
    this.onlineSignals = new Map();
    this.indexedDBSupported = typeof indexedDB !== 'undefined';
    this.errorCallback = errorCallback;
  }

  // Check if any requests are stored in indexedDB
  public async dbHasRequest(): Promise<boolean> {
    const dbTransaction = await this.getDbTransaction('readonly');
    if (dbTransaction) {
      const { store } = dbTransaction;
      const count = await new Promise<number>((resolve) => {
        const request = store.openCursor();
        let count = 0;
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>)
            .result;
          if (cursor) {
            const request = cursor.value as SerializedRequest;
            if (request.formKey === this.formKey) {
              count++;
            }
            cursor.continue();
          } else {
            resolve(count);
          }
        };
      });

      return count > 0;
    } else {
      return false;
    }
  }

  // Wait for user to be online and for any replayed requests to finish
  public onlineAndReplayed() {
    return new Promise((resolve) => {
      if (!this.onlineSignals.has(this.formKey)) {
        this.onlineSignals.set(this.formKey, []);
      }
      this.onlineSignals.get(this.formKey)?.push(resolve);
    });
  }

  // Open a connection to the IndexedDB database
  public async openDatabase(): Promise<IDBDatabase | undefined> {
    return new Promise((resolve) => {
      try {
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
        request.onerror = (event) => {
          const error = (event.target as IDBRequest<IDBDatabase>).error;
          if (
            INDEXEDDB_ACCESS_DENIED_ERRORS.some((msg) =>
              error?.message?.includes(msg)
            )
          ) {
            console.warn('IndexedDB access denied:', error);
            resolve(undefined);
          } else {
            console.warn('IndexedDB error:', error);
            resolve(undefined);
          }
        };
      } catch (error) {
        console.warn('Error opening IndexedDB database:', error);
        resolve(undefined);
      }
    });
  }

  private async getDbTransaction(
    mode: 'readwrite' | 'readonly'
  ): Promise<{ tx: IDBTransaction; store: IDBObjectStore } | undefined> {
    const db = await this.openDatabase();
    if (db) {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      return { tx, store };
    } else {
      return undefined;
    }
  }

  /**
   * Core request orchestration method that decides whether to execute a request immediately
   * or queue it for later replay. This implements the "eventual consistency" pattern for
   * offline-first applications.
   *
   * Logic flow:
   * 1. If online AND no pending requests: execute immediately
   * 2. If online BUT requests are queued/replaying: wait for queue to clear, then execute
   * 3. If request fails with network error: queue it and start replay process
   * 4. If offline: immediately queue the request
   */
  public async runOrSaveRequest(
    run: any,
    url: string,
    options: any,
    type: string,
    stepKey?: string,
    metadata?: RequestMetadata
  ): Promise<void> {
    if (navigator.onLine) {
      // Prevent page unload while processing requests to avoid data loss
      trackUnload();
      if (this.indexedDBSupported) {
        if (this.isReplayingRequests.get(this.formKey)) {
          // Replay already in progress, wait for it to complete
          await this.onlineAndReplayed();
        } else if (await this.dbHasRequest()) {
          // Clear any stale requests for this step before attempting
          // Step submissions create multiple parallel requests (JSON, custom fields, files)
          // all with the same stepKey. Clear all of them to prevent replay loops.
          if (stepKey !== undefined) {
            await this.clearFailedRequestsByStep(stepKey);
          }

          // Check again if there are OTHER pending requests that need replay
          if (await this.dbHasRequest()) {
            // Other pending requests exist → trigger replay for them
            await this.replayRequests();
          }
        }
      }
      try {
        const response = await run();
        untrackUnload();
        return response;
      } catch (e) {
        // TypeError indicates network connectivity issues
        // This catches scenarios like timeouts, resolution failures, etc.
        if (e instanceof TypeError) {
          await this.saveRequest(url, options, type, stepKey, metadata);
          // Don't immediately trigger replay - this can cause infinite loops
          // when the same request keeps failing. Instead, rely on:
          // 1. The 'online' event listener to trigger replay when connectivity returns
          // 2. The next user action (button click) to attempt submission again
          // 3. The replayRequests() recursion check at the end of replay cycle
        }
        untrackUnload();
        throw e; // Re-throw error so caller knows submission failed
      }
    } else {
      await this.saveRequest(url, options, type, stepKey, metadata);
    }
  }

  public async saveRequest(
    url: string,
    options: any,
    type: string,
    stepKey?: string,
    metadata?: RequestMetadata
  ): Promise<void> {
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
        formKey: this.formKey,
        url: requestClone.url,
        method: requestClone.method,
        headers: JSON.stringify(headers),
        body: serializedBody.body,
        bodyType: serializedBody.type,
        timestamp: Date.now(),
        type,
        stepKey,
        keepalive,
        metadata
      };

      const dbTransaction = await this.getDbTransaction('readwrite');
      if (dbTransaction) {
        const { tx, store } = dbTransaction;
        const requestPromise = new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        store.add(serializedRequest);
        await requestPromise;
      }
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

  /**
   * Replay queued requests:
   *
   * Step 1: Submit requests (form submissions, custom requests) - executed in parallel
   * Step 2: Event registrations - grouped by step and executed sequentially by step,
   *          but in parallel within each step to maintain event ordering per form step
   */
  public async replayRequests() {
    if (!this.indexedDBSupported) {
      return;
    }

    if (!navigator.onLine) {
      // If offline, block until requests are replayed from online event handler
      await this.onlineAndReplayed();
      return;
    }

    if (this.isReplayingRequests.get(this.formKey)) return;

    this.isReplayingRequests.set(this.formKey, true);
    trackUnload();
    try {
      const dbTransaction = await this.getDbTransaction('readwrite');
      if (dbTransaction) {
        const { store } = dbTransaction;

        const allRequests: SerializedRequest[] = await new Promise<
          SerializedRequest[]
        >((resolve) => {
          const requests: SerializedRequest[] = [];
          store.openCursor().onsuccess = (event: Event) => {
            const cursor = (
              event.target as IDBRequest<IDBCursorWithValue | null>
            ).result;
            if (cursor) {
              const request = cursor.value as SerializedRequest;
              request.key = cursor.key;
              if (request.formKey === this.formKey || !request.formKey) {
                requests.push(request);
              }
              cursor.continue();
            } else {
              requests.sort((a, b) => a.timestamp - b.timestamp);
              resolve(requests);
            }
          };
        });

        // Step 1: Process all submit/custom requests in parallel
        const submitRequests = allRequests.filter((req) =>
          ['submit', 'customRequest'].includes(req.type)
        );
        await this.replayRequestsInParallel(submitRequests);

        // Step 2: Process event registrations with step-level ordering
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
      }
    } finally {
      this.isReplayingRequests.set(this.formKey, false);

      // Check if there are any new requests in IndexedDB and trigger replayRequests again
      const requestsInDB = await this.dbHasRequest();
      if (requestsInDB) await this.replayRequests();

      untrackUnload();
      // Release all waiting promises that were blocked on onlineAndReplayed()
      // This allows queued requests in runOrSaveRequest to proceed
      const signals = this.onlineSignals.get(this.formKey) || [];
      signals.forEach((signal) => signal());
      this.onlineSignals.delete(this.formKey);
    }
  }

  private replayRequestsInParallel(requests: SerializedRequest[]) {
    return Promise.all(
      requests.map((request) => {
        const { url, method, headers, body, bodyType, keepalive, key } =
          request;
        const reconstructedBody = this.reconstructBody(body, bodyType);
        const fetchOptions: RequestInit = {
          method,
          headers: JSON.parse(headers),
          body: reconstructedBody,
          cache: 'no-store',
          keepalive: keepalive
        };

        const attemptRequest = async () => {
          let attempts = 0;
          while (attempts < this.maxRetryAttempts) {
            try {
              const response = await fetch(url, fetchOptions);
              await checkResponseSuccess(response);
              await this.removeRequest(key);
              break;
            } catch (error: any) {
              attempts++;
              if (navigator.onLine) {
                const nextDelay = this.getExponentialDelay(attempts);
                // do not wait for delay if already tried max attempts
                if (attempts >= this.maxRetryAttempts) {
                  // Remove failed request from IndexedDB to prevent infinite retry loop
                  await this.removeRequest(key);
                  // Don't show alert for file submissions - they show button errors instead
                  // Only show alert for critical network failures (like losing connection)
                  const isFileSubmission = url.includes('/submit/file/');
                  if (this.errorCallback && !isFileSubmission) {
                    this.errorCallback(
                      `Failed to submit after ${this.maxRetryAttempts} attempts. Please check your connection and try again.`
                    );
                  }
                  return;
                }
                await this.delay(nextDelay);
              } else {
                await this.onlineAndReplayed();
                return;
              }
            }
          }
        };

        return attemptRequest();
      })
    );
  }

  private async removeRequest(key?: IDBValidKey) {
    if (!key) return;
    const dbTransaction = await this.getDbTransaction('readwrite');
    if (dbTransaction) {
      const { store } = dbTransaction;
      await store.delete(key);
    }
  }

  public async clearFailedRequestByUrl(
    url: string,
    options?: { fieldKey?: string }
  ): Promise<void> {
    const matchesRecord = (record: SerializedRequest) => {
      if (record.url !== url || record.formKey !== this.formKey) {
        return false;
      }

      if (!options?.fieldKey) {
        return true;
      }

      return this.recordMatchesFieldKey(record, options.fieldKey);
    };

    return this.deleteRecordsWhere(matchesRecord);
  }

  private recordMatchesFieldKey(
    record: SerializedRequest,
    fieldKey: string
  ): boolean {
    if (this.matchesMetadataField(record, fieldKey)) return true;
    if (this.matchesFormDataField(record, fieldKey)) return true;
    if (this.matchesBlobField(record, fieldKey)) return true;
    return false;
  }

  private matchesMetadataField(
    record: SerializedRequest,
    fieldKey: string
  ): boolean {
    return record.metadata?.fieldKey === fieldKey;
  }

  private matchesFormDataField(
    record: SerializedRequest,
    fieldKey: string
  ): boolean {
    if (record.bodyType !== 'formData') return false;

    const body = record.body as Record<string, any> | undefined;
    return (
      !!body &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, fieldKey)
    );
  }

  private matchesBlobField(
    record: SerializedRequest,
    fieldKey: string
  ): boolean {
    if (record.bodyType !== 'blob') return false;

    try {
      const buffer = record.body as ArrayBuffer;
      const decoded = new TextDecoder().decode(buffer);
      // Escape regex special chars to prevent injection attacks
      const escapedFieldKey = fieldKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fieldPattern = new RegExp(`name=["']${escapedFieldKey}["']`);
      return fieldPattern.test(decoded);
    } catch (error) {
      console.warn('Failed to inspect blob body for field key', error);
      return false;
    }
  }

  public async clearFailedRequestsByStep(stepKey: string): Promise<void> {
    return this.deleteRecordsWhere(
      (record) => record.formKey === this.formKey && record.stepKey === stepKey
    );
  }

  private async deleteRecordsWhere(
    predicate: (record: SerializedRequest) => boolean
  ): Promise<void> {
    if (!this.indexedDBSupported) return;

    const dbTransaction = await this.getDbTransaction('readwrite');
    if (!dbTransaction) return;

    const { store } = dbTransaction;
    const request = store.openCursor();

    return new Promise((resolve) => {
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
          .result;
        if (cursor) {
          const record = cursor.value as SerializedRequest;
          if (predicate(record)) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => {
        console.warn('Error during IndexedDB cursor operation');
        resolve(); // Don't block retry on cleanup failure
      };
    });
  }

  /**
   * Calculates exponential backoff delay with jitter.
   * Pattern: 1s, 2s, 4s, etc.
   */
  private getExponentialDelay(attemptNum: number): number {
    const baseDelay = 1000 * Math.pow(2, attemptNum);
    const jitter = Math.random() * 1000;
    return baseDelay + jitter;
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
