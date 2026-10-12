/**
 * Integration tests for OfflineRequestHandler
 *
 * These tests verify the high-level behavior and integration:
 * 1. Request queueing behavior when offline/network fails
 * 2. clearFailedRequestByUrl functionality (critical for file upload retry)
 * 3. Online/offline state handling
 * 4. Retry mechanism and error handling
 * 5. File upload retry scenarios
 *
 * Focus: Integration behavior rather than internal implementation details
 */

import {
  OfflineRequestHandler,
  SUPERSEDED_WRITE,
  markFileUploadRetrySuccess
} from '../offlineRequestHandler';
import {
  fileRetryStatus as mockFileRetryStatus,
  initState as mockInitState
} from '../init';
import {
  _resetFileUploadProgress,
  getUploadsSnapshot,
  setUploadIndicatorEnabled,
  startUpload
} from '../fileUploadProgress';
import { getApiUrl, setEnvironment } from '@feathery/client-utils';
import {
  handleFormAuthenticationError,
  handleFormConflict
} from '../featheryClient/utils';
import {
  FakeRequest,
  fakeResponse,
  installFakeIndexedDB,
  waitUntil
} from './test-utils';

// Mock init module. A replay reads the access link off initState, so the mock
// carries it too - without it every replay to the API host throws. The user is
// mutable so a test can hand the device to another user.
jest.mock('../init', () => {
  const fileRetryStatus: Record<string, boolean> = {};
  const info = { sdkKey: 'test-sdk-key', userId: 'user-1' };
  return {
    initInfo: () => info,
    fileRetryStatus,
    initState: { linkToken: '', linkSecret: '' }
  };
});
const mockInitInfo = jest.requireMock('../init').initInfo();

// Mocking '../init' keeps featheryClient, which is what normally configures the
// environment at module load, out of this file. A replay only carries the
// access link on a request to the backend, so the host it matches against has
// to be explicit rather than whatever BACKEND_ENV happened to be.
setEnvironment('production');

// The real ones alert and reload the page, or close the form
jest.mock('../featheryClient/utils', () => ({
  handleFormAuthenticationError: jest.fn(),
  handleFormConflict: jest.fn()
}));

describe('OfflineRequestHandler - Integration Tests', () => {
  let handler: OfflineRequestHandler;
  let errorCallback: jest.Mock;
  let originalNavigator: any;

  beforeAll(() => {
    originalNavigator = global.navigator;

    // Mock navigator with configurable onLine
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: { onLine: true }
    });

    (global as any).Request = FakeRequest;
  });

  afterAll(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockFileRetryStatus).forEach(
      (key) => delete mockFileRetryStatus[key]
    );
    mockInitInfo.userId = 'user-1';
    errorCallback = jest.fn();
    handler = new OfflineRequestHandler('test-form', errorCallback);

    // Reset navigator.onLine
    Object.defineProperty(global.navigator, 'onLine', {
      writable: true,
      value: true,
      configurable: true
    });
  });

  // A handler over a fresh in-memory IndexedDB. The handler detects IndexedDB
  // when it is constructed, so it is built after the store is installed.
  let fakeIndexedDB: ReturnType<typeof installFakeIndexedDB> | undefined;
  const createQueueWithStorage = () => {
    fakeIndexedDB = installFakeIndexedDB('test-form');
    return {
      store: fakeIndexedDB,
      queue: new OfflineRequestHandler('test-form', errorCallback)
    };
  };

  afterEach(() => {
    fakeIndexedDB?.uninstall();
    fakeIndexedDB = undefined;
  });

  describe('Request execution behavior', () => {
    describe('storage failure recovery', () => {
      let originalFetch: any;

      beforeEach(() => {
        originalFetch = (global as any).fetch;
        (handler as any).indexedDBSupported = false;
      });

      afterEach(() => {
        (global as any).fetch = originalFetch;
        jest.restoreAllMocks();
      });

      it('retains JSON and file writes without IndexedDB and acknowledges both before completion', async () => {
        const accepted: string[] = [];
        let isRestored = false;
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          if (!isRestored) throw new TypeError('Failed to fetch');
          accepted.push(
            options.body instanceof FormData
              ? 'synthetic card'
              : await options.body.text()
          );
          return { status: 200 };
        });
        const failed = async () => {
          throw new TypeError('Failed to fetch');
        };
        await expect(
          handler.runOrSaveRequest(
            failed,
            '/save/',
            { method: 'POST', body: 'synthetic birthdate' },
            'submit',
            'Insurance'
          )
        ).rejects.toThrow('Failed to fetch');
        const file = new FormData();
        file.append('card', new Blob(['synthetic card']));
        await expect(
          handler.runOrSaveRequest(
            failed,
            '/file/',
            { method: 'POST', body: file },
            'submit',
            'Insurance',
            { fieldKey: 'card' }
          )
        ).rejects.toThrow('Failed to fetch');
        const complete = jest.fn(async () => {
          accepted.push('complete');
          return { status: 200 };
        });
        await expect(
          handler.runOrSaveRequest(
            complete,
            '/event/',
            { method: 'POST', body: '{}' },
            'registerEvent',
            'last',
            { requireAcknowledgement: true }
          )
        ).rejects.toThrow('Some answers are still being saved');
        expect(complete).not.toHaveBeenCalled();
        expect(await handler.dbHasRequest('submit')).toBe(true);
        isRestored = true;
        await handler.runOrSaveRequest(
          complete,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'last',
          { requireAcknowledgement: true }
        );
        expect(accepted).toEqual([
          'synthetic birthdate',
          'synthetic card',
          'complete'
        ]);
        expect(await handler.dbHasRequest()).toBe(false);
        expect(mockFileRetryStatus.card).toBe(true);
      });

      it('retries a fallback file once per cycle and recovers on terminal retry after four failures', async () => {
        const file = new FormData();
        file.append('card', new Blob(['synthetic card']));
        await handler.saveRequest(
          '/file/',
          { method: 'POST', body: file },
          'submit',
          'Insurance',
          { fieldKey: 'card' }
        );
        (global as any).fetch = jest
          .fn()
          .mockRejectedValue(new TypeError('offline'));
        for (let attempt = 0; attempt < 4; attempt++) {
          await handler.replayRequests();
          expect((global as any).fetch).toHaveBeenCalledTimes(attempt + 1);
        }
        expect(await handler.dbHasRequest('submit')).toBe(true);
        (global as any).fetch.mockResolvedValue({ status: 200 });
        const complete = jest.fn(async () => {
          expect(mockFileRetryStatus.card).toBe(true);
          return { status: 200 };
        });
        await handler.runOrSaveRequest(
          complete,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'last',
          { requireAcknowledgement: true }
        );
        expect((global as any).fetch).toHaveBeenCalledTimes(5);
        expect(complete).toHaveBeenCalledTimes(1);
        expect(await handler.dbHasRequest()).toBe(false);
      });

      it('sends an intermediate event instead of dropping it when storage cannot hold it', async () => {
        (global as any).fetch = jest
          .fn()
          .mockRejectedValue(new TypeError('Failed to fetch'));
        await expect(
          handler.runOrSaveRequest(
            async () => {
              throw new TypeError('Failed to fetch');
            },
            '/save/',
            { method: 'POST', body: 'synthetic answer' },
            'submit',
            'Insurance'
          )
        ).rejects.toThrow('Failed to fetch');
        const sendEvent = jest.fn().mockResolvedValue({ status: 200 });

        await handler.runOrSaveRequest(
          sendEvent,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'Insurance'
        );

        // The memory fallback keeps answers only, so holding the event would lose it
        expect(sendEvent).toHaveBeenCalledTimes(1);
        expect(await handler.dbHasRequest('registerEvent')).toBe(false);
        expect(await handler.dbHasRequest('submit')).toBe(true);
      });

      it('keeps a write whose IndexedDB commit aborts, with its captured payload', async () => {
        const { store, queue } = createQueueWithStorage();
        store.abortCommits(true);
        const options = { method: 'POST', body: 'original answer' };
        await queue.saveRequest('/save/', options, 'submit', 'Insurance');
        options.body = 'later mutation';
        const accepted: string[] = [];
        (global as any).fetch = jest.fn(async (_url: string, request: any) => {
          accepted.push(await request.body.text());
          return { status: 200 };
        });
        await queue.replayRequests();
        expect(accepted).toEqual(['original answer']);
        expect(await queue.dbHasRequest()).toBe(false);
      });

      it('orders durable and memory writes with tied timestamps and retains a newer in-flight write', async () => {
        const { store, queue } = createQueueWithStorage();
        jest.spyOn(Date, 'now').mockReturnValue(100);
        await queue.saveRequest(
          '/save/',
          { method: 'POST', body: 'old' },
          'submit',
          'Insurance'
        );
        store.abortCommits(true);
        await queue.saveRequest(
          '/save/',
          { method: 'POST', body: 'middle' },
          'submit',
          'Insurance'
        );
        store.abortCommits(false);
        await queue.saveRequest(
          '/save/',
          { method: 'POST', body: 'new' },
          'submit',
          'Insurance'
        );
        const accepted: string[] = [];
        (global as any).fetch = jest.fn(async (_url: string, request: any) => {
          const body =
            typeof request.body === 'string'
              ? request.body
              : await request.body.text();
          accepted.push(body);
          if (body === 'old') {
            store.abortCommits(true);
            await queue.saveRequest(
              '/save/',
              { method: 'POST', body: 'later' },
              'submit',
              'Insurance'
            );
          }
          return { status: 200 };
        });
        await queue.replayRequests();
        expect(accepted).toEqual(['old', 'middle', 'new']);
        expect(await queue.dbHasRequest('submit')).toBe(true);
        await queue.replayRequests();
        expect(accepted).toEqual(['old', 'middle', 'new', 'later']);
        expect(await queue.dbHasRequest()).toBe(false);
      });
    });

    describe('queued answer writes', () => {
      const stepUrl = '/panel/step/submit/v3/';
      let store: ReturnType<typeof installFakeIndexedDB>;
      let queue: OfflineRequestHandler;
      let originalFetch: any;
      // Payloads the replay sent, in order
      let replayed: string[];

      beforeEach(() => {
        ({ store, queue } = createQueueWithStorage());
        originalFetch = (global as any).fetch;
        replayed = [];
        // Retries go out at once instead of waiting out the backoff
        jest.spyOn(queue as any, 'delay').mockResolvedValue(undefined);
      });

      afterEach(() => {
        (global as any).fetch = originalFetch;
        jest.restoreAllMocks();
      });

      // Answers each replayed payload with the status the server gives it
      const serveReplay = (statusOf: (body: string) => number = () => 200) => {
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayed.push(options.body);
          return fakeResponse(statusOf(options.body));
        });
      };
      const failedRun = async () => {
        throw new TypeError('Failed to fetch');
      };
      const failToSave = (body: string) =>
        expect(
          queue.runOrSaveRequest(
            failedRun,
            stepUrl,
            { method: 'POST', body },
            'submit',
            'Insurance'
          )
        ).rejects.toThrow('Failed to fetch');
      const sendEvent = (send: jest.Mock, stepKey: string) =>
        queue.runOrSaveRequest(
          send,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          stepKey
        );
      const completeForm = (send: jest.Mock) =>
        queue.runOrSaveRequest(
          send,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'last',
          { requireAcknowledgement: true }
        );
      const queuedBodies = () => store.rows().map((row) => row.body);
      const queuedAnswer = {
        type: 'submit',
        stepKey: 'Insurance',
        url: stepUrl,
        userId: 'user-1',
        body: 'answer'
      };
      const queuedEvent = (stepKey: string, body: string) => ({
        type: 'registerEvent',
        stepKey,
        url: '/event/',
        userId: 'user-1',
        body
      });

      it('replays a queued step save before sending its completion event', async () => {
        await failToSave('step save');
        serveReplay();
        const send = jest.fn(async () => {
          replayed.push('complete event');
          return { ok: true };
        });

        await completeForm(send);

        expect(replayed).toEqual(['step save', 'complete event']);
        expect(store.rows()).toEqual([]);
      });

      it("holds an intermediate event only behind its own step's queued write", async () => {
        store.seed(queuedAnswer);
        // The server cannot take the answer yet
        serveReplay(() => 503);
        const sendOtherStepEvent = jest.fn().mockResolvedValue({ ok: true });
        const sendOwnStepEvent = jest.fn().mockResolvedValue({ ok: true });

        await sendEvent(sendOtherStepEvent, 'Contact');
        await sendEvent(sendOwnStepEvent, 'Insurance');

        expect(sendOtherStepEvent).toHaveBeenCalledTimes(1);
        expect(sendOwnStepEvent).not.toHaveBeenCalled();
        expect(store.rows().map((row) => [row.type, row.stepKey])).toEqual([
          ['submit', 'Insurance'],
          ['registerEvent', 'Insurance']
        ]);
      });

      // Expectation moved: a connector call is not an answer, so it no longer holds events
      it('replays a failing connector call in the background, holding nothing and alerting no one', async () => {
        // One attempt left, so its failure is the one that would alert
        store.seed({
          type: 'customRequest',
          url: '/custom_request/',
          userId: 'user-1',
          body: 'connector call',
          retryAttempts: 3
        });
        store.seed(queuedAnswer);
        let answerConnectorCall!: (response: any) => void;
        (global as any).fetch = jest.fn((_url: string, options: any) => {
          replayed.push(options.body);
          if (options.body !== 'connector call')
            return Promise.resolve(fakeResponse(200));
          return new Promise((resolve) => {
            answerConnectorCall = resolve;
          });
        });
        const sendStepEvent = jest.fn().mockResolvedValue({ ok: true });
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await sendEvent(sendStepEvent, 'Insurance');
        await completeForm(sendCompletion);

        // Both went out while the connector call was still in flight
        expect(sendStepEvent).toHaveBeenCalledTimes(1);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(replayed).toEqual(['answer', 'connector call']);

        answerConnectorCall(fakeResponse(503));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(errorCallback).not.toHaveBeenCalled();
        expect(queuedBodies()).toEqual(['connector call']);
      });

      it('replays events for settled steps after a stuck write holds back the rest', async () => {
        store.seed({ ...queuedAnswer, body: 'unsaved answer' });
        store.seed(queuedEvent('Insurance', 'insurance submitted'));
        store.seed({
          ...queuedAnswer,
          stepKey: 'Contact',
          body: 'later answer'
        });
        store.seed(queuedEvent('Contact', 'contact submitted'));
        store.seed(queuedEvent('Intro', 'intro submitted'));
        serveReplay((body) => (body === 'unsaved answer' ? 503 : 200));

        await queue.replayRequests();

        // The later answer stays behind the stuck one, and each step's event behind its answer
        expect(replayed.filter((body) => body !== 'unsaved answer')).toEqual([
          'intro submitted'
        ]);
        expect(queuedBodies()).toEqual([
          'unsaved answer',
          'insurance submitted',
          'later answer',
          'contact submitted'
        ]);
      });

      it('saves and completes past answers another user left on a shared device, quietly', async () => {
        store.seed({
          ...queuedAnswer,
          userId: 'previous-user',
          body: 'previous'
        });
        // Queued by an SDK build that did not record the user
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          body: 'unattributed'
        });
        store.seed({ ...queuedAnswer, body: 'current' });
        serveReplay((body) => (body === 'current' ? 200 : 503));
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await completeForm(sendCompletion);

        expect(replayed).toContain('current');
        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(queuedBodies()).toEqual(['previous', 'unattributed']);
        expect(errorCallback).not.toHaveBeenCalled();
      });

      it.each([
        ['fails', 503, true],
        ['succeeds', 200, false]
      ])(
        "leaves this user's upload status alone when another user's queued file %s",
        async (_outcome, status, uploadStatus) => {
          mockFileRetryStatus.card = uploadStatus;
          const queuedFile = {
            ...queuedAnswer,
            metadata: { fieldKey: 'card' }
          };
          store.seed({
            ...queuedFile,
            url: '/panel/step/submit/file/previous-user/',
            userId: 'previous-user'
          });
          // Queued by an SDK build that did not record the user
          store.seed({
            ...queuedFile,
            url: '/panel/step/submit/file/unattributed/',
            userId: undefined
          });
          serveReplay(() => status);

          await queue.replayRequests();

          expect(mockFileRetryStatus.card).toBe(uploadStatus);
          expect(errorCallback).not.toHaveBeenCalled();
        }
      );

      it('retries exhausted answers when the form completes without submitting a step', async () => {
        // Earlier replays used up its budget and no step submission reset it
        store.seed({ ...queuedAnswer, retryAttempts: 4 });
        serveReplay();
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await completeForm(sendCompletion);

        expect(replayed).toEqual(['answer']);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([]);
      });

      // Expectation moved: a kept row 409s on every mount replay and reloads the page forever
      it('drops a conflicted write so the reload does not conflict again', async () => {
        store.seed({ ...queuedAnswer, body: 'stale version' });
        serveReplay(() => 409);

        await queue.replayRequests();
        // The replay on mount after the conflict reload
        await queue.replayRequests();

        expect(replayed).toEqual(['stale version']);
        expect(handleFormConflict).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([]);
      });

      it('drops answers the server rejects, reports them once and saves the rest', async () => {
        store.seed({ ...queuedAnswer, body: 'invalid answer' });
        store.seed({
          type: 'submit',
          url: '/panel/custom/submit/v3/',
          userId: 'user-1',
          body: 'invalid custom answer'
        });
        store.seed({
          ...queuedAnswer,
          stepKey: 'Contact',
          body: 'valid answer'
        });
        serveReplay((body) => (body.startsWith('invalid') ? 400 : 200));

        await queue.replayRequests();

        expect(replayed).toEqual([
          'invalid answer',
          'invalid custom answer',
          'valid answer'
        ]);
        expect(store.rows()).toEqual([]);
        expect(errorCallback).toHaveBeenCalledTimes(1);
        expect(errorCallback).toHaveBeenCalledWith(
          expect.stringContaining('could not be saved')
        );
      });

      it.each([408, 429, 503])(
        'keeps an answer queued for retry when the server answers %i',
        async (status) => {
          store.seed(queuedAnswer);
          serveReplay(() => status);

          await queue.replayRequests();

          expect(queuedBodies()).toEqual(['answer']);
          expect(errorCallback).not.toHaveBeenCalledWith(
            expect.stringContaining('could not be saved')
          );
        }
      );

      it('keeps a row the link gate refuses queued, without spending retries or alerting', async () => {
        // The device's link now opens another submission than this row's
        store.seed({
          ...queuedAnswer,
          userId: 'linked-submission',
          body: 'other submission'
        });
        store.seed({ ...queuedAnswer, body: 'current' });
        serveReplay((body) => (body === 'other submission' ? 403 : 200));
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await completeForm(sendCompletion);

        expect(replayed).toEqual(['other submission', 'current']);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([
          expect.objectContaining({
            body: 'other submission',
            retryAttempts: 0
          })
        ]);
        expect(errorCallback).not.toHaveBeenCalled();
      });

      it("supersedes only this user's older snapshot of the same step after a successful save", async () => {
        store.seed({ ...queuedAnswer, body: 'older snapshot' });
        store.seed({
          ...queuedAnswer,
          userId: 'previous-user',
          body: 'previous user snapshot'
        });
        store.seed({
          ...queuedAnswer,
          url: '/panel/step/submit/file/user-1/',
          metadata: { fieldKey: 'card' },
          body: 'card upload'
        });
        store.seed({ ...queuedAnswer, stepKey: 'Other', body: 'other step' });
        store.seed({
          ...queuedAnswer,
          stepKey: undefined,
          url: '/panel/custom/submit/v3/',
          body: 'custom answer'
        });
        store.seed(queuedEvent('Insurance', 'insurance submitted'));
        // The server cannot take the queued rows yet
        serveReplay(() => 503);

        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'newer snapshot' },
          'submit',
          'Insurance'
        );

        expect(queuedBodies()).toEqual([
          'previous user snapshot',
          'card upload',
          'other step',
          'custom answer',
          'insurance submitted'
        ]);
      });

      it('retains a newer queued snapshot when an older concurrent save succeeds', async () => {
        let finishOlder!: (response: any) => void;
        let olderStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          olderStarted = resolve;
        });
        const older = queue.runOrSaveRequest(
          () => {
            olderStarted();
            return new Promise((resolve) => {
              finishOlder = resolve;
            });
          },
          stepUrl,
          { method: 'POST', body: 'older snapshot' },
          'submit',
          'Insurance'
        );
        await started;
        await failToSave('newer snapshot');
        finishOlder({ ok: true });
        await older;
        expect(queuedBodies()).toEqual(['newer snapshot']);

        (global as any).fetch = jest
          .fn()
          .mockRejectedValue(new TypeError('Failed to fetch'));
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'Some answers are still being saved'
        );
        expect(sendCompletion).not.toHaveBeenCalled();

        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'newest snapshot' },
          'submit',
          'Insurance'
        );
        expect(store.rows()).toEqual([]);
        await completeForm(sendCompletion);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
      });

      it('does not queue an older save that fails after a newer one for the same step landed', async () => {
        let failOlder!: () => void;
        let olderStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          olderStarted = resolve;
        });
        const older = queue.runOrSaveRequest(
          () => {
            olderStarted();
            return new Promise((resolve, reject) => {
              failOlder = () => reject(new TypeError('Failed to fetch'));
            });
          },
          stepUrl,
          { method: 'POST', body: 'older snapshot' },
          'submit',
          'Insurance'
        );
        await started;
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'newer snapshot' },
          'submit',
          'Insurance'
        );

        failOlder();

        // Resolved rather than thrown, so the caller keeps the newer outcome
        await expect(older).resolves.toBe(SUPERSEDED_WRITE);
        expect(store.rows()).toEqual([]);
      });

      it('drops an older save of the step that failed while a newer one was still in flight', async () => {
        const inFlight = (body: string) => {
          const settle = { isStarted: false, fail: () => {}, land: () => {} };
          const request = queue.runOrSaveRequest(
            () =>
              new Promise((resolve, reject) => {
                settle.isStarted = true;
                settle.fail = () => reject(new TypeError('Failed to fetch'));
                settle.land = () => resolve({ ok: true });
              }),
            stepUrl,
            { method: 'POST', body },
            'submit',
            'Insurance'
          );
          return { request, settle };
        };
        const older = inFlight('older snapshot');
        await waitUntil(() => older.settle.isStarted);
        const newer = inFlight('newer snapshot');
        await waitUntil(() => newer.settle.isStarted);

        older.settle.fail();
        await expect(older.request).rejects.toThrow('Failed to fetch');
        expect(queuedBodies()).toEqual(['older snapshot']);
        newer.settle.land();
        await newer.request;

        serveReplay();
        await queue.replayRequests();
        expect(replayed).toEqual([]);
        expect(store.rows()).toEqual([]);
      });

      it("keeps another tab's newer row of the step when this tab's older write lands", async () => {
        // An earlier write in this tab, so its next one starts at order 2
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'intro' },
          'submit',
          'Intro'
        );
        let landOlderWrite!: () => void;
        const olderWrite = queue.runOrSaveRequest(
          () =>
            new Promise((resolve) => {
              landOlderWrite = () => resolve({ ok: true });
            }),
          stepUrl,
          { method: 'POST', body: 'older snapshot' },
          'submit',
          'Insurance'
        );
        await waitUntil(() => !!landOlderWrite);
        // The other tab's write started first on its own count, then failed
        store.seed({
          ...queuedAnswer,
          body: 'other tab snapshot',
          writeOrder: 1,
          pageId: 'other-tab'
        });

        landOlderWrite();
        await olderWrite;

        expect(queuedBodies()).toEqual(['other tab snapshot']);
      });

      it('strips the fields a newer custom field write saved from older queued ones', async () => {
        const customUrl = '/panel/custom/submit/v3/';
        const customWrite = (values: Record<string, string>) => {
          const body = new FormData();
          body.set('custom_key_values', JSON.stringify(values));
          return { method: 'POST', body };
        };
        // The server cannot take the queued writes yet
        serveReplay(() => 503);
        for (const values of [
          { plan: 'basic', referrer: 'ad' },
          { plan: 'basic' }
        ]) {
          await expect(
            queue.runOrSaveRequest(
              failedRun,
              customUrl,
              customWrite(values),
              'submit'
            )
          ).rejects.toThrow('Failed to fetch');
        }
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          customUrl,
          customWrite({ plan: 'premium' }),
          'submit'
        );

        // A later manual retry replays what is left of the older writes
        await queue.resetAnswerWriteRetries();
        const replayedValues: Record<string, string>[] = [];
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayedValues.push(
            JSON.parse(options.body.get('custom_key_values'))
          );
          return fakeResponse(200);
        });
        await queue.replayRequests();

        expect(replayedValues).toEqual([{ referrer: 'ad' }]);
        expect(store.rows()).toEqual([]);
      });

      it('closes the form and drops a row whose own link the gate now refuses', async () => {
        store.seed(queuedAnswer);
        (global as any).fetch = jest.fn(async () =>
          fakeResponse(403, { message: 'This link has expired' })
        );

        await queue.replayRequests();

        expect(handleFormAuthenticationError).toHaveBeenCalledWith(
          'This link has expired'
        );
        expect(store.rows()).toEqual([]);
        expect(errorCallback).not.toHaveBeenCalled();
      });

      it('retries a row whose 403 comes from something other than the access check', async () => {
        store.seed(queuedAnswer);
        serveReplay();
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayed.push(options.body);
          return fakeResponse(403, '<html>Request blocked</html>');
        });

        await queue.replayRequests();

        expect(handleFormAuthenticationError).not.toHaveBeenCalled();
        expect(replayed).toEqual(['answer', 'answer', 'answer', 'answer']);
        expect(store.rows()).toEqual([
          expect.objectContaining({ body: 'answer', retryAttempts: 4 })
        ]);
      });

      it('refuses completion after one immediate attempt at a row the server keeps failing', async () => {
        store.seed({
          ...queuedAnswer,
          stepKey: undefined,
          url: '/panel/custom/submit/v3/',
          body: 'custom answer'
        });
        serveReplay(() => 503);
        // A backoff would never end, so only an attempt without one returns
        jest
          .spyOn(queue as any, 'delay')
          .mockReturnValue(new Promise(() => {}));
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'Some answers are still being saved'
        );

        expect(replayed).toEqual(['custom answer']);
        expect(sendCompletion).not.toHaveBeenCalled();
      });

      describe('custom field writes over older queued ones', () => {
        const customUrl = '/panel/custom/submit/v3/';
        const customWrite = (
          values: Record<string, string>,
          { override = true } = {}
        ) => {
          const body = new FormData();
          body.set('custom_key_values', JSON.stringify(values));
          body.set('override', String(override));
          return { method: 'POST', body };
        };
        const queueCustomWrite = (values: Record<string, string>) =>
          expect(
            queue.runOrSaveRequest(
              failedRun,
              customUrl,
              customWrite(values),
              'submit'
            )
          ).rejects.toThrow('Failed to fetch');
        const queuedValues = () =>
          store
            .rows()
            .map((row) => JSON.parse(row.body.custom_key_values ?? 'null'));

        beforeEach(() => {
          // The server cannot take the queued writes yet
          serveReplay(() => 503);
        });

        it('keeps older values a write without override may not have replaced', async () => {
          await queueCustomWrite({ plan: 'basic' });

          await queue.runOrSaveRequest(
            async () => ({ ok: true }),
            customUrl,
            customWrite({ plan: 'premium' }, { override: false }),
            'submit'
          );

          expect(queuedValues()).toEqual([{ plan: 'basic' }]);
        });

        it('still resolves the saved write when an older queued one cannot be read', async () => {
          store.seed({
            type: 'submit',
            url: customUrl,
            userId: 'user-1',
            bodyType: 'formData',
            body: { custom_key_values: 'not json' }
          });

          await expect(
            queue.runOrSaveRequest(
              async () => ({ ok: true }),
              customUrl,
              customWrite({ plan: 'premium' }),
              'submit'
            )
          ).resolves.toEqual({ ok: true });

          expect(store.rows()).toHaveLength(1);
        });
      });

      it('holds concurrent live writes until the replay already running has landed the older snapshot', async () => {
        store.seed({ ...queuedAnswer, body: 'old snapshot' });
        const wire: string[] = [];
        let landOldSnapshot!: () => void;
        (global as any).fetch = jest.fn(
          (_url: string, options: any) =>
            new Promise((resolve) => {
              wire.push(`replay ${options.body}`);
              landOldSnapshot = () => {
                wire.push(`landed ${options.body}`);
                resolve(fakeResponse(200));
              };
            })
        );
        const liveWrite = (label: string) => async () => {
          wire.push(label);
          return { ok: true };
        };

        // A step submission sends its custom fields and step snapshot together
        const customWrite = queue.runOrSaveRequest(
          liveWrite('custom fields'),
          '/panel/custom/submit/v3/',
          { method: 'POST', body: 'custom fields' },
          'submit'
        );
        const newSnapshot = queue.runOrSaveRequest(
          liveWrite('new snapshot'),
          stepUrl,
          { method: 'POST', body: 'new snapshot' },
          'submit',
          'Insurance'
        );
        await waitUntil(() => wire.length > 0);
        landOldSnapshot();
        await Promise.all([customWrite, newSnapshot]);

        expect(wire.slice(0, 2)).toEqual([
          'replay old snapshot',
          'landed old snapshot'
        ]);
        expect(wire.slice(2).sort()).toEqual(['custom fields', 'new snapshot']);
      });

      it('leaves a queued snapshot alone while a live write to the same step is in flight', async () => {
        store.seed({ ...queuedAnswer, body: 'old snapshot' });
        // Connectivity drops while the old snapshot replays, so it stays queued
        (global as any).fetch = jest.fn(async () => {
          (global.navigator as any).onLine = false;
          throw new TypeError('Failed to fetch');
        });
        let landNewSnapshot!: () => void;
        const newSnapshot = queue.runOrSaveRequest(
          () =>
            new Promise((resolve) => {
              landNewSnapshot = () => resolve({ ok: true });
            }),
          stepUrl,
          { method: 'POST', body: 'new snapshot' },
          'submit',
          'Insurance'
        );
        try {
          await waitUntil(() => !!landNewSnapshot);
          (global.navigator as any).onLine = true;
          serveReplay();

          // Reconnecting replays the queue while the new snapshot is in flight
          await queue.replayRequests();
          expect(replayed).toEqual([]);

          landNewSnapshot();
          await newSnapshot;
          expect(store.rows()).toEqual([]);
        } finally {
          (global.navigator as any).onLine = true;
        }
      });

      it('releases replay after connectivity drops so reconnect can save before completion', async () => {
        store.seed(queuedAnswer);
        store.seed(queuedEvent('Insurance', 'insurance submitted'));
        (global as any).fetch = jest.fn().mockImplementation(async () => {
          (global.navigator as any).onLine = false;
          throw new TypeError('Failed to fetch');
        });
        try {
          const settled = await Promise.race([
            queue.replayRequests().then(() => true),
            new Promise<boolean>((resolve) =>
              setTimeout(() => resolve(false), 1000)
            )
          ]);
          expect(settled).toBe(true);
          expect(
            store.rows().map((row) => [row.type, row.retryAttempts])
          ).toEqual([
            ['submit', 1],
            ['registerEvent', 0]
          ]);
          (global.navigator as any).onLine = true;
          serveReplay();
          await queue.replayRequests();
          expect(replayed).toEqual(['answer', 'insurance submitted']);
          expect(store.rows()).toEqual([]);
        } finally {
          (global.navigator as any).onLine = true;
        }
      });

      it("replays a step's event only once a manual retry lands both of its queued snapshots in order", async () => {
        store.seed({ ...queuedAnswer, body: 'old' });
        store.seed({ ...queuedAnswer, body: 'new' });
        store.seed(queuedEvent('Insurance', 'insurance submitted'));
        serveReplay(() => 503);

        await queue.replayRequests();
        expect(replayed).toEqual(['old', 'old', 'old', 'old']);
        expect(store.rows()).toHaveLength(3);

        // The next manual step submission gives the exhausted write a fresh budget
        await queue.resetAnswerWriteRetries();
        replayed = [];
        serveReplay();
        await queue.replayRequests();
        expect(replayed).toEqual(['old', 'new', 'insurance submitted']);
        expect(store.rows()).toEqual([]);
      });
    });

    it('does not acknowledge completion when the event request resolves without a response', async () => {
      await expect(
        handler.runOrSaveRequest(
          async () => undefined,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'Insurance',
          { requireAcknowledgement: true }
        )
      ).rejects.toThrow('The submission could not be completed');
    });

    it('does not queue a terminal event whose network request failed', async () => {
      const save = jest.spyOn(handler, 'saveRequest');

      await expect(
        handler.runOrSaveRequest(
          async () => {
            throw new TypeError('Failed to fetch');
          },
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'Insurance',
          { requireAcknowledgement: true }
        )
      ).rejects.toThrow('Failed to fetch');

      expect(save).not.toHaveBeenCalled();
    });

    it('executes request immediately when online', async () => {
      const mockRun = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun,
        'https://api.example.com/submit',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('attempts to queue when offline (no-op without IndexedDB)', async () => {
      Object.defineProperty(global.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      const mockRun = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun,
        'https://api.example.com/submit',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      // Should not execute when offline
      expect(mockRun).not.toHaveBeenCalled();
    });

    it('queues request on network error (TypeError)', async () => {
      const mockRun = jest
        .fn()
        .mockRejectedValue(new TypeError('Network request failed'));

      await expect(
        handler.runOrSaveRequest(
          mockRun,
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow(TypeError);

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('does not queue non-network errors', async () => {
      const mockRun = jest
        .fn()
        .mockRejectedValue(new Error('Validation error'));

      await expect(
        handler.runOrSaveRequest(
          mockRun,
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Validation error');

      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('re-throws error to caller after queueing', async () => {
      const networkError = new TypeError('Failed to fetch');
      const mockRun = jest.fn().mockRejectedValue(networkError);

      await expect(
        handler.runOrSaveRequest(
          mockRun,
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Failed to fetch');
    });

    // Callers reporting upload progress need queueing signalled explicitly:
    // a run() that resolves undefined is not the same as one never attempted
    it('signals onQueued when offline', async () => {
      Object.defineProperty(global.navigator, 'onLine', {
        value: false,
        configurable: true
      });
      const onQueued = jest.fn();

      await handler.runOrSaveRequest(
        jest.fn().mockResolvedValue({ ok: true }),
        'https://api.example.com/submit',
        { method: 'POST', headers: {}, body: '{}' },
        'submit',
        undefined,
        undefined,
        onQueued
      );

      expect(onQueued).toHaveBeenCalledTimes(1);
    });

    it('signals onQueued when a network error queues the request', async () => {
      const onQueued = jest.fn();

      await expect(
        handler.runOrSaveRequest(
          jest.fn().mockRejectedValue(new TypeError('Network request failed')),
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit',
          undefined,
          undefined,
          onQueued
        )
      ).rejects.toThrow(TypeError);

      expect(onQueued).toHaveBeenCalledTimes(1);
    });

    it('does not signal onQueued when the request resolves undefined', async () => {
      const onQueued = jest.fn();

      await handler.runOrSaveRequest(
        jest.fn().mockResolvedValue(undefined),
        'https://api.example.com/submit',
        { method: 'POST', headers: {}, body: '{}' },
        'submit',
        undefined,
        undefined,
        onQueued
      );

      expect(onQueued).not.toHaveBeenCalled();
    });
  });

  describe('File upload retry scenario', () => {
    it('does not trigger immediate replay on network error (prevents infinite loop)', async () => {
      const fileUrl = 'https://api.feathery.io/api/panel/step/submit/file/';

      // Mock the replayRequests method to track if it's called
      const replayRequestsSpy = jest.spyOn(handler as any, 'replayRequests');

      // Mock runOrSaveRequest to fail with network error
      const mockRun = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      // Attempt upload that will fail
      await expect(
        handler.runOrSaveRequest(
          mockRun,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Failed to fetch');

      // CRITICAL: replayRequests should NOT be called immediately after saveRequest
      // This prevents the infinite retry loop bug where failed requests
      // would be saved to IndexedDB and immediately replayed, causing
      // another failure, save, replay cycle ad infinitum
      expect(replayRequestsSpy).not.toHaveBeenCalled();

      replayRequestsSpy.mockRestore();
    });

    it('does not cause multiple retry attempts on single network failure', async () => {
      const fileUrl = 'https://api.feathery.io/api/panel/step/submit/file/';

      // Track how many times the mock function is called
      const mockRun = jest
        .fn()
        .mockRejectedValue(new TypeError('Network request failed'));

      // Single failed upload attempt
      await expect(
        handler.runOrSaveRequest(
          mockRun,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Network request failed');

      // Should only be called once - no automatic retries
      // This verifies the infinite loop fix is working
      expect(mockRun).toHaveBeenCalledTimes(1);

      // Give time for any async operations to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Still should only be 1 call - no background retries
      expect(mockRun).toHaveBeenCalledTimes(1);
    });

    it('allows clearFailedRequestByUrl without throwing', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/field1';

      // This should not throw even without IndexedDB
      await expect(
        handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' })
      ).resolves.not.toThrow();
    });

    it('clearFailedRequestByUrl handles missing IndexedDB gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await handler.clearFailedRequestByUrl(
        'https://api.example.com/submit/file/',
        { fieldKey: 'testField' }
      );

      // Should handle gracefully without errors
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('allows retry flow: fail -> clear -> retry succeed', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/field1';

      // Step 1: Upload fails with network error
      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network blocked'));

      await expect(
        handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow('Network blocked');

      expect(mockRun1).toHaveBeenCalledTimes(1);

      // Step 2: User sees error and clicks retry

      // Step 3: Clear the failed request
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' });

      // Step 4: Network recovers - retry succeeds
      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun2,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun2).toHaveBeenCalledTimes(1);
    });

    it('clears failed request and allows immediate retry after network recovery', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/field1';

      // Simulate real user flow with button state management
      let buttonLocked = false;
      let errorOccurred = false;

      // Step 1: User clicks submit, button locks
      buttonLocked = true;

      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network blocked'));

      // Upload fails with network error
      try {
        await handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        );
      } catch (error) {
        // Error caught by Form component
        errorOccurred = true;
        // Button should unlock on error (this is what we're testing the fix for)
        buttonLocked = false;
      }

      expect(errorOccurred).toBe(true);
      expect(buttonLocked).toBe(false); // CRITICAL: Button must be unlocked for retry
      expect(mockRun1).toHaveBeenCalledTimes(1);

      // Step 2: User sees error message

      // Step 3: Network recovers, user clicks "next" again
      // Clear the failed request (happens in featheryClient before retry)
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' });

      // Step 4: Button can be clicked again (not locked)
      buttonLocked = true;
      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun2,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      // Success! Button unlocked after error = retry worked
      buttonLocked = false;
      expect(mockRun2).toHaveBeenCalledTimes(1);
    });

    it('supports multiple independent file uploads', async () => {
      const fileUrl = 'https://api.feathery.io/api/panel/step/submit/file/';

      // Upload file1 fails
      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network error'));
      await expect(
        handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow();

      // Upload file2 fails
      const mockRun2 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network error'));
      await expect(
        handler.runOrSaveRequest(
          mockRun2,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).rejects.toThrow();

      // Clear field1 only
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field1' });

      // Retry field1 successfully
      const mockRun3 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun3,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun3).toHaveBeenCalledTimes(1);

      // field2 can still be retried separately
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'field2' });
      const mockRun4 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun4,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun4).toHaveBeenCalledTimes(1);
    });

    it('clears queue during submit, not during file removal', async () => {
      const fileUrl =
        'https://api.feathery.io/api/panel/step/submit/file/user123/';

      // Step 1: Upload fails with network error and gets queued
      const mockRun1 = jest
        .fn()
        .mockRejectedValue(new TypeError('Network blocked'));

      try {
        await handler.runOrSaveRequest(
          mockRun1,
          fileUrl,
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        );
      } catch (error) {
        // Expected to fail and queue the request
      }

      expect(mockRun1).toHaveBeenCalledTimes(1);

      // Step 2: User removes the file from the form
      // NOTE: clearFilePathMapEntry does NOT clear the queue
      // Only clears in-memory tracking (filePathMap, fileSubmittedMap)

      // Step 3: User clicks "next" to submit
      // _submitFileData will clear the failed request before submitting
      await handler.clearFailedRequestByUrl(fileUrl, { fieldKey: 'image1' });

      // Step 4: Submit with empty file array succeeds
      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });

      await handler.runOrSaveRequest(
        mockRun2,
        fileUrl,
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      expect(mockRun2).toHaveBeenCalledTimes(1);
    });

    it('keeps queued request after max retries and marks field as pending', async () => {
      const handlerWithSpy = new OfflineRequestHandler(
        'test-form',
        errorCallback
      );
      const removeSpy = jest
        .spyOn(handlerWithSpy as any, 'removeRequest')
        .mockResolvedValue(undefined);
      const originalFetch = (global as any).fetch;
      (global as any).fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      (handlerWithSpy as any).maxRetryAttempts = 1;
      (handlerWithSpy as any).retryDelayMs = 0;

      const request: any = {
        url: 'https://api.feathery.io/api/panel/step/submit/file',
        method: 'POST',
        headers: JSON.stringify({}),
        body: '',
        bodyType: 'text',
        metadata: { fieldKey: 'FileUpload1' },
        userId: 'user-1',
        key: 99,
        retryAttempts: 0
      };

      jest.useFakeTimers();
      const replayPromise = (handlerWithSpy as any).replayRequest(request);
      while (jest.getTimerCount() > 0) {
        jest.runOnlyPendingTimers();
      }
      await replayPromise;
      jest.useRealTimers();

      // Request should NOT be removed after max retries - it stays in IndexedDB for retry on next submit
      expect(removeSpy).not.toHaveBeenCalled();
      // Field should be marked as pending/failed
      expect(mockFileRetryStatus.FileUpload1).toBe(false);

      removeSpy.mockRestore();
      (global as any).fetch = originalFetch;
    });

    it('does not alert when max retries exhausted for specific field upload', async () => {
      const handlerWithCallback = new OfflineRequestHandler(
        'test-form',
        errorCallback
      );
      const originalFetch = (global as any).fetch;
      (global as any).fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));

      (handlerWithCallback as any).maxRetryAttempts = 1;
      (handlerWithCallback as any).retryDelayMs = 0;

      const request: any = {
        url: 'https://api.feathery.io/api/panel/step/submit/file',
        method: 'POST',
        headers: JSON.stringify({}),
        body: '',
        bodyType: 'text',
        metadata: { fieldKey: 'FileUpload1' },
        userId: 'user-1',
        key: 101,
        retryAttempts: 0
      };

      jest.useFakeTimers();
      const replayPromise = (handlerWithCallback as any).replayRequest(request);
      while (jest.getTimerCount() > 0) {
        jest.runOnlyPendingTimers();
      }
      await replayPromise;
      jest.useRealTimers();

      expect(errorCallback).not.toHaveBeenCalled();
      expect(mockFileRetryStatus.FileUpload1).toBe(false);

      (global as any).fetch = originalFetch;
    });

    it('sends the access link the device holds now, not the queued headers', async () => {
      // A request is queued before _fetch attaches the header, and a replay can
      // outlive the page that queued it, so the link is read at replay time.
      const handlerWithLink = new OfflineRequestHandler(
        'test-form',
        errorCallback
      );
      const removeSpy = jest
        .spyOn(handlerWithLink as any, 'removeRequest')
        .mockResolvedValue(undefined);
      const originalFetch = (global as any).fetch;
      (global as any).fetch = jest.fn().mockResolvedValue({ status: 200 });
      mockInitState.linkToken = 'tok';
      mockInitState.linkSecret = 'secret';

      await (handlerWithLink as any).replayRequest({
        url: `${getApiUrl()}panel/step/submit/v3/`,
        method: 'POST',
        headers: JSON.stringify({ 'Content-Type': 'application/json' }),
        body: '',
        bodyType: 'text',
        key: 103,
        retryAttempts: 0
      });

      // The replay went through on the first attempt, so the header is what the
      // server accepted rather than what a retry happened to send.
      expect(removeSpy).toHaveBeenCalled();
      expect((global as any).fetch).toHaveBeenCalledTimes(1);
      expect((global as any).fetch.mock.calls[0][1].headers).toEqual({
        'X-Feathery-Link': 'tok.secret',
        'Content-Type': 'application/json'
      });

      mockInitState.linkToken = '';
      mockInitState.linkSecret = '';
      (global as any).fetch = originalFetch;
    });
  });

  describe('IndexedDB support detection', () => {
    it('detects when IndexedDB is not supported', () => {
      const handlerWithoutIDB = new OfflineRequestHandler('test-form');
      expect((handlerWithoutIDB as any).indexedDBSupported).toBe(false);
    });

    it('handles saveRequest gracefully without IndexedDB', async () => {
      await expect(
        handler.saveRequest(
          'https://api.example.com/submit',
          { method: 'POST', headers: {}, body: '{}' },
          'submit'
        )
      ).resolves.not.toThrow();
    });

    it('handles dbHasRequest gracefully without IndexedDB', async () => {
      const hasRequest = await handler.dbHasRequest();
      expect(hasRequest).toBe(false);
    });

    it('handles replayRequests gracefully without IndexedDB', async () => {
      await expect(handler.replayRequests()).resolves.not.toThrow();
    });

    it('handles openDatabase returning undefined gracefully', async () => {
      const db = await handler.openDatabase();
      expect(db).toBeUndefined();
    });
  });

  describe('Error callback behavior', () => {
    it('provides error callback to handler', () => {
      const customCallback = jest.fn();
      const customHandler = new OfflineRequestHandler(
        'test-form',
        customCallback
      );
      expect((customHandler as any).errorCallback).toBe(customCallback);
    });

    it('works without error callback', () => {
      expect(() => new OfflineRequestHandler('test-form')).not.toThrow();
    });

    it('accepts optional error callback parameter', () => {
      const handlerNoCallback = new OfflineRequestHandler('test-form');
      expect((handlerNoCallback as any).errorCallback).toBeUndefined();

      const handlerWithCallback = new OfflineRequestHandler(
        'test-form',
        errorCallback
      );
      expect((handlerWithCallback as any).errorCallback).toBe(errorCallback);
    });
  });

  describe('Request serialization readiness', () => {
    it('saveRequest completes without errors', async () => {
      // Without IndexedDB, saveRequest returns early but doesn't throw
      await expect(
        handler.saveRequest(
          'https://api.example.com/submit',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: 'test' })
          },
          'submit'
        )
      ).resolves.not.toThrow();
    });

    it('includes stepKey in request metadata', async () => {
      // This test verifies the signature accepts stepKey
      await expect(
        handler.saveRequest(
          'https://api.example.com/event',
          { method: 'POST', headers: {}, body: '{}' },
          'registerEvent',
          'step1'
        )
      ).resolves.not.toThrow();
    });

    it('handles different request types', async () => {
      const types = ['submit', 'customRequest', 'registerEvent'];

      for (const type of types) {
        await expect(
          handler.saveRequest(
            'https://api.example.com/test',
            { method: 'POST', headers: {}, body: '{}' },
            type
          )
        ).resolves.not.toThrow();
      }
    });
  });

  describe('Form key isolation', () => {
    it('creates handler with specific form key', () => {
      const handler1 = new OfflineRequestHandler('form-1');
      const handler2 = new OfflineRequestHandler('form-2');

      expect((handler1 as any).formKey).toBe('form-1');
      expect((handler2 as any).formKey).toBe('form-2');
    });

    it('isolates operations by form key', async () => {
      const handler1 = new OfflineRequestHandler('form-1');
      const handler2 = new OfflineRequestHandler('form-2');

      // Operations should not interfere with each other
      await handler1.saveRequest(
        'https://api.example.com/1',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      await handler2.saveRequest(
        'https://api.example.com/2',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );

      const hasRequest1 = await handler1.dbHasRequest();
      const hasRequest2 = await handler2.dbHasRequest();

      // Storage failures now retain each form's writes in its own memory queue.
      expect(hasRequest1).toBe(true);
      expect(hasRequest2).toBe(true);
      await handler1.clearFailedRequestByUrl('https://api.example.com/1');
      expect(await handler1.dbHasRequest()).toBe(false);
      expect(await handler2.dbHasRequest()).toBe(true);
    });
  });

  describe('Configuration constants', () => {
    it('uses correct database configuration', () => {
      expect((handler as any).dbName).toBe('requestsDB');
      expect((handler as any).storeName).toBe('requestsStore');
      expect((handler as any).dbVersion).toBe(1);
    });

    it('uses correct retry configuration', () => {
      expect((handler as any).maxRetryAttempts).toBe(4);
      expect((handler as any).retryDelayMs).toBe(2000);
    });
  });

  describe('Online signal management', () => {
    it('manages online signals map', () => {
      expect((handler as any).onlineSignals).toBeInstanceOf(Map);
    });

    it('creates signal promise that can be awaited', () => {
      const promise = handler.onlineAndReplayed();
      expect(promise).toBeInstanceOf(Promise);
    });

    it('allows multiple callers to wait for online state', () => {
      const promise1 = handler.onlineAndReplayed();
      const promise2 = handler.onlineAndReplayed();

      expect(promise1).toBeInstanceOf(Promise);
      expect(promise2).toBeInstanceOf(Promise);
    });
  });

  describe('File upload retry status', () => {
    it('marks pending field as successful when helper invoked', () => {
      expect(mockFileRetryStatus.FileUpload1).toBeUndefined();
      markFileUploadRetrySuccess('FileUpload1');
      expect(mockFileRetryStatus.FileUpload1).toBe(true);
    });
  });

  describe('Upload progress reporting while queued', () => {
    const FILE_URL =
      'https://api.feathery.io/api/panel/step/submit/file/user-1/';

    beforeEach(() => {
      _resetFileUploadProgress();
      setUploadIndicatorEnabled('test-form', true);
    });

    afterEach(() => _resetFileUploadProgress());

    it('fires onQueued when a network error queues the request', async () => {
      startUpload('test-form', 'FileUpload1', ['resume.pdf']);
      expect(getUploadsSnapshot()[0].status).toBe('uploading');

      // A TypeError is the network-failure path that queues for replay
      const onQueued = jest.fn();
      await expect(
        handler.runOrSaveRequest(
          jest.fn().mockRejectedValue(new TypeError('Failed to fetch')),
          FILE_URL,
          { method: 'POST', headers: {}, body: '{}' },
          'submit',
          undefined,
          { fieldKey: 'FileUpload1' },
          onQueued
        )
      ).rejects.toThrow('Failed to fetch');

      // The row is not this handler's to resolve any more — it belongs to the
      // replay engine, which is what onQueued tells the caller
      expect(onQueued).toHaveBeenCalledTimes(1);
    });

    it('fires onQueued when the request is saved because we are offline', async () => {
      startUpload('test-form', 'FileUpload1', ['resume.pdf']);
      const originalOnLine = global.navigator.onLine;
      Object.defineProperty(global.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      const onQueued = jest.fn();
      await handler.runOrSaveRequest(
        jest.fn(),
        FILE_URL,
        { method: 'POST', headers: {}, body: '{}' },
        'submit',
        undefined,
        { fieldKey: 'FileUpload1' },
        onQueued
      );

      expect(onQueued).toHaveBeenCalledTimes(1);

      Object.defineProperty(global.navigator, 'onLine', {
        value: originalOnLine,
        configurable: true
      });
    });
  });

  describe('Integration scenario: Network toggle', () => {
    it('handles network going offline then online', async () => {
      // Start online
      expect(global.navigator.onLine).toBe(true);

      const mockRun1 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun1,
        'https://api.example.com/1',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      expect(mockRun1).toHaveBeenCalled();

      // Go offline
      Object.defineProperty(global.navigator, 'onLine', {
        value: false,
        configurable: true
      });

      const mockRun2 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun2,
        'https://api.example.com/2',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      expect(mockRun2).not.toHaveBeenCalled();

      // Go back online
      Object.defineProperty(global.navigator, 'onLine', {
        value: true,
        configurable: true
      });

      const mockRun3 = jest.fn().mockResolvedValue({ ok: true });
      await handler.runOrSaveRequest(
        mockRun3,
        'https://api.example.com/3',
        { method: 'POST', headers: {}, body: '{}' },
        'submit'
      );
      expect(mockRun3).toHaveBeenCalled();
    });
  });
});
