import { useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { featheryWindow, runningInClient } from './browser';
import { fileRetryStatus, initInfo } from './init';
import { withLinkRequestHeaders } from './accessLinkRequest';
import type FeatheryClient from './featheryClient';
import { isInteractionDetected } from './interactionState';
import {
  checkResponseSuccess,
  FormAuthenticationError,
  FormConflictError
} from '@feathery/client-utils';
import {
  handleFormAuthenticationError,
  handleFormConflict
} from './featheryClient/utils';
import {
  completeUpload,
  failUpload,
  queueUpload,
  startUpload
} from './fileUploadProgress';

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

// The server refused the payload itself, so replaying it can never succeed.
// 408 and 429 are retryable server conditions; 409 and 403 are handled apart.
const isRejectedStatus = (status: number) =>
  status >= 400 && status < 500 && ![403, 408, 429].includes(status);

// One user's step snapshot or file field. A newer write to it replaces an older one.
// An upload URL carries the user id, which a stored Request has percent-encoded
// while the live request's URL may not have, so URLs compare decoded
const endpointOf = (url: string) => {
  try {
    return decodeURIComponent(url);
  } catch (error) {
    return url;
  }
};

const writeSlotKey = (
  userId: string | undefined,
  stepKey: string,
  url: string,
  fieldKey?: string
) => JSON.stringify([userId, stepKey, endpointOf(url), fieldKey ?? null]);

// A custom field write, as FeatheryClient._debouncedSubmitCustom builds it:
// JSON values under custom_key_values, and files paired by index with
// file_keys. Unlike a step snapshot it is partial, so it supersedes per field.
const CUSTOM_FIELD_SUBMIT_PATH = 'panel/custom/submit/';

const customFieldKeysOf = (body: FormData): string[] => [
  ...Object.keys(JSON.parse((body.get('custom_key_values') as string) ?? '{}')),
  ...(body.getAll('file_keys') as string[])
];

const withoutCustomFields = (body: FormData, fieldKeys: string[]) => {
  const values = JSON.parse((body.get('custom_key_values') as string) ?? '{}');
  fieldKeys.forEach((fieldKey) => delete values[fieldKey]);
  const files = body.getAll('files');
  const fileKeys = body.getAll('file_keys') as string[];

  const stripped = new FormData();
  body.forEach((value, name) => {
    if (['custom_key_values', 'files', 'file_keys'].includes(name)) return;
    stripped.append(name, value);
  });
  stripped.set('custom_key_values', JSON.stringify(values));
  fileKeys.forEach((fileKey, index) => {
    if (fieldKeys.includes(fileKey)) return;
    stripped.append('files', files[index]);
    stripped.append('file_keys', fileKey);
  });
  return stripped;
};

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
  requireAcknowledgement?: boolean;
}

type LiveWriteCleanup = {
  userId: string | undefined;
  stepKey?: string;
  url: string;
  fieldKey?: string;
  writeOrder: number;
  enqueueOrder: number;
  startedAt: number;
  olderKeys?: IDBValidKey[];
  customFieldKeys?: string[];
};

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
  // Rows queued by older SDK builds have no user
  userId?: string;
  keepalive?: boolean;
  key?: IDBValidKey;
  metadata?: RequestMetadata;
  retryAttempts?: number;
  rejected?: boolean;
  enqueueOrder?: number;
  // Start order of the live write this row was queued from, which only
  // compares between rows of the same page
  writeOrder?: number;
  pageId?: string;
  snapshot?: Request;
}

// The write slot of a queued answer row. A custom field write has no step.
const answerSlotKey = (request: SerializedRequest) =>
  writeSlotKey(
    request.userId,
    request.stepKey ?? '',
    request.url,
    request.metadata?.fieldKey
  );

// The user a row from an SDK build that did not record one was queued for,
// read from its payload: the upload URL, or the fuser_key a step save, custom
// field write or event carries. Undefined when the payload does not say.
const FILE_UPLOAD_USER_PATTERN = /\/panel\/step\/submit\/file\/([^/]+)\//;
const MULTIPART_USER_PATTERN = /name="fuser_key"\r?\n\r?\n([^\r\n]+)/;

const userInBody = (bodyText: string): string | undefined => {
  try {
    return JSON.parse(bodyText).fuser_key || undefined;
  } catch (error) {
    // Not JSON, so a multipart custom field write
    return MULTIPART_USER_PATTERN.exec(bodyText)?.[1];
  }
};

const queuedUserOf = (request: SerializedRequest): string | undefined => {
  try {
    const uploadUser = FILE_UPLOAD_USER_PATTERN.exec(request.url)?.[1];
    if (uploadUser) return endpointOf(uploadUser);
    if (request.bodyType === 'formData')
      return (request.body as Record<string, any>).fuser_key || undefined;
    if (request.bodyType === 'text') return userInBody(request.body as string);
    if (typeof TextDecoder === 'undefined') return undefined;
    return userInBody(new TextDecoder().decode(request.body as ArrayBuffer));
  } catch (error) {
    // An unreadable legacy payload must not prevent the rest of the queue loading.
    return undefined;
  }
};

/**
 * How a replayed row ended: 'settled' left the queue with nothing for the user
 * to do (accepted, or dropped because the page moves on: a form version
 * conflict reloads it, a revoked link closes the form), 'rejected' was refused
 * by the server and retained until replaced, and 'queued' stays for a later retry.
 */
type ReplayOutcome = 'settled' | 'rejected' | 'queued';

const REJECTED_ANSWERS_MESSAGE =
  'Some answers could not be saved. Please correct them or choose whether to discard them when completing the form.';

const rejectedAnswersMessage = (request: SerializedRequest) =>
  request.stepKey
    ? `Some answers from step "${request.stepKey}" could not be saved. Please go back and submit that step again.`
    : REJECTED_ANSWERS_MESSAGE;

/**
 * Completing the form is refused while the user still has answers queued, or
 * answers the server rejected that were not submitted again, because the
 * server would act on the submission without them.
 */
export class AnswersPendingError extends Error {
  constructor(
    message = 'Some answers are still being saved. Please try again.'
  ) {
    super(message);
    this.name = 'AnswersPendingError';
    Object.setPrototypeOf(this, AnswersPendingError.prototype);
  }
}

/**
 * runOrSaveRequest resolves with this when a write fails after a newer write to
 * the same step snapshot or file field has landed. Nothing was lost, so the
 * caller keeps the newer write's outcome.
 */
export const SUPERSEDED_WRITE = Symbol('superseded write');

let _connectivityCache: { online: boolean; timestamp: number } | null = null;
let _connectivityProbe: Promise<boolean> | null = null;
const CONNECTIVITY_CACHE_TTL_MS = 3_000;

/**
 * navigator.onLine can return false negatives in some browsers/environments.
 * When it reports offline, probe the network directly before trusting it.
 * Results are cached for 3 s and concurrent calls share one in-flight probe.
 */
export async function verifyConnectivity(): Promise<boolean> {
  if (navigator.onLine) return true;

  const now = Date.now();
  if (
    _connectivityCache &&
    now - _connectivityCache.timestamp < CONNECTIVITY_CACHE_TTL_MS
  ) {
    return _connectivityCache.online;
  }

  if (!_connectivityProbe) {
    _connectivityProbe = (async (timeoutMs = 5000) => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        await fetch('https://www.google.com/generate_204', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        _connectivityCache = { online: true, timestamp: Date.now() };
        return true;
      } catch {
        _connectivityCache = { online: false, timestamp: Date.now() };
        return false;
      }
    })().finally(() => {
      _connectivityProbe = null;
    });
  }

  return _connectivityProbe;
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

export const markFileUploadRetrySuccess = (
  fieldKey?: string,
  formKey?: string
) => {
  if (!fieldKey) return;
  fileRetryStatus[fieldKey] = true;
  if (formKey) completeUpload(formKey, fieldKey);
};

export const markFileUploadRetryFailure = (
  fieldKey?: string,
  formKey?: string
) => {
  if (!fieldKey) return;
  fileRetryStatus[fieldKey] = false;
  if (formKey) failUpload(formKey, fieldKey);
};

export function useOfflineRequestHandler(client: FeatheryClient) {
  useEffect(() => {
    if (!runningInClient() || !client) return;

    const handleOnline = () =>
      client.offlineRequestHandler.replayRequests().catch((error) => {
        console.warn('Error replaying saved answers', error);
      });
    handleOnline();
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
  private hasOpenedDatabase = false;
  private errorCallback?: (error: string) => void;
  private memoryRequests = new Map<IDBValidKey, SerializedRequest>();
  private enqueueOrder = 0;
  // Start order of live writes, and per write slot the newest one the server
  // acknowledged, so an older write that fails afterwards is not queued
  private writeOrder = 0;
  // Write orders restart on every page load, and another tab has its own
  private readonly pageId = uuidv4();
  private acknowledgedWriteOrder = new Map<string, number>();
  // A successful HTTP write must not be sent again just because local cleanup
  // failed. Keep it here until queue reconciliation succeeds on this page.
  private acknowledgedRequestKeys = new Set<IDBValidKey>();
  private pendingLiveWriteCleanups = new Map<number, LiveWriteCleanup>();
  private reconcilingLiveWrites?: Promise<void>;
  // Live writes in flight per write slot. A replay leaves that slot's queued
  // rows alone meanwhile: the live write supersedes them if it lands and
  // queues behind them if it does not.
  private liveWriteSlots = new Map<string, number>();
  private isReplayingConnectorRequests = false;
  // Rows the link gate refused for another submission wait until that user
  // becomes current, so an unknown identity during init cannot park its own writes.
  private parkedRequestKeys = new Set<IDBValidKey>();
  // Cache even unsuccessful attribution: large legacy bodies are decoded at
  // most once per row per page, while rows arriving from other tabs are adopted too.
  private legacyUserIds = new Map<IDBValidKey, string | undefined>();

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
  public async dbHasRequest(type?: string): Promise<boolean> {
    return (await this.readQueuedRequests()).some(
      (request) => !type || request.type === type
    );
  }

  // Whether the current user still has an answer write queued, optionally for
  // one step. Rows from another user of a shared device, or from SDK builds
  // that did not record the user, still replay but never hold this user back.
  public async hasQueuedAnswerWrite(stepKey?: string): Promise<boolean> {
    const { userId } = initInfo();
    if (!userId) return false;
    const queuedRequests = await this.readQueuedRequests();
    return queuedRequests.some(
      (request) =>
        request.type === 'submit' &&
        request.userId === userId &&
        (stepKey === undefined || request.stepKey === stepKey)
    );
  }

  public async hasRejectedFileWrite(stepKey: string, fieldKey: string) {
    return (await this.readQueuedRequests()).some(
      (request) =>
        request.type === 'submit' &&
        request.rejected &&
        this.isCurrentUsersRequest(request) &&
        request.stepKey === stepKey &&
        request.url.includes('/panel/step/submit/file/') &&
        this.recordMatchesFieldKey(request, fieldKey)
    );
  }

  // A manual step submission is the user's retry, so every answer write they
  // still have queued for this form gets a fresh retry budget.
  public async resetAnswerWriteRetries(): Promise<void> {
    const { userId } = initInfo();
    if (!userId) return;
    // Reading the queue attributes rows from older SDK builds to their user
    await this.readQueuedRequests();
    await this.updateRecordsWhere(
      (record) =>
        record.formKey === this.formKey &&
        record.type === 'submit' &&
        record.userId === userId,
      (record) => ({ ...record, retryAttempts: 0 })
    );
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
      this.hasOpenedDatabase = true;
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
   *
   * Resolves with run()'s response, or undefined when the request was
   * queued offline instead of executed. onQueued fires in that queued case —
   * a falsy response doesn't imply it, since run() also resolves undefined on
   * auth and conflict failures that no replay will ever report.
   */
  public async runOrSaveRequest(
    run: any,
    url: string,
    options: any,
    type: string,
    stepKey?: string,
    metadata?: RequestMetadata,
    onQueued?: () => void
  ): Promise<any> {
    if (await verifyConnectivity()) {
      // Prevent page unload while processing requests to avoid data loss
      trackUnload();
      try {
        const isCompletion =
          type === 'registerEvent' && !!metadata?.requireAcknowledgement;
        let queuedEvent = false;
        try {
          if (this.indexedDBSupported || this.memoryRequests.size) {
            // Completing is the user's manual retry, as a step submission is, so
            // a completion that submits no step still retries exhausted answers
            if (isCompletion) await this.resetAnswerWriteRetries();
            const wasReplaying = !!this.isReplayingRequests.get(this.formKey);
            // Replay already in progress, wait for it to complete
            if (wasReplaying) await this.onlineAndReplayed();
            // A replay that was already running may have passed rows before their
            // budgets were reset, so a completion replays once more
            if (
              (!wasReplaying || isCompletion) &&
              (this.hasUnreconciledLiveWrite(initInfo().userId) ||
                (await this.hasReplayableRequest({ includeConnectors: true })))
            ) {
              await this.replayRequests({ isUserWaiting: isCompletion });
            }
          }
          if (type === 'registerEvent') {
            // A terminal event needs every answer acknowledged first. It is
            // refused rather than queued so its side effects cannot fire twice.
            if (isCompletion) {
              await this.confirmRejectedAnswers();
              if (await this.hasQueuedAnswerWrite()) {
                throw new AnswersPendingError();
              }
            } else if (
              stepKey &&
              (await this.hasQueuedAnswerWrite(stepKey)) &&
              (await this.saveRequest(url, options, type, stepKey, metadata))
            ) {
              // The step's answers are still queued, so its event follows them on
              // replay. Without storage to hold it, the event is sent now instead.
              queuedEvent = true;
            }
          }
        } catch (error) {
          if (isCompletion) throw error;
          // An unreadable queue cannot prevent this step's answers being sent.
          // Completion still requires a successful read of every pending answer.
          console.warn('Error preparing saved requests', error);
        }
        if (queuedEvent) {
          onQueued?.();
          return;
        }
        const { userId } = initInfo();
        const writeSlot =
          type === 'submit' && stepKey
            ? writeSlotKey(userId, stepKey, url, metadata?.fieldKey)
            : undefined;
        // Without override the server may keep the values it already has, so
        // only an overriding custom field write supersedes older queued values
        const isCustomFieldWrite =
          type === 'submit' &&
          !stepKey &&
          url.includes(CUSTOM_FIELD_SUBMIT_PATH) &&
          options.body instanceof FormData &&
          options.body.get('override') !== 'false';
        const customFieldKeys = isCustomFieldWrite
          ? customFieldKeysOf(options.body)
          : undefined;
        const writeOrder = ++this.writeOrder;
        const enqueueOrder = this.enqueueOrder;
        const startedAt = Date.now();
        // Only rows already queued when this write starts can be superseded.
        // A concurrent save may queue a newer answer while this request is in flight.
        let olderKeys: IDBValidKey[] | undefined;
        try {
          if (writeSlot && stepKey)
            olderKeys = await this.getFailedStepRequestKeys(
              stepKey,
              url,
              metadata
            );
          if (isCustomFieldWrite)
            olderKeys = await this.getQueuedCustomFieldWriteKeys(url);
        } catch (error) {
          console.warn('Error reading older saved answers', error);
        }
        let response;
        if (writeSlot)
          this.liveWriteSlots.set(
            writeSlot,
            (this.liveWriteSlots.get(writeSlot) ?? 0) + 1
          );
        try {
          response = await run();
        } catch (e) {
          const errorToThrow = e;
          // A newer write to the same step snapshot or file field has already
          // landed. Queuing this older one would revert it, and its failure
          // loses nothing.
          const isOutdated =
            !!writeSlot &&
            (this.acknowledgedWriteOrder.get(writeSlot) ?? 0) > writeOrder;
          if (isOutdated) {
            return SUPERSEDED_WRITE;
          }
          // TypeError indicates network connectivity issues
          // This catches scenarios like timeouts, resolution failures, etc.
          if (e instanceof TypeError && !metadata?.requireAcknowledgement) {
            await this.saveRequest(
              url,
              options,
              type,
              stepKey,
              metadata,
              writeOrder
            );
            onQueued?.();
            // Don't immediately trigger replay - this can cause infinite loops
            // when the same request keeps failing. Instead, rely on:
            // 1. The 'online' event listener to trigger replay when connectivity returns
            // 2. The next user action (button click) to attempt submission again
            // 3. The replayRequests() recursion check at the end of replay cycle
          }
          throw errorToThrow; // Re-throw error so caller knows submission failed
        } finally {
          if (writeSlot)
            this.liveWriteSlots.set(
              writeSlot,
              (this.liveWriteSlots.get(writeSlot) ?? 1) - 1
            );
        }
        if (metadata?.requireAcknowledgement && !response) {
          throw new Error(
            'The submission could not be completed. Please try again.'
          );
        }
        if (response && (writeSlot || isCustomFieldWrite)) {
          const savedSlot =
            writeSlot ?? writeSlotKey(userId, '', url, metadata?.fieldKey);
          this.acknowledgedWriteOrder.set(
            savedSlot,
            Math.max(
              writeOrder,
              this.acknowledgedWriteOrder.get(savedSlot) ?? 0
            )
          );
          this.pendingLiveWriteCleanups.set(writeOrder, {
            userId,
            stepKey,
            url,
            fieldKey: metadata?.fieldKey,
            writeOrder,
            enqueueOrder,
            startedAt,
            olderKeys,
            customFieldKeys
          });
          try {
            await this.reconcileLiveWriteCleanups();
          } catch (error) {
            // The server already accepted this write. Retry only local cleanup
            // before replay, so neither the upload nor an older answer is resent.
            console.warn('Error reconciling saved answers', error);
          }
        }
        return response;
      } finally {
        untrackUnload();
      }
    } else {
      if (metadata?.requireAcknowledgement) throw new AnswersPendingError();
      await this.saveRequest(url, options, type, stepKey, metadata);
      onQueued?.();
    }
  }

  // Resolves whether the request was queued. Without working IndexedDB only
  // answer writes are kept, in memory for the life of this page.
  public async saveRequest(
    url: string,
    options: any,
    type: string,
    stepKey?: string,
    metadata?: RequestMetadata,
    writeOrder?: number
  ): Promise<boolean> {
    const { sdkKey, userId } = initInfo();
    options.headers = { ...options.headers, Authorization: `Token ${sdkKey}` };
    const request = new Request(url, options);
    const enqueueOrder = ++this.enqueueOrder;
    const timestamp = Date.now();
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const keepalive =
      request.keepalive !== undefined
        ? request.keepalive
        : ['POST', 'PATCH', 'PUT'].includes(request.method);

    // A storage failure must not discard a failed write or unblock completion.
    // The immutable Request snapshot survives manual retry within this page;
    // unlike IndexedDB, this fallback cannot survive a reload.
    const retainWrite = () => {
      if (type !== 'submit') return false;
      const key = `memory:${enqueueOrder}`;
      this.memoryRequests.set(key, {
        key,
        formKey: this.formKey,
        url: request.url,
        method: request.method,
        headers: JSON.stringify(headers),
        body: '',
        bodyType: 'text',
        timestamp,
        enqueueOrder,
        type,
        stepKey,
        userId,
        writeOrder,
        pageId: this.pageId,
        keepalive,
        metadata,
        retryAttempts: 0,
        snapshot: request.clone()
      });
      return true;
    };
    if (!this.indexedDBSupported) return retainWrite();

    try {
      const requestClone: Request = request.clone();
      let serializedBody: SerializedRequestBody = { type: 'text', body: '' };

      if (requestClone.method !== 'GET' && requestClone.method !== 'HEAD') {
        serializedBody = await requestClone
          .blob()
          .then(this.serializeRequestBody);
      }

      const serializedRequest: SerializedRequest = {
        formKey: this.formKey,
        url: requestClone.url,
        method: requestClone.method,
        headers: JSON.stringify(headers),
        body: serializedBody.body,
        bodyType: serializedBody.type,
        timestamp,
        enqueueOrder,
        type,
        stepKey,
        userId,
        writeOrder,
        pageId: this.pageId,
        keepalive,
        metadata,
        retryAttempts: 0
      };

      const dbTransaction = await this.getDbTransaction('readwrite');
      if (!dbTransaction) return retainWrite();
      const { tx, store } = dbTransaction;
      const requestPromise = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        // A quota failure aborts the transaction at commit without an error event
        tx.onabort = () => reject(tx.error);
      });
      store.add(serializedRequest);
      await requestPromise;
      return true;
    } catch (error) {
      console.warn('Error saving request', error);
      return retainWrite();
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
   * Step 1: Answer writes, oldest first. A user's writes apply in order, so the
   *          first one that stays queued holds back that user's later writes.
   * Step 2: Event registrations whose step has no answer write still queued for
   *          the same user - grouped by step and executed sequentially by step,
   *          but in parallel within each step to maintain event ordering per form step
   * Step 3: Connector requests, best effort, once the answers have been sent
   *
   * When the user is waiting on the replay to complete the form, each row gets
   * one immediate attempt, so a refusal comes back at once instead of after
   * the retry backoff.
   */
  public async replayRequests({
    isUserWaiting = false
  }: { isUserWaiting?: boolean } = {}) {
    if (!this.indexedDBSupported && !this.memoryRequests.size) {
      return;
    }

    if (!(await verifyConnectivity())) {
      // If offline, block until requests are replayed from online event handler
      await this.onlineAndReplayed();
      return;
    }

    // Wait for the replay already running rather than return at once: the
    // caller is about to send a write that must land after the older ones
    if (this.isReplayingRequests.get(this.formKey)) {
      await this.onlineAndReplayed();
      return;
    }

    this.isReplayingRequests.set(this.formKey, true);
    trackUnload();
    // Declared outside the try block: Babel's block scoping fails to compile
    // the event loop below when it captures a const declared inside it
    const reportError = this.createReplayErrorReporter();
    const acknowledgedBeforeReplay = new Map(this.acknowledgedWriteOrder);
    try {
      await this.reconcileLiveWriteCleanups();
      const queuedRequests = await this.readQueuedRequests();

      // Two offline step snapshots may contain different values for the same
      // field; allowing the older request to finish last would restore stale
      // answers. Another user's stuck write on a shared device holds back only
      // that user's writes.
      const heldWrites: SerializedRequest[] = [];
      let hasRejectedWrite = false;
      for (const write of queuedRequests.filter(
        (request) => request.type === 'submit'
      )) {
        const slot = answerSlotKey(write);
        if (
          heldWrites.some((held) => held.userId === write.userId) ||
          this.hasUnreconciledLiveWrite(write.userId) ||
          this.isWriteSlotLive(write) ||
          // A live save may finish after this replay took its queue snapshot.
          // Its cleanup owns those stale rows; the next replay reads fresh ones.
          (this.acknowledgedWriteOrder.get(slot) ?? 0) >
            (acknowledgedBeforeReplay.get(slot) ?? 0)
        ) {
          heldWrites.push(write);
          continue;
        }
        const wasRejected = write.rejected;
        const outcome = await this.replayRequest(write, {
          isUserWaiting,
          reportError
        });
        if (outcome === 'queued') heldWrites.push(write);
        if (
          outcome === 'rejected' &&
          !wasRejected &&
          this.isCurrentUsersRequest(write)
        ) {
          hasRejectedWrite = true;
        }
      }
      // Rejected rows block their step's events, but must not block a later
      // corrected answer from replaying. Read again after those corrections land.
      const pendingWrites = (await this.readQueuedRequests()).filter(
        (request) => request.type === 'submit'
      );
      const rejectedWrite = pendingWrites.find(
        (request) => request.rejected && this.isCurrentUsersRequest(request)
      );
      // A user waiting to complete gets this as the completion's refusal
      if (hasRejectedWrite && rejectedWrite && !isUserWaiting)
        reportError(rejectedAnswersMessage(rejectedWrite));

      // An event for a step whose answers are still queued would let the
      // server act on that step without its data
      const isHeldByWrite = (event: SerializedRequest) =>
        this.hasUnreconciledLiveWrite(event.userId) ||
        (!!event.stepKey &&
          pendingWrites.some(
            (write) =>
              write.stepKey === event.stepKey && write.userId === event.userId
          ));
      const registerEventRequests = queuedRequests.filter(
        (request) => request.type === 'registerEvent' && !isHeldByWrite(request)
      );
      const stepKeys = Array.from(
        new Set(registerEventRequests.map((req) => req.stepKey))
      );

      for (const stepKey of stepKeys) {
        const requestsForStep = registerEventRequests.filter(
          (req) => req.stepKey === stepKey
        );
        await Promise.all(
          requestsForStep.map((request) =>
            this.replayRequest(request, { isUserWaiting, reportError })
          )
        );
      }

      // A connector call is not an answer. It replays in the background, so a
      // failing third-party request cannot hold back writes, events or completion.
      this.replayConnectorRequests(
        queuedRequests.filter((request) => request.type === 'customRequest')
      ).catch((error) =>
        console.warn('Error replaying connector requests', error)
      );
    } finally {
      this.isReplayingRequests.set(this.formKey, false);
      untrackUnload();
      // Release all waiting promises that were blocked on onlineAndReplayed()
      // This allows queued requests in runOrSaveRequest to proceed. They are
      // released before any follow-up replay, which they do not wait on.
      const signals = this.onlineSignals.get(this.formKey) || [];
      signals.forEach((signal) => signal());
      this.onlineSignals.delete(this.formKey);
    }

    // Pick up requests queued during this replay. A write that is still
    // queued waits for the next manual submission or reconnect instead, so a
    // failing write cannot spin here. A user waiting to complete is not held
    // for that.
    if (
      !isUserWaiting &&
      (await this.hasReplayableRequest()) &&
      !(await this.dbHasRequest('submit'))
    )
      await this.replayRequests();
  }

  // Each failure message reaches the user once per replay
  private createReplayErrorReporter() {
    const reportedErrors = new Set<string>();
    return (message: string) => {
      if (reportedErrors.has(message)) return;
      reportedErrors.add(message);
      this.errorCallback?.(message);
    };
  }

  private async replayConnectorRequests(
    connectorRequests: SerializedRequest[]
  ): Promise<void> {
    // A connector replay still in flight owns these rows. Sending them again
    // would call the third party twice.
    if (this.isReplayingConnectorRequests || !connectorRequests.length) return;
    this.isReplayingConnectorRequests = true;
    try {
      await Promise.all(
        connectorRequests.map((request) => this.replayRequest(request))
      );
    } finally {
      this.isReplayingConnectorRequests = false;
    }
  }

  private isCurrentUsersRequest(request: SerializedRequest): boolean {
    const { userId } = initInfo();
    return !!userId && request.userId === userId;
  }

  private isParked(request: SerializedRequest): boolean {
    if (request.key === undefined || !this.parkedRequestKeys.has(request.key))
      return false;
    if (this.isCurrentUsersRequest(request)) {
      this.parkedRequestKeys.delete(request.key);
      return false;
    }
    return true;
  }

  private isWriteSlotLive(request: SerializedRequest): boolean {
    if (request.type !== 'submit' || !request.stepKey) return false;
    return (this.liveWriteSlots.get(answerSlotKey(request)) ?? 0) > 0;
  }

  private async replayRequest(
    request: SerializedRequest,
    {
      isUserWaiting = false,
      reportError
    }: {
      isUserWaiting?: boolean;
      reportError?: (message: string) => void;
    } = {}
  ): Promise<ReplayOutcome> {
    const { url, method, headers, body, bodyType, keepalive, key } = request;
    const report =
      reportError ?? ((message: string) => this.errorCallback?.(message));
    if (request.rejected) {
      if (this.isCurrentUsersRequest(request))
        markFileUploadRetryFailure(request.metadata?.fieldKey, this.formKey);
      return 'rejected';
    }
    if (this.isParked(request)) return 'queued';
    if (key !== undefined && this.acknowledgedRequestKeys.has(key)) {
      await this.removeAcceptedRequest(request);
      return 'settled';
    }
    const fetchOptions: RequestInit = {
      method,
      headers: JSON.parse(headers),
      body: this.reconstructBody(body, bodyType),
      cache: 'no-store',
      keepalive: keepalive
    };
    let attempts = request.retryAttempts ?? 0;
    // Upload status is keyed by field alone and alerts reach whoever is at the
    // device, so only the current user's rows report. Another user's rows, rows
    // from older SDK builds and connector calls replay quietly.
    const isCurrentUsersRow = this.isCurrentUsersRequest(request);
    const fieldKey = isCurrentUsersRow ? request.metadata?.fieldKey : undefined;
    // A file upload surfaces its own retry error, so it does not alert
    const alertsOnExhaustion =
      isCurrentUsersRow &&
      !request.metadata?.fieldKey &&
      request.type !== 'customRequest';

    // Ensure exhausted retries are marked as failed before being skipped
    if (attempts >= this.maxRetryAttempts && !request.snapshot) {
      markFileUploadRetryFailure(fieldKey, this.formKey);
      return 'queued';
    }

    // Surface replayed file uploads (e.g. after a reload) in the
    // progress toast; no-ops unless the form's setting is on
    if (fieldKey && url.includes('panel/step/submit/file'))
      startUpload(this.formKey, fieldKey);

    while (attempts < this.maxRetryAttempts || request.snapshot) {
      let response: Response | undefined;
      try {
        if (request.snapshot) {
          fetchOptions.body = await request.snapshot.clone().blob();
        }
        // The queued headers predate the link gate - they were captured
        // before _fetch attached the header, and a replay can outlive the
        // page that queued them. The link this device holds now is the
        // one the submission is open under, so it wins over the snapshot.
        response = await fetch(url, withLinkRequestHeaders(url, fetchOptions));
        await checkResponseSuccess(response);
      } catch (error: any) {
        if (error instanceof FormConflictError) {
          // The page reloads onto the new form version. This payload carries
          // the old version and would conflict again after every reload.
          handleFormConflict();
          markFileUploadRetrySuccess(fieldKey, this.formKey);
          await this.removeRequest(key);
          return 'settled';
        }
        // A 403 that is not the access check answering (a firewall or proxy
        // page the client cannot parse) is retried like any server failure
        if (error instanceof FormAuthenticationError) {
          // The link gate refuses another submission's row when this device's
          // link now opens a different one. The row waits for a device that
          // can send it, without spending retries or alerting.
          if (!isCurrentUsersRow) {
            if (key !== undefined) this.parkedRequestKeys.add(key);
            return 'queued';
          }
          // This submission's own link expired or was revoked after the row
          // was queued. Close the form as a live request does; the row can
          // never be sent.
          handleFormAuthenticationError(error.message);
          await this.removeRequest(key);
          return 'settled';
        }
        if (response && isRejectedStatus(response.status)) {
          markFileUploadRetryFailure(fieldKey, this.formKey);
          if (request.type === 'submit') {
            await this.updateRequest(key, (record) => {
              record.rejected = true;
            });
          } else await this.removeRequest(key);
          return 'rejected';
        }
        attempts++;
        await this.updateRetryAttempts(key, attempts);
        // Storage fallback makes one bounded attempt per replay cycle, as does
        // a replay the user is waiting on. A later manual action or reconnect
        // can retry the row.
        if (request.snapshot || isUserWaiting) {
          markFileUploadRetryFailure(fieldKey, this.formKey);
          return 'queued';
        }

        if (await verifyConnectivity()) {
          const nextDelay = this.getExponentialDelay(attempts);
          if (attempts >= this.maxRetryAttempts) {
            if (alertsOnExhaustion) {
              report(
                `Failed to submit after ${this.maxRetryAttempts} attempts. Please check your connection and try again.`
              );
            }
            markFileUploadRetryFailure(fieldKey, this.formKey);
            return 'queued';
          }
          await this.delay(nextDelay);
        } else {
          // Connectivity dropped again. The row goes back to waiting
          // rather than spinning for as long as the user stays offline;
          // the next replay re-announces it as uploading.
          if (fieldKey) queueUpload(this.formKey, fieldKey);
          // Release the replay owner before the online event retries.
          return 'queued';
        }
        continue;
      }
      markFileUploadRetrySuccess(fieldKey, this.formKey);
      if (key !== undefined) this.acknowledgedRequestKeys.add(key);
      // Queue failures propagate separately from HTTP failures. A retry only
      // reconciles this acknowledged row; it cannot repeat an upload or append.
      await this.removeAcceptedRequest(request);
      return 'settled';
    }
    return 'queued';
  }

  // Every queued row for this form, durable and in memory, oldest first. Rows
  // without a form key predate per-form queues and replay with every form.
  private async readQueuedRequests(): Promise<SerializedRequest[]> {
    const queuedRequests = [...this.memoryRequests.values()];
    const dbTransaction = this.indexedDBSupported
      ? await this.getDbTransaction('readonly')
      : undefined;
    // Storage becoming temporarily unavailable must not erase a known durable
    // queue. Browsers that never allowed IndexedDB still use the memory fallback.
    if (!dbTransaction && this.indexedDBSupported && this.hasOpenedDatabase)
      throw new AnswersPendingError(
        'Saved answers could not be read. Please try again.'
      );
    if (dbTransaction) {
      const adoptedUsers = new Map<IDBValidKey, string>();
      const persistedRequests = await new Promise<SerializedRequest[]>(
        (resolve, reject) => {
          const requests: SerializedRequest[] = [];
          const failRead = () =>
            reject(
              new AnswersPendingError(
                'Saved answers could not be read. Please try again.'
              )
            );
          dbTransaction.tx.onerror = failRead;
          dbTransaction.tx.onabort = failRead;
          dbTransaction.tx.oncomplete = () => resolve(requests);
          const cursorRequest = dbTransaction.store.openCursor();
          cursorRequest.onsuccess = (event: Event) => {
            const cursor = (
              event.target as IDBRequest<IDBCursorWithValue | null>
            ).result;
            if (!cursor) return;
            const storedRequest = cursor.value as SerializedRequest;
            if (
              storedRequest.formKey === this.formKey ||
              !storedRequest.formKey
            ) {
              if (
                !storedRequest.userId &&
                !this.legacyUserIds.has(cursor.key)
              ) {
                const userId = queuedUserOf(storedRequest);
                this.legacyUserIds.set(cursor.key, userId);
              }
              const legacyUserId = storedRequest.userId
                ? undefined
                : this.legacyUserIds.get(cursor.key);
              const request = legacyUserId
                ? { ...storedRequest, userId: legacyUserId }
                : storedRequest;
              if (legacyUserId) adoptedUsers.set(cursor.key, legacyUserId);
              requests.push({ ...request, key: cursor.key });
            }
            cursor.continue();
          };
          cursorRequest.onerror = failRead;
        }
      );
      for (const [key, userId] of adoptedUsers) {
        try {
          await this.updateRequest(key, (record) => {
            if (!record.userId) record.userId = userId;
          });
        } catch (error) {
          // Attribution is still available in memory when storage cannot persist it.
          console.warn('Error attributing a queued request', error);
        }
      }
      queuedRequests.push(...persistedRequests);
    }
    return queuedRequests.sort(
      (a, b) =>
        a.timestamp - b.timestamp ||
        (a.enqueueOrder ?? 0) - (b.enqueueOrder ?? 0)
    );
  }

  private async removeRequest(key?: IDBValidKey) {
    if (!key) return;
    if (this.memoryRequests.delete(key)) return;
    const dbTransaction = await this.getDbTransaction('readwrite');
    if (!dbTransaction)
      throw new AnswersPendingError(
        'Saved answers could not be updated. Please try again.'
      );
    const { tx, store } = dbTransaction;
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      store.delete(key);
    });
  }

  private async confirmRejectedAnswers() {
    const { userId } = initInfo();
    if (!userId) return;
    const writes = (await this.readQueuedRequests()).filter(
      (request) => request.type === 'submit' && request.userId === userId
    );
    const rejected = writes.filter((request) => request.rejected);
    if (!rejected.length) return;
    // A connection failure is still recoverable; it never offers a discard.
    if (writes.some((request) => !request.rejected))
      throw new AnswersPendingError();
    const affected = new Set(
      rejected.map((request) =>
        request.metadata?.fieldKey
          ? `File field "${request.metadata.fieldKey}"`
          : request.stepKey
          ? `Step "${request.stepKey}"`
          : 'Custom or hidden fields'
      )
    );
    const message =
      `The server rejected answers for:\n${[...affected].join('\n')}\n\n` +
      'These answers have not been saved. Press OK to discard these rejected answers and continue completing the form. Press Cancel to keep them and return to the form.';
    if (!featheryWindow().confirm?.(message))
      throw new AnswersPendingError(rejectedAnswersMessage(rejected[0]));
    if (initInfo().userId !== userId) throw new AnswersPendingError();
    const keys = new Set(rejected.map((request) => request.key));
    await this.deleteRecordsWhere(
      (record, key) =>
        keys.has(key) &&
        record.type === 'submit' &&
        !!record.rejected &&
        (record.formKey === this.formKey || !record.formKey) &&
        (record.userId ?? this.legacyUserIds.get(key)) === userId
    );
    // Release events that waited for the discarded answers before completion.
    await this.replayRequests({ isUserWaiting: true });
    if (initInfo().userId !== userId) throw new AnswersPendingError();
  }

  private async removeAcceptedRequest(request: SerializedRequest) {
    if (request.type === 'submit')
      await this.removeSupersededRejectedWrites(request);
    await this.removeRequest(request.key);
    if (request.key !== undefined)
      this.acknowledgedRequestKeys.delete(request.key);
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

  // The current user's queued writes that a successful write of the same step
  // snapshot, or of the same file field, supersedes.
  private async getFailedStepRequestKeys(
    stepKey: string,
    url: string,
    metadata?: RequestMetadata
  ): Promise<IDBValidKey[]> {
    const { userId } = initInfo();
    const queuedRequests = await this.readQueuedRequests();
    return queuedRequests
      .filter(
        (request) =>
          request.formKey === this.formKey &&
          request.type === 'submit' &&
          request.stepKey === stepKey &&
          endpointOf(request.url) === endpointOf(url) &&
          request.userId === userId &&
          request.metadata?.fieldKey === metadata?.fieldKey
      )
      .map((request) => request.key)
      .filter((key): key is IDBValidKey => key !== undefined);
  }

  private async removeRequests(keys: IDBValidKey[]): Promise<void> {
    return this.deleteRecordsWhere((_record, key) => keys.includes(key));
  }

  // A live write can succeed while storage is unavailable. Reconcile its older
  // queued values before any replay, without turning cleanup into an HTTP failure.
  private async reconcileLiveWriteCleanups(): Promise<void> {
    while (this.hasUnreconciledLiveWrite(initInfo().userId)) {
      if (this.reconcilingLiveWrites) {
        await this.reconcilingLiveWrites;
        continue;
      }
      this.reconcilingLiveWrites = (async () => {
        // A later save with a readable queue can resolve an earlier ambiguous row.
        for (const [order, savedWrite] of [
          ...this.pendingLiveWriteCleanups
        ].reverse()) {
          if (savedWrite.userId !== initInfo().userId) continue;
          const queuedRequests = await this.readQueuedRequests();
          // Identity may change while IndexedDB is loading. Leave that user's
          // cleanup and queued rows together until they return.
          if (savedWrite.userId !== initInfo().userId) continue;
          const olderKeys = queuedRequests
            .filter((request) => {
              if (
                request.formKey !== this.formKey ||
                request.type !== 'submit' ||
                request.userId !== savedWrite.userId ||
                request.stepKey !== savedWrite.stepKey ||
                endpointOf(request.url) !== endpointOf(savedWrite.url) ||
                request.metadata?.fieldKey !== savedWrite.fieldKey
              )
                return false;
              if (
                request.key !== undefined &&
                savedWrite.olderKeys?.includes(request.key)
              )
                return true;
              // A previously started live write can fail after this one succeeds.
              // Other tabs have independent orders; keep their newer queued values.
              if (
                request.pageId === this.pageId &&
                request.writeOrder !== undefined
              )
                return request.writeOrder < savedWrite.writeOrder;
              if (
                request.pageId === this.pageId &&
                request.enqueueOrder !== undefined
              )
                return request.enqueueOrder <= savedWrite.enqueueOrder;
              if (savedWrite.olderKeys !== undefined) return false;
              // A failed read leaves no ordering evidence for another tab's row
              // in the same clock tick. Keep it until a scoped resubmission can
              // read and supersede it, instead of guessing and losing an answer.
              if (request.timestamp === savedWrite.startedAt)
                throw new AnswersPendingError(
                  savedWrite.stepKey
                    ? `Some answers from step "${savedWrite.stepKey}" need to be submitted again. Please go back and submit that step.`
                    : 'Some saved answers need to be submitted again. Please resubmit your answers.'
                );
              return request.timestamp < savedWrite.startedAt;
            })
            .map((request) => request.key)
            .filter((key): key is IDBValidKey => key !== undefined);
          if (olderKeys.length) {
            if (savedWrite.customFieldKeys)
              await this.stripSavedCustomFields(
                olderKeys,
                savedWrite.customFieldKeys
              );
            else await this.removeRequests(olderKeys);
          }
          this.pendingLiveWriteCleanups.delete(order);
        }
      })();
      try {
        await this.reconcilingLiveWrites;
      } finally {
        this.reconcilingLiveWrites = undefined;
      }
    }
  }

  private hasUnreconciledLiveWrite(userId: string | undefined): boolean {
    return [...this.pendingLiveWriteCleanups.values()].some(
      (write) => write.userId === userId
    );
  }

  private async getQueuedCustomFieldWriteKeys(
    url: string
  ): Promise<IDBValidKey[]> {
    const queuedRequests = await this.readQueuedRequests();
    return queuedRequests
      .filter(
        (request) =>
          request.formKey === this.formKey &&
          request.type === 'submit' &&
          !request.stepKey &&
          endpointOf(request.url) === endpointOf(url) &&
          this.isCurrentUsersRequest(request)
      )
      .map((request) => request.key)
      .filter((key): key is IDBValidKey => key !== undefined);
  }

  private async removeSupersededRejectedWrites(
    savedRequest: SerializedRequest
  ): Promise<void> {
    const queuedRequests = await this.readQueuedRequests();
    const savedIndex = queuedRequests.findIndex(
      (request) => request.key === savedRequest.key
    );
    if (savedIndex < 0) return;
    const olderRejectedWrites = queuedRequests
      .slice(0, savedIndex)
      .filter(
        (request) =>
          request.type === 'submit' &&
          request.rejected &&
          request.formKey === savedRequest.formKey &&
          answerSlotKey(request) === answerSlotKey(savedRequest)
      );
    const keys = olderRejectedWrites
      .map((request) => request.key)
      .filter((key): key is IDBValidKey => key !== undefined);
    if (!keys.length) return;
    if (savedRequest.stepKey) {
      await this.removeRequests(keys);
    } else if (savedRequest.url.includes(CUSTOM_FIELD_SUBMIT_PATH)) {
      const body = await this.readFormDataBody(savedRequest);
      if (body && body.get('override') !== 'false')
        await this.stripSavedCustomFields(keys, customFieldKeysOf(body));
    }
  }

  // Removes the fields a newer custom field write saved from this user's older
  // queued ones, so a later replay cannot revert them. An older write left with
  // no fields is dropped.
  private async stripSavedCustomFields(
    olderWriteKeys: IDBValidKey[],
    savedFieldKeys: string[]
  ): Promise<void> {
    const olderWrites = (await this.readQueuedRequests()).filter(
      (request) =>
        request.key !== undefined && olderWriteKeys.includes(request.key)
    );
    for (const olderWrite of olderWrites) {
      const body = await this.readFormDataBody(olderWrite);
      if (!body) continue;
      const fieldKeys = customFieldKeysOf(body);
      const remainingFieldKeys = fieldKeys.filter(
        (fieldKey) => !savedFieldKeys.includes(fieldKey)
      );
      if (!remainingFieldKeys.length) {
        await this.removeRequest(olderWrite.key);
      } else if (remainingFieldKeys.length < fieldKeys.length) {
        await this.replaceRequestBody(
          olderWrite,
          withoutCustomFields(body, savedFieldKeys)
        );
      }
    }
  }

  private async readFormDataBody(
    request: SerializedRequest
  ): Promise<FormData | undefined> {
    try {
      if (request.snapshot) return await request.snapshot.clone().formData();
      // The stored headers carry the multipart boundary the body was encoded with
      return await new Request(request.url, {
        method: request.method,
        headers: JSON.parse(request.headers),
        body: this.reconstructBody(request.body, request.bodyType)
      }).formData();
    } catch (error) {
      // Left as queued: replaying it whole beats losing its other fields
      console.warn('Error reading queued custom field write', error);
      return undefined;
    }
  }

  private async replaceRequestBody(
    request: SerializedRequest,
    body: FormData
  ): Promise<void> {
    // The new body gets a new multipart boundary, so the old content type goes
    const headers: Record<string, string> = JSON.parse(request.headers);
    Object.keys(headers)
      .filter((name) => name.toLowerCase() === 'content-type')
      .forEach((name) => delete headers[name]);
    const rebuilt = new Request(request.url, {
      method: request.method,
      headers,
      body
    });
    const rebuiltHeaders: Record<string, string> = {};
    rebuilt.headers.forEach((value, name) => {
      rebuiltHeaders[name] = value;
    });
    const serializedBody = request.snapshot
      ? undefined
      : await rebuilt.clone().blob().then(this.serializeRequestBody);

    await this.updateRequest(request.key, (record) => {
      record.headers = JSON.stringify(rebuiltHeaders);
      if (record.snapshot) record.snapshot = rebuilt;
      if (serializedBody) {
        record.body = serializedBody.body;
        record.bodyType = serializedBody.type;
      }
    });
  }

  private async deleteRecordsWhere(
    predicate: (record: SerializedRequest, key: IDBValidKey) => boolean
  ): Promise<void> {
    for (const [key, record] of this.memoryRequests) {
      if (predicate(record, key)) this.memoryRequests.delete(key);
    }
    if (!this.indexedDBSupported) return;

    const dbTransaction = await this.getDbTransaction('readwrite');
    if (!dbTransaction) {
      if (this.hasOpenedDatabase)
        throw new AnswersPendingError(
          'Saved answers could not be updated. Please try again.'
        );
      return;
    }

    const { tx, store } = dbTransaction;
    const request = store.openCursor();

    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
          .result;
        if (cursor) {
          const record = cursor.value as SerializedRequest;
          if (predicate(record, cursor.key)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // Atomically fetch, update, and save a single request record
  private async updateRequest(
    key: IDBValidKey | undefined,
    updater: (record: SerializedRequest) => void
  ): Promise<void> {
    if (!key) return;
    const memoryRequest = this.memoryRequests.get(key);
    if (memoryRequest) {
      updater(memoryRequest);
      return;
    }
    const dbTransaction = await this.getDbTransaction('readwrite');
    if (!dbTransaction)
      throw new AnswersPendingError(
        'Saved answers could not be updated. Please try again.'
      );

    const { tx, store } = dbTransaction;
    const getReq = store.get(key);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      getReq.onsuccess = () => {
        const record = getReq.result as SerializedRequest | undefined;
        if (record) {
          updater(record);
          store.put(record, key);
        }
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  // Batch update: find matching records and transform them in-place
  private async updateRecordsWhere(
    predicate: (record: SerializedRequest) => boolean,
    updater: (record: SerializedRequest) => SerializedRequest
  ): Promise<void> {
    for (const [key, record] of this.memoryRequests) {
      if (predicate(record))
        this.memoryRequests.set(key, updater({ ...record }));
    }
    if (!this.indexedDBSupported) return;

    const dbTransaction = await this.getDbTransaction('readwrite');
    if (!dbTransaction) {
      if (this.hasOpenedDatabase)
        throw new AnswersPendingError(
          'Saved answers could not be updated. Please try again.'
        );
      return;
    }

    const { tx, store } = dbTransaction;
    const request = store.openCursor();

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>)
          .result;
        if (cursor) {
          const record = cursor.value as SerializedRequest;
          if (predicate(record)) {
            const updated = updater({ ...record });
            cursor.update(updated);
          }
          cursor.continue();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async updateRetryAttempts(
    key: IDBValidKey | undefined,
    attempts: number
  ): Promise<void> {
    await this.updateRequest(key, (record) => {
      record.retryAttempts = attempts;
    });
  }

  // Check if any queued requests can still be retried (haven't exceeded max attempts)
  private async hasReplayableRequest({
    includeConnectors = false
  } = {}): Promise<boolean> {
    const requests = await this.readQueuedRequests();
    return requests.some(
      (request) =>
        (includeConnectors || request.type !== 'customRequest') &&
        !request.rejected &&
        !this.isParked(request) &&
        !(
          ['submit', 'registerEvent'].includes(request.type) &&
          this.hasUnreconciledLiveWrite(request.userId)
        ) &&
        !(
          request.type === 'registerEvent' &&
          requests.some(
            (write) =>
              write.type === 'submit' &&
              write.rejected &&
              write.userId === request.userId &&
              write.stepKey === request.stepKey
          )
        ) &&
        (!!request.snapshot ||
          (request.retryAttempts ?? 0) < this.maxRetryAttempts)
    );
  }

  // Reset retry counter for queued requests before new submission attempt.
  // Allows request to use full retry budget (up to MAX_RETRY_ATTEMPTS).
  // Called before each new file upload to prevent exhausted retries from blocking progress.
  public async resetRetryAttemptsByUrl(
    url: string,
    options?: { fieldKey?: string }
  ): Promise<void> {
    await this.updateRecordsWhere(
      (record) => {
        if (
          endpointOf(record.url) !== endpointOf(url) ||
          record.formKey !== this.formKey
        )
          return false;
        if (!options?.fieldKey) return true;
        return this.recordMatchesFieldKey(record, options.fieldKey);
      },
      (record) => ({ ...record, retryAttempts: 0 })
    );
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
        // Stored as the plain object serializeRequestBody produces
        const parsedBody = (
          typeof body === 'string' ? JSON.parse(body) : body
        ) as Record<string, any>;
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
