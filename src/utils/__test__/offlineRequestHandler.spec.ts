/**
 * Integration tests for OfflineRequestHandler
 *
 * These tests verify the high-level behavior and integration:
 * 1. Request queueing behavior when offline/network fails
 * 2. Retaining queued answers until a matching save succeeds
 * 3. Online/offline state handling
 * 4. Retry mechanism and error handling
 * 5. File upload retry scenarios
 *
 * Focus: Integration behavior rather than internal implementation details
 */

import { featheryWindow } from '../browser';
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

  it('reports queued answers only for the current filler before advancing a chat card', async () => {
    const { store, queue } = createQueueWithStorage();
    const answer = {
      type: 'submit',
      stepKey: 'intake',
      url: '/save/',
      body: 'synthetic answer'
    };
    store.seed({ ...answer, userId: 'previous-user' });
    expect(await queue.hasQueuedAnswerWrite()).toBe(false);
    store.seed({ ...answer, userId: 'user-1' });
    expect(await queue.hasQueuedAnswerWrite()).toBe(true);
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
        jest.spyOn(featheryWindow(), 'confirm').mockReturnValue(false);
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

      it('retains rejected answers without retrying them, reports them once and saves the rest', async () => {
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
        // Rejected answers remain durable so reloading cannot unblock completion.
        expect(queuedBodies()).toEqual([
          'invalid answer',
          'invalid custom answer'
        ]);
        expect(errorCallback).toHaveBeenCalledTimes(1);
        expect(errorCallback).toHaveBeenCalledWith(
          expect.stringContaining('could not be saved')
        );
        await queue.replayRequests();
        expect(replayed).toHaveLength(3);
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

      it("finishes once when the link gate refuses another submission's queued event", async () => {
        store.seed({
          ...queuedEvent('Insurance', 'other submission event'),
          userId: 'linked-submission'
        });
        (global as any).fetch = jest.fn(async () => {
          // Lets timers run between attempts, so a replay that loops shows up
          await new Promise((resolve) => setTimeout(resolve, 0));
          return fakeResponse(403, {
            message: 'Link opens another submission'
          });
        });
        const waiter = queue.onlineAndReplayed();

        const isSettled = await Promise.race([
          Promise.all([queue.replayRequests(), waiter]).then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 500)
          )
        ]);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(isSettled).toBe(true);
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
        expect(store.rows()).toHaveLength(1);
      });

      it('refuses completion after replay rejects an answer, until that step is saved again', async () => {
        store.seed({ ...queuedAnswer, body: 'invalid answer' });
        serveReplay((body) => (body === 'invalid answer' ? 400 : 200));
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'Please go back and submit that step again'
        );
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'Please go back and submit that step again'
        );
        expect(sendCompletion).not.toHaveBeenCalled();

        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'corrected answer' },
          'submit',
          'Insurance'
        );
        await completeForm(sendCompletion);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
      });

      it('keeps completion blocked after a rejected answer survives a page reload', async () => {
        store.seed({ ...queuedAnswer, body: 'invalid answer' });
        serveReplay(() => 400);
        await queue.replayRequests();

        queue = new OfflineRequestHandler('test-form', errorCallback);
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'Please go back and submit that step again'
        );

        expect(sendCompletion).not.toHaveBeenCalled();
        expect(replayed).toEqual(['invalid answer']);
        expect(queuedBodies()).toEqual(['invalid answer']);
      });

      it('allows completion after a correction fails offline and then succeeds through replay', async () => {
        store.seed({ ...queuedAnswer, body: 'invalid answer' });
        serveReplay(() => 400);
        await queue.replayRequests();
        await failToSave('corrected answer');

        serveReplay();
        await queue.replayRequests();
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await completeForm(sendCompletion);

        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([]);
      });

      it.each([
        ['removed step', { stepKey: 'Removed step' }],
        [
          'custom fields',
          { stepKey: undefined, url: '/panel/custom/submit/v3/' }
        ],
        ['file', { metadata: { fieldKey: 'card' } }]
      ])(
        'discards only confirmed rejected %s answers before completing',
        async (_kind, overrides) => {
          store.seed({ ...queuedAnswer, ...overrides, rejected: true });
          store.seed({
            ...queuedAnswer,
            userId: 'other-user',
            rejected: true,
            body: 'other user'
          });
          store.seed({
            ...queuedAnswer,
            formKey: 'other-form',
            rejected: true,
            body: 'other form'
          });
          store.seed(queuedEvent('Removed step', 'held event'));
          serveReplay();
          const sendCompletion = jest.fn().mockImplementation(async () => {
            expect(store.rows().map((row) => row.body)).toEqual([
              'other user',
              'other form'
            ]);
            return { ok: true };
          });

          await expect(completeForm(sendCompletion)).rejects.toThrow(
            'could not be saved'
          );
          expect(store.rows()).toHaveLength(_kind === 'removed step' ? 4 : 3);
          expect(sendCompletion).not.toHaveBeenCalled();
          (featheryWindow().confirm as jest.Mock).mockReturnValue(true);
          await completeForm(sendCompletion);

          expect(featheryWindow().confirm).toHaveBeenCalledWith(
            expect.stringContaining('discard')
          );
          expect(sendCompletion).toHaveBeenCalledTimes(1);
          expect(replayed).toEqual(['held event']);
        }
      );

      it('never offers to discard retryable answers alongside rejected answers', async () => {
        store.seed({ ...queuedAnswer, rejected: true });
        store.seed({
          ...queuedAnswer,
          stepKey: 'Contact',
          body: 'offline answer'
        });
        serveReplay(() => 503);
        (featheryWindow().confirm as jest.Mock).mockReturnValue(true);
        const sendCompletion = jest.fn();

        await expect(completeForm(sendCompletion)).rejects.toThrow();

        expect(featheryWindow().confirm).not.toHaveBeenCalled();
        expect(store.rows()).toHaveLength(2);
        expect(sendCompletion).not.toHaveBeenCalled();
      });

      it("does not start repeated replay passes for another user's rejected answers and held events", async () => {
        store.seed({ ...queuedAnswer, userId: 'other-user', rejected: true });
        store.seed({
          ...queuedEvent('Insurance', 'held event'),
          userId: 'other-user'
        });
        const replay = jest.spyOn(queue, 'replayRequests');
        const send = jest.fn().mockResolvedValue({ ok: true });
        for (let index = 0; index < 3; index++)
          await queue.runOrSaveRequest(
            send,
            '/custom_request/',
            { method: 'POST', body: '{}' },
            'customRequest'
          );

        expect(send).toHaveBeenCalledTimes(3);
        expect(replay).not.toHaveBeenCalled();
        expect(store.rows()).toHaveLength(2);
        expect(featheryWindow().confirm).not.toHaveBeenCalled();
      });

      it('offers the same confirmed recovery for rejected memory-only answers', async () => {
        const memoryQueue = new OfflineRequestHandler(
          'test-form',
          errorCallback
        );
        (memoryQueue as any).indexedDBSupported = false;
        jest.spyOn(memoryQueue, 'openDatabase').mockResolvedValue(undefined);
        await memoryQueue.saveRequest(
          stepUrl,
          { method: 'POST', body: 'rejected memory answer' },
          'submit',
          'Removed step'
        );
        serveReplay(() => 400);
        await memoryQueue.replayRequests();
        queue = memoryQueue;
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'could not be saved'
        );
        expect(await queue.dbHasRequest()).toBe(true);

        (featheryWindow().confirm as jest.Mock).mockReturnValue(true);
        await completeForm(sendCompletion);

        expect(await queue.dbHasRequest()).toBe(false);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
      });

      it.each(['abort', 'new rejection', 'changed user'])(
        'keeps completion blocked after discard encounters %s',
        async (scenario) => {
          store.seed({ ...queuedAnswer, rejected: true });
          serveReplay();
          (featheryWindow().confirm as jest.Mock).mockImplementation(() => {
            if (scenario === 'abort') store.abortNextCommit('readwrite');
            if (scenario === 'new rejection')
              store.seed({
                ...queuedAnswer,
                rejected: true,
                body: 'new rejection'
              });
            if (scenario === 'changed user') mockInitInfo.userId = 'other-user';
            return true;
          });
          const sendCompletion = jest.fn();

          await expect(completeForm(sendCompletion)).rejects.toThrow();

          expect(featheryWindow().confirm).toHaveBeenCalledTimes(1);
          expect(sendCompletion).not.toHaveBeenCalled();
          expect(queuedBodies()).toEqual([
            scenario === 'new rejection' ? 'new rejection' : 'answer'
          ]);
        }
      );

      it('keeps rejected custom fields blocked until each field is saved', async () => {
        const customUrl = '/panel/custom/submit/v3/';
        store.seed({
          type: 'submit',
          url: customUrl,
          userId: 'user-1',
          bodyType: 'formData',
          body: {
            custom_key_values: JSON.stringify({
              plan: 'invalid',
              referrer: 'invalid'
            })
          }
        });
        serveReplay(() => 400);
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'could not be saved'
        );

        // A step save cannot acknowledge custom fields that it did not carry.
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'step answers' },
          'submit',
          'Insurance'
        );
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'could not be saved'
        );
        for (const values of [{ plan: 'premium' }, { referrer: 'friend' }]) {
          const body = new FormData();
          body.set('custom_key_values', JSON.stringify(values));
          await queue.runOrSaveRequest(
            async () => ({ ok: true }),
            customUrl,
            { method: 'POST', body },
            'submit'
          );
          if ('plan' in values) {
            await expect(completeForm(sendCompletion)).rejects.toThrow(
              'could not be saved'
            );
          }
        }
        await completeForm(sendCompletion);

        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([]);
      });

      it.each(['', 'pre-redemption-user'])(
        'retries a parked answer after initialization changes user %s to its owner',
        async (initialUser) => {
          mockInitInfo.userId = initialUser;
          store.seed(queuedAnswer);
          (global as any).fetch = jest
            .fn()
            .mockResolvedValue(
              fakeResponse(403, { message: 'Link opens another submission' })
            );
          await queue.replayRequests();
          expect(handleFormAuthenticationError).not.toHaveBeenCalled();
          expect(store.rows()).toHaveLength(1);

          mockInitInfo.userId = 'user-1';
          serveReplay();
          const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
          await completeForm(sendCompletion);

          expect(replayed).toEqual(['answer']);
          expect(sendCompletion).toHaveBeenCalledTimes(1);
          expect(store.rows()).toEqual([]);
        }
      );

      it('holds a rejected step event while later steps and corrections can still save', async () => {
        store.seed({ ...queuedAnswer, body: 'invalid answer' });
        store.seed(queuedEvent('Insurance', 'insurance event'));
        store.seed({
          ...queuedAnswer,
          stepKey: 'Contact',
          body: 'contact answer'
        });
        store.seed(queuedEvent('Contact', 'contact event'));
        serveReplay((body) => (body === 'invalid answer' ? 400 : 200));

        await queue.replayRequests();
        expect(replayed).toEqual([
          'invalid answer',
          'contact answer',
          'contact event'
        ]);
        expect(queuedBodies()).toEqual(['invalid answer', 'insurance event']);

        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'corrected answer' },
          'submit',
          'Insurance'
        );
        await queue.replayRequests();

        expect(replayed).toEqual([
          'invalid answer',
          'contact answer',
          'contact event',
          'insurance event'
        ]);
        expect(store.rows()).toEqual([]);
      });

      it('clears rejected custom fields when their queued correction succeeds through replay', async () => {
        const customUrl = '/panel/custom/submit/v3/';
        store.seed({
          type: 'submit',
          url: customUrl,
          userId: 'user-1',
          bodyType: 'formData',
          body: { custom_key_values: JSON.stringify({ plan: 'invalid' }) }
        });
        serveReplay(() => 400);
        await queue.replayRequests();
        const body = new FormData();
        body.set('custom_key_values', JSON.stringify({ plan: 'premium' }));
        await expect(
          queue.runOrSaveRequest(
            failedRun,
            customUrl,
            { method: 'POST', body },
            'submit'
          )
        ).rejects.toThrow('Failed to fetch');

        serveReplay();
        await queue.replayRequests();
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await completeForm(sendCompletion);

        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([]);
      });

      it('reconsiders a parked answer on reconnect once its owner becomes current', async () => {
        mockInitInfo.userId = '';
        store.seed(queuedAnswer);
        (global as any).fetch = jest
          .fn()
          .mockResolvedValue(
            fakeResponse(403, { message: 'Link opens another submission' })
          );
        await queue.replayRequests();
        mockInitInfo.userId = 'user-1';
        serveReplay();

        await queue.replayRequests();

        expect(replayed).toEqual(['answer']);
        expect(store.rows()).toEqual([]);
      });

      it('supersedes an older upload for a user id its stored URL percent-encodes', async () => {
        mockInitInfo.userId = 'user one';
        store.seed({
          ...queuedAnswer,
          userId: 'user one',
          url: '/panel/step/submit/file/user%20one/',
          metadata: { fieldKey: 'card' },
          body: 'older card'
        });
        // The server cannot take the queued upload yet
        serveReplay(() => 503);

        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          '/panel/step/submit/file/user one/',
          { method: 'POST', body: 'newer card' },
          'submit',
          'Insurance',
          { fieldKey: 'card' }
        );

        expect(store.rows()).toEqual([]);
      });

      it('attributes rows from SDK builds that did not record the user, then resets and supersedes them', async () => {
        const fileUrl = '/panel/step/submit/file/user-1/';
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          body: JSON.stringify({ fuser_key: 'user-1', step_key: 'Insurance' }),
          retryAttempts: 4
        });
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          url: fileUrl,
          metadata: { fieldKey: 'card' },
          body: 'card upload',
          retryAttempts: 4
        });

        await queue.resetAnswerWriteRetries();
        expect(
          store.rows().map((row) => [row.userId, row.retryAttempts])
        ).toEqual([
          ['user-1', 0],
          ['user-1', 0]
        ]);

        // The server cannot take the queued rows, but newer saves of the same
        // step snapshot and file field land and replace them
        serveReplay(() => 503);
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'newer snapshot' },
          'submit',
          'Insurance'
        );
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          fileUrl,
          { method: 'POST', body: 'newer card' },
          'submit',
          'Insurance',
          { fieldKey: 'card' }
        );
        expect(store.rows()).toEqual([]);
      });

      it('preserves malformed legacy rows without blocking later attribution or reads', async () => {
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          url: '/panel/step/submit/file/50%off/',
          body: 'card upload'
        });
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          bodyType: 'blob',
          body: { damaged: true }
        });
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          bodyType: 'formData',
          body: null
        });
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          body: JSON.stringify({ fuser_key: 'user-1' })
        });

        await queue.resetAnswerWriteRetries();
        await queue.resetAnswerWriteRetries();

        expect(store.rows()).toHaveLength(4);
        expect(store.rows()[0].userId).toBe('50%off');
        expect(store.rows()[1].body).toEqual({ damaged: true });
        expect(store.rows()[2].body).toBeNull();
        expect(store.rows()[3].userId).toBe('user-1');
      });

      it('decodes an unattributable legacy body once per page and keeps later reads readonly', async () => {
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          bodyType: 'blob',
          retryAttempts: 4,
          body: new TextEncoder().encode('legacy multipart without a user')
            .buffer
        });
        const decode = jest.spyOn(TextDecoder.prototype, 'decode');

        await queue.replayRequests();
        await queue.replayRequests();
        await queue.replayRequests();

        expect(decode).toHaveBeenCalledTimes(1);
        expect(store.transactionModes.length).toBeGreaterThan(0);
        expect(
          store.transactionModes.every((mode) => mode === 'readonly')
        ).toBe(true);
        expect(store.rows()).toHaveLength(1);
      });

      it.each(['abort', 'error'] as const)(
        'settles a queue-read transaction %s and releases replay waiters without losing rows',
        async (event) => {
          store.seed(queuedAnswer);
          serveReplay();
          const waiter = queue.onlineAndReplayed();
          store.failNextTransaction(event);

          await expect(queue.replayRequests()).rejects.toThrow(
            'Saved answers could not be read'
          );
          await waiter;
          expect(replayed).toEqual([]);
          expect(queuedBodies()).toEqual(['answer']);

          await queue.replayRequests();
          expect(replayed).toEqual(['answer']);
          expect(store.rows()).toEqual([]);
        }
      );

      it.each(['abort', 'error'] as const)(
        'sends a live answer after a queue-count transaction %s and retires its older snapshot',
        async (event) => {
          store.seed(queuedAnswer);
          store.failNextTransaction(event);
          serveReplay();
          const send = jest.fn().mockResolvedValue({ ok: true });

          // Queue-read failures must not prevent sending the user's live answer.
          await expect(
            queue.runOrSaveRequest(
              send,
              stepUrl,
              { method: 'POST', body: 'new answer' },
              'submit',
              'Insurance'
            )
          ).resolves.toEqual({ ok: true });
          expect(send).toHaveBeenCalledTimes(1);

          await queue.replayRequests();
          expect(replayed).toEqual([]);
          expect(store.rows()).toEqual([]);
        }
      );

      it('sends a live answer when previously usable storage cannot reopen and reconciles before replay', async () => {
        store.seed(queuedAnswer);
        await queue.dbHasRequest();
        const openDatabase = jest
          .spyOn(queue, 'openDatabase')
          .mockResolvedValue(undefined);
        const send = jest.fn().mockResolvedValue({ ok: true });

        await expect(
          queue.runOrSaveRequest(
            send,
            stepUrl,
            { method: 'POST', body: 'new answer' },
            'submit',
            'Insurance'
          )
        ).resolves.toEqual({ ok: true });
        expect(send).toHaveBeenCalledTimes(1);
        openDatabase.mockRestore();
        serveReplay();
        await queue.replayRequests();

        expect(replayed).toEqual([]);
        expect(store.rows()).toEqual([]);
      });

      it('preserves a newer snapshot from another tab when an outage delays live-save cleanup', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1000);
        store.seed({ ...queuedAnswer, timestamp: 100, body: 'old answer' });
        await queue.dbHasRequest();
        const openDatabase = jest
          .spyOn(queue, 'openDatabase')
          .mockResolvedValue(undefined);
        let finishSave!: (response: any) => void;
        const saving = queue.runOrSaveRequest(
          () =>
            new Promise((resolve) => {
              finishSave = resolve;
            }),
          stepUrl,
          { method: 'POST', body: 'live answer' },
          'submit',
          'Insurance'
        );
        saving.catch(() => {});
        await waitUntil(() => !!finishSave);
        store.seed({
          ...queuedAnswer,
          timestamp: 2000,
          pageId: 'other-tab',
          writeOrder: 1,
          body: 'newer answer'
        });
        finishSave({ ok: true });
        await saving;
        openDatabase.mockRestore();
        serveReplay();

        await queue.replayRequests();

        expect(replayed).toEqual(['newer answer']);
        expect(store.rows()).toEqual([]);
      });

      it('holds an equal-timestamp answer from another tab until a scoped resubmission resolves its order', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1000);
        store.seed({
          ...queuedAnswer,
          timestamp: 1000,
          pageId: 'other-tab',
          writeOrder: 1,
          body: 'other tab answer'
        });
        await queue.dbHasRequest();
        const openDatabase = jest
          .spyOn(queue, 'openDatabase')
          .mockResolvedValue(undefined);
        const send = jest.fn().mockResolvedValue({ ok: true });

        await expect(
          queue.runOrSaveRequest(
            send,
            stepUrl,
            { method: 'POST', body: 'live answer' },
            'submit',
            'Insurance'
          )
        ).resolves.toEqual({ ok: true });
        openDatabase.mockRestore();
        serveReplay();

        await expect(queue.replayRequests()).rejects.toThrow(
          'need to be submitted again'
        );
        expect(replayed).toEqual([]);
        expect(queuedBodies()).toEqual(['other tab answer']);

        await expect(
          queue.runOrSaveRequest(
            send,
            stepUrl,
            { method: 'POST', body: 'confirmed latest answer' },
            'submit',
            'Insurance'
          )
        ).resolves.toEqual({ ok: true });
        await queue.replayRequests();

        expect(send).toHaveBeenCalledTimes(2);
        expect(replayed).toEqual([]);
        expect(store.rows()).toEqual([]);
      });

      it('isolates an ambiguous cleanup across an in-page user switch until its owner resubmits', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1000);
        store.seed({
          ...queuedAnswer,
          timestamp: 1000,
          pageId: 'other-tab',
          writeOrder: 1,
          body: 'user A queued answer'
        });
        store.seed(queuedEvent('Contact', 'user A queued event'));
        await queue.dbHasRequest();
        const openDatabase = jest
          .spyOn(queue, 'openDatabase')
          .mockResolvedValue(undefined);
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'user A live answer' },
          'submit',
          'Insurance'
        );
        openDatabase.mockRestore();
        mockInitInfo.userId = 'user-2';
        serveReplay();
        const sendUserB = jest.fn().mockResolvedValue({ ok: true });
        await queue.runOrSaveRequest(
          sendUserB,
          stepUrl,
          { method: 'POST', body: 'user B answer' },
          'submit',
          'Contact'
        );
        const completeUserB = jest.fn().mockResolvedValue({ ok: true });
        await completeForm(completeUserB);

        expect(sendUserB).toHaveBeenCalledTimes(1);
        expect(completeUserB).toHaveBeenCalledTimes(1);
        expect(replayed).toEqual([]);
        expect(queuedBodies()).toEqual([
          'user A queued answer',
          'user A queued event'
        ]);

        mockInitInfo.userId = 'user-1';
        const completeUserA = jest.fn(async () => {
          expect(replayed).toEqual(['user A queued event']);
          return { ok: true };
        });
        await expect(completeForm(completeUserA)).rejects.toThrow(
          'need to be submitted again'
        );
        expect(completeUserA).not.toHaveBeenCalled();
        await queue.runOrSaveRequest(
          async () => ({ ok: true }),
          stepUrl,
          { method: 'POST', body: 'user A resubmitted answer' },
          'submit',
          'Insurance'
        );
        await completeForm(completeUserA);
        expect(completeUserA).toHaveBeenCalledTimes(1);
        expect(replayed).toEqual(['user A queued event']);
        expect(store.rows()).toEqual([]);
      });

      it('drains cleanup added by a successful live save while replay starts reconciliation', async () => {
        store.seed({ ...queuedAnswer, retryAttempts: 4 });
        let finishSave!: (response: any) => void;
        const saving = queue.runOrSaveRequest(
          () =>
            new Promise((resolve) => {
              finishSave = resolve;
            }),
          stepUrl,
          { method: 'POST', body: 'live answer' },
          'submit',
          'Insurance'
        );
        await waitUntil(() => !!finishSave);
        await queue.resetAnswerWriteRetries();
        const reconcile = (queue as any).reconcileLiveWriteCleanups.bind(queue);
        let hasFinishedSave = false;
        jest
          .spyOn(queue as any, 'reconcileLiveWriteCleanups')
          .mockImplementation(() => {
            if (!hasFinishedSave) {
              hasFinishedSave = true;
              // The live save resumes while the empty reconciliation worker settles.
              finishSave({ ok: true });
            }
            return reconcile();
          });
        serveReplay();

        await Promise.all([queue.replayRequests(), saving]);

        expect(replayed).toEqual([]);
        expect(store.rows()).toEqual([]);
      });

      it('holds a custom replay snapshot acknowledged while its live cleanup starts', async () => {
        const customUrl = '/panel/custom/submit/v3/';
        store.seed({
          type: 'submit',
          userId: 'user-1',
          url: customUrl,
          retryAttempts: 4,
          bodyType: 'formData',
          body: {
            custom_key_values: JSON.stringify({
              plan: 'basic',
              referrer: 'friend'
            })
          }
        });
        const body = new FormData();
        body.set('custom_key_values', JSON.stringify({ plan: 'premium' }));
        let finishSave!: (response: any) => void;
        const saving = queue.runOrSaveRequest(
          () =>
            new Promise((resolve) => {
              finishSave = resolve;
            }),
          customUrl,
          { method: 'POST', body },
          'submit'
        );
        await waitUntil(() => !!finishSave);
        await queue.resetAnswerWriteRetries();
        const reconcile = (queue as any).reconcileLiveWriteCleanups.bind(queue);
        let hasFinishedSave = false;
        jest
          .spyOn(queue as any, 'reconcileLiveWriteCleanups')
          .mockImplementation(() => {
            if (!hasFinishedSave) {
              hasFinishedSave = true;
              finishSave({ ok: true });
            }
            return reconcile();
          });
        const replayedValues: Record<string, string>[] = [];
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayedValues.push(
            JSON.parse(options.body.get('custom_key_values'))
          );
          return fakeResponse(200);
        });

        await Promise.all([queue.replayRequests(), saving]);
        await queue.replayRequests();

        expect(replayedValues).toEqual([{ referrer: 'friend' }]);
        expect(store.rows()).toEqual([]);
      });

      it('uses enqueue order to preserve only newer same-page offline answers with equal timestamps', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(1000);
        await queue.saveRequest(
          stepUrl,
          { method: 'POST', body: 'older answer' },
          'submit',
          'Insurance'
        );
        const openDatabase = jest
          .spyOn(queue, 'openDatabase')
          .mockResolvedValue(undefined);
        let finishSave!: (response: any) => void;
        const saving = queue.runOrSaveRequest(
          () =>
            new Promise((resolve) => {
              finishSave = resolve;
            }),
          stepUrl,
          { method: 'POST', body: 'live answer' },
          'submit',
          'Insurance'
        );
        saving.catch(() => {});
        await waitUntil(() => !!finishSave);
        await queue.saveRequest(
          stepUrl,
          { method: 'POST', body: 'newer answer' },
          'submit',
          'Insurance'
        );
        finishSave({ ok: true });
        await saving;
        openDatabase.mockRestore();
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayed.push(
            typeof options.body === 'string'
              ? options.body
              : await options.body.text()
          );
          return fakeResponse(200);
        });

        await queue.replayRequests();

        expect(replayed).toEqual(['newer answer']);
        await expect(queue.dbHasRequest()).resolves.toBe(false);
      });

      it('retains a failed live answer in memory during a storage outage and replays it after recovery', async () => {
        await queue.dbHasRequest();
        const openDatabase = jest
          .spyOn(queue, 'openDatabase')
          .mockResolvedValue(undefined);
        const send = jest
          .fn()
          .mockRejectedValue(new TypeError('Failed to fetch'));

        await expect(
          queue.runOrSaveRequest(
            send,
            stepUrl,
            { method: 'POST', body: 'pending answer' },
            'submit',
            'Insurance'
          )
        ).rejects.toThrow('Failed to fetch');
        expect(send).toHaveBeenCalledTimes(1);
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await expect(completeForm(sendCompletion)).rejects.toThrow(/answers/i);
        expect(sendCompletion).not.toHaveBeenCalled();

        openDatabase.mockRestore();
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayed.push(
            typeof options.body === 'string'
              ? options.body
              : await options.body.text()
          );
          return fakeResponse(200);
        });
        await queue.replayRequests();
        await completeForm(sendCompletion);

        expect(replayed).toEqual(['pending answer']);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
        await expect(queue.dbHasRequest()).resolves.toBe(false);
      });

      it.each([
        ['step', 'read'],
        ['step', 'commit'],
        ['file', 'read'],
        ['file', 'commit']
      ])(
        'keeps a successful live %s save successful after a cleanup %s failure',
        async (kind, failure) => {
          const url =
            kind === 'file' ? '/panel/step/submit/file/user-1/' : stepUrl;
          const metadata = kind === 'file' ? { fieldKey: 'card' } : undefined;
          store.seed({ ...queuedAnswer, url, metadata, retryAttempts: 4 });
          serveReplay();
          const send = jest.fn(async () => {
            if (failure === 'read')
              store.failNextTransaction('abort', 'readonly');
            else store.abortNextCommit('readwrite');
            return { ok: true };
          });

          await expect(
            queue.runOrSaveRequest(
              send,
              url,
              { method: 'POST', body: 'new answer' },
              'submit',
              'Insurance',
              metadata
            )
          ).resolves.toEqual({ ok: true });
          expect(send).toHaveBeenCalledTimes(1);
          await queue.replayRequests();

          expect(replayed).toEqual([]);
          expect(store.rows()).toEqual([]);
        }
      );

      it('reconciles a custom save after cleanup fails without discarding unrelated fields or another user', async () => {
        const customUrl = '/panel/custom/submit/v3/';
        store.seed({
          type: 'submit',
          userId: 'user-1',
          url: customUrl,
          retryAttempts: 4,
          bodyType: 'formData',
          body: {
            custom_key_values: JSON.stringify({
              plan: 'basic',
              referrer: 'friend'
            })
          }
        });
        store.seed({
          type: 'submit',
          userId: 'other-user',
          url: customUrl,
          retryAttempts: 4,
          bodyType: 'formData',
          body: {
            custom_key_values: JSON.stringify({ plan: 'other user plan' })
          }
        });
        const body = new FormData();
        body.set('custom_key_values', JSON.stringify({ plan: 'premium' }));
        const send = jest.fn(async () => {
          store.abortNextCommit('readwrite');
          return { ok: true };
        });

        await expect(
          queue.runOrSaveRequest(
            send,
            customUrl,
            { method: 'POST', body },
            'submit'
          )
        ).resolves.toEqual({ ok: true });
        const replayedValues: Record<string, string>[] = [];
        (global as any).fetch = jest.fn(async (_url: string, options: any) => {
          replayedValues.push(
            JSON.parse(options.body.get('custom_key_values'))
          );
          return fakeResponse(200);
        });
        await queue.resetAnswerWriteRetries();
        await queue.replayRequests();

        expect(send).toHaveBeenCalledTimes(1);
        expect(replayedValues).toEqual([{ referrer: 'friend' }]);
        expect(store.rows()).toEqual([
          expect.objectContaining({
            userId: 'other-user',
            body: {
              custom_key_values: JSON.stringify({ plan: 'other user plan' })
            }
          })
        ]);
      });

      it('retains the answer if its rejection update aborts at commit, then recovers after reload', async () => {
        store.seed(queuedAnswer);
        (global as any).fetch = jest.fn(async () => {
          store.abortNextCommit();
          return fakeResponse(400);
        });

        await expect(queue.replayRequests()).rejects.toThrow(
          'QuotaExceededError'
        );
        expect(queuedBodies()).toEqual(['answer']);
        expect(store.rows()[0].rejected).toBeUndefined();

        queue = new OfflineRequestHandler('test-form', errorCallback);
        serveReplay();
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await completeForm(sendCompletion);

        expect(replayed).toEqual(['answer']);
        expect(sendCompletion).toHaveBeenCalledTimes(1);
        expect(store.rows()).toEqual([]);
      });

      it('blocks completion when storage holding a rejected answer becomes unavailable', async () => {
        store.seed(queuedAnswer);
        serveReplay(() => 400);
        await queue.replayRequests();
        const openDatabase = jest
          .spyOn(queue as any, 'openDatabase')
          .mockResolvedValue(undefined);
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'Saved answers could not be read'
        );
        expect(sendCompletion).not.toHaveBeenCalled();
        expect(queuedBodies()).toEqual(['answer']);
        openDatabase.mockRestore();

        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'submit that step again'
        );
        expect(sendCompletion).not.toHaveBeenCalled();
      });

      it('retries an aborted legacy attribution commit without decoding the body again', async () => {
        store.seed({
          ...queuedAnswer,
          userId: undefined,
          retryAttempts: 4,
          bodyType: 'blob',
          body: new TextEncoder().encode(
            JSON.stringify({ fuser_key: 'user-1' })
          ).buffer
        });
        const decode = jest.spyOn(TextDecoder.prototype, 'decode');
        store.abortNextCommit('readwrite');

        await expect(queue.dbHasRequest()).resolves.toBe(true);
        expect(store.rows()[0].userId).toBeUndefined();
        await queue.resetAnswerWriteRetries();

        expect(store.rows()[0]).toEqual(
          expect.objectContaining({ userId: 'user-1', retryAttempts: 0 })
        );
        expect(decode).toHaveBeenCalledTimes(1);
      });

      it.each(['abort', 'error'] as const)(
        'settles a retry-budget transaction %s during manual completion and allows a later retry',
        async (event) => {
          store.seed({ ...queuedAnswer, retryAttempts: 4 });
          store.failNextTransaction(event, 'readwrite');
          const sendCompletion = jest.fn().mockResolvedValue({ ok: true });

          await expect(completeForm(sendCompletion)).rejects.toThrow();
          expect(sendCompletion).not.toHaveBeenCalled();
          expect(store.rows()[0].retryAttempts).toBe(4);

          await queue.resetAnswerWriteRetries();
          expect(store.rows()[0].retryAttempts).toBe(0);
          serveReplay();
          await completeForm(sendCompletion);
          expect(sendCompletion).toHaveBeenCalledTimes(1);
        }
      );

      it.each(['read', 'commit'] as const)(
        'retains a successful correction after a cleanup %s failure without sending it again',
        async (failure) => {
          store.seed({
            ...queuedAnswer,
            body: 'invalid answer',
            rejected: true
          });
          store.seed({ ...queuedAnswer, body: 'corrected answer' });
          (global as any).fetch = jest.fn(
            async (_url: string, options: any) => {
              replayed.push(options.body);
              if (failure === 'read')
                store.failNextTransaction('abort', 'readonly');
              else store.abortNextCommit('readwrite');
              return fakeResponse(200);
            }
          );

          await expect(queue.replayRequests()).rejects.toThrow();
          expect(replayed).toEqual(['corrected answer']);
          expect(queuedBodies()).toEqual([
            'invalid answer',
            'corrected answer'
          ]);

          await queue.replayRequests();
          expect(replayed).toEqual(['corrected answer']);
          expect(store.rows()).toEqual([]);
        }
      );

      it('reports a rejected memory-only answer once while retaining the completion gate', async () => {
        (queue as any).indexedDBSupported = false;
        await queue.saveRequest(
          stepUrl,
          { method: 'POST', body: 'invalid answer' },
          'submit',
          'Insurance'
        );
        serveReplay(() => 400);

        await queue.replayRequests();
        await queue.replayRequests();

        expect(errorCallback).toHaveBeenCalledTimes(1);
        expect(errorCallback).toHaveBeenCalledWith(
          expect.stringContaining('could not be saved')
        );
        expect((global as any).fetch).toHaveBeenCalledTimes(1);
        const sendCompletion = jest.fn().mockResolvedValue({ ok: true });
        await expect(completeForm(sendCompletion)).rejects.toThrow(
          'submit that step again'
        );
        expect(sendCompletion).not.toHaveBeenCalled();
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

    it('retains an exhausted file upload and marks it pending without alerting', async () => {
      const { store, queue } = createQueueWithStorage();
      const originalFetch = (global as any).fetch;
      (global as any).fetch = jest
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch'));
      (queue as any).maxRetryAttempts = 1;
      store.seed({
        type: 'submit',
        stepKey: 'Insurance',
        url: 'https://api.feathery.io/api/panel/step/submit/file/user-1/',
        metadata: { fieldKey: 'FileUpload1' },
        userId: 'user-1'
      });

      try {
        await queue.replayRequests();

        expect(store.rows()).toEqual([
          expect.objectContaining({ retryAttempts: 1 })
        ]);
        expect(mockFileRetryStatus.FileUpload1).toBe(false);
        expect(errorCallback).not.toHaveBeenCalled();
      } finally {
        (global as any).fetch = originalFetch;
      }
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
        'https://api.example.com/panel/step/submit/file/user-1/',
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
      (global as any).fetch = jest.fn().mockResolvedValue(fakeResponse(200));
      await handler1.replayRequests();
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
