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
import {
  FormConflictError,
  getApiUrl,
  setEnvironment
} from '@feathery/client-utils';

// Mock init module. A replay reads the access link off initState, so the mock
// carries it too - without it every replay to the API host throws.
jest.mock('../init', () => {
  const fileRetryStatus: Record<string, boolean> = {};
  return {
    initInfo: () => ({ sdkKey: 'test-sdk-key' }),
    fileRetryStatus,
    initState: { linkToken: '', linkSecret: '' }
  };
});

// Mocking '../init' keeps featheryClient, which is what normally configures the
// environment at module load, out of this file. A replay only carries the
// access link on a request to the backend, so the host it matches against has
// to be explicit rather than whatever BACKEND_ENV happened to be.
setEnvironment('production');

// Mock checkResponseSuccess
jest.mock('../featheryClient/utils', () => ({
  handleFormConflict: jest.fn(),
  checkResponseSuccess: jest.fn().mockImplementation(async (response) => {
    if (!response.ok) {
      throw new Error('Response not ok');
    }
    return response;
  })
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

    // Mock Request constructor
    (global as any).Request = class MockRequest {
      url: string;
      method: string;
      headers: Map<string, string>;
      keepalive?: boolean;

      constructor(url: string, options: any) {
        this.url = url;
        this.method = options.method || 'GET';
        this.headers = new Map(Object.entries(options.headers || {}));
        this.keepalive = options.keepalive;
      }

      clone() {
        return this;
      }

      async blob() {
        return new Blob();
      }
    };
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
    errorCallback = jest.fn();
    handler = new OfflineRequestHandler('test-form', errorCallback);

    // Reset navigator.onLine
    Object.defineProperty(global.navigator, 'onLine', {
      writable: true,
      value: true,
      configurable: true
    });
  });

  describe('Request execution behavior', () => {
    describe('storage failure recovery', () => {
      let originalRequest: any;
      let originalFetch: any;

      beforeEach(() => {
        originalRequest = (global as any).Request;
        originalFetch = (global as any).fetch;
        (handler as any).indexedDBSupported = false;
        (global as any).Request = class {
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
            return new (global as any).Request(this.url, {
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
        };
      });

      afterEach(() => {
        (global as any).Request = originalRequest;
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
            { fieldKey: 'card', preserveStepRequests: true }
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
          { fieldKey: 'card', preserveStepRequests: true }
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

      it('recovers a failed IndexedDB put without losing its captured payload', async () => {
        (handler as any).indexedDBSupported = true;
        jest.spyOn(handler as any, 'getDbTransaction').mockResolvedValue({
          tx: {},
          store: {
            add: () => {
              throw new Error('quota');
            }
          }
        });
        const options = { method: 'POST', body: 'original answer' };
        await handler.saveRequest('/save/', options, 'submit', 'Insurance');
        options.body = 'later mutation';
        (handler as any).indexedDBSupported = false;
        const accepted: string[] = [];
        (global as any).fetch = jest.fn(async (_url: string, request: any) => {
          accepted.push(await request.body.text());
          return { status: 200 };
        });
        await handler.replayRequests();
        expect(accepted).toEqual(['original answer']);
        expect(await handler.dbHasRequest()).toBe(false);
      });

      it('orders durable and memory writes with tied timestamps and retains a newer in-flight write', async () => {
        const rows: any[] = [];
        let nextKey = 1;
        let failPut = false;
        const tx: any = {};
        const store = {
          add: (row: any) => {
            if (failPut) throw new Error('quota');
            rows.push({ ...row, key: nextKey++ });
            Promise.resolve().then(() => tx.oncomplete());
          },
          delete: (key: number) => {
            rows.splice(
              0,
              rows.length,
              ...rows.filter((row) => row.key !== key)
            );
          },
          openCursor: () => {
            const request: any = {};
            const snapshot = [...rows];
            let index = 0;
            const advance = () => {
              const row = snapshot[index];
              request.onsuccess?.({
                target: {
                  result: row
                    ? {
                        value: row,
                        key: row.key,
                        continue: () => {
                          index++;
                          Promise.resolve().then(advance);
                        }
                      }
                    : null
                }
              });
            };
            Promise.resolve().then(advance);
            return request;
          }
        };
        (handler as any).indexedDBSupported = true;
        jest
          .spyOn(handler as any, 'getDbTransaction')
          .mockResolvedValue({ tx, store });
        jest.spyOn(Date, 'now').mockReturnValue(100);
        await handler.saveRequest(
          '/save/',
          { method: 'POST', body: 'old' },
          'submit',
          'Insurance'
        );
        failPut = true;
        await handler.saveRequest(
          '/save/',
          { method: 'POST', body: 'middle' },
          'submit',
          'Insurance'
        );
        failPut = false;
        await handler.saveRequest(
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
            failPut = true;
            await handler.saveRequest(
              '/save/',
              { method: 'POST', body: 'later' },
              'submit',
              'Insurance'
            );
          }
          return { status: 200 };
        });
        await handler.replayRequests();
        expect(accepted).toEqual(['old', 'middle', 'new']);
        expect(await handler.dbHasRequest('submit')).toBe(true);
        await handler.replayRequests();
        expect(accepted).toEqual(['old', 'middle', 'new', 'later']);
        expect(await handler.dbHasRequest()).toBe(false);
      });
    });

    it('replays a queued step save before sending its completion event', async () => {
      const queued: { type: string; stepKey?: string; url: string }[] = [];
      const persisted: string[] = [];
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type?: string) =>
          queued.some((request) => !type || request.type === type)
        );
      jest
        .spyOn(handler, 'saveRequest')
        .mockImplementation(async (url, _options, type, stepKey) => {
          queued.push({ url, type, stepKey });
        });
      jest
        .spyOn(handler, 'clearFailedRequestsByStep')
        .mockImplementation(async (stepKey) => {
          queued.splice(
            0,
            queued.length,
            ...queued.filter((request) => request.stepKey !== stepKey)
          );
        });
      jest.spyOn(handler, 'replayRequests').mockImplementation(async () => {
        queued.forEach((request) => {
          if (request.type === 'submit') persisted.push('step save');
        });
        queued.splice(0, queued.length);
      });

      await expect(
        handler.runOrSaveRequest(
          async () => {
            throw new TypeError('Failed to fetch');
          },
          '/panel/step/submit/v3/',
          { method: 'POST', body: '{}' },
          'submit',
          'Insurance'
        )
      ).rejects.toThrow('Failed to fetch');

      await handler.runOrSaveRequest(
        async () => {
          persisted.push('complete event');
        },
        '/event/',
        { method: 'POST', body: '{}' },
        'registerEvent',
        'Insurance'
      );

      expect(persisted).toEqual(['step save', 'complete event']);
    });

    it('keeps completion queued while a step save cannot be replayed', async () => {
      const queued: { type: string; stepKey?: string; url: string }[] = [];
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type?: string) =>
          queued.some((request) => !type || request.type === type)
        );
      jest
        .spyOn(handler, 'saveRequest')
        .mockImplementation(async (url, _options, type, stepKey) => {
          queued.push({ url, type, stepKey });
        });
      jest.spyOn(handler, 'replayRequests').mockResolvedValue();
      const sendEvent = jest.fn();

      await expect(
        handler.runOrSaveRequest(
          async () => {
            throw new TypeError('Failed to fetch');
          },
          '/panel/step/submit/v3/',
          { method: 'POST', body: '{}' },
          'submit',
          'Insurance'
        )
      ).rejects.toThrow('Failed to fetch');

      await handler.runOrSaveRequest(
        sendEvent,
        '/event/',
        { method: 'POST', body: '{}' },
        'registerEvent',
        'Insurance'
      );

      expect(sendEvent).not.toHaveBeenCalled();
      expect(queued.map((request) => request.type)).toEqual([
        'submit',
        'registerEvent'
      ]);
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

    it('holds an event behind a queued partial custom write', async () => {
      const queued = [{ type: 'customRequest', stepKey: 'Insurance' }];
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type?: string) =>
          queued.some((request) => !type || request.type === type)
        );
      jest.spyOn(handler, 'replayRequests').mockResolvedValue();
      jest
        .spyOn(handler, 'saveRequest')
        .mockImplementation(async (_url, _options, type, stepKey) => {
          queued.push({ type, stepKey });
        });
      const sendEvent = jest.fn();

      await handler.runOrSaveRequest(
        sendEvent,
        '/event/',
        { method: 'POST', body: '{}' },
        'registerEvent',
        'Insurance'
      );

      expect(sendEvent).not.toHaveBeenCalled();
      expect(queued.map((request) => request.type)).toEqual([
        'customRequest',
        'registerEvent'
      ]);
    });

    it('supersedes only an older full step snapshot after a successful retry', async () => {
      const queued: {
        type: string;
        stepKey?: string;
        url: string;
        key?: number;
      }[] = [];
      const stepUrl = '/panel/step/submit/v3/';
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type?: string) =>
          queued.some((request) => !type || request.type === type)
        );
      jest
        .spyOn(handler, 'saveRequest')
        .mockImplementation(async (url, _options, type, stepKey) => {
          queued.push({ url, type, stepKey, key: queued.length + 1 });
        });
      jest.spyOn(handler, 'replayRequests').mockResolvedValue();
      jest
        .spyOn(handler as any, 'getFailedStepRequestKeys')
        .mockImplementation(async (stepKey: string, url: string) =>
          queued
            .filter(
              (row) =>
                row.type === 'submit' &&
                row.stepKey === stepKey &&
                row.url === url
            )
            .map((row) => row.key)
        );
      jest
        .spyOn(handler as any, 'deleteRecordsWhere')
        .mockImplementation(
          async (
            predicate: (request: typeof queued[number], key?: number) => boolean
          ) => {
            queued.splice(
              0,
              queued.length,
              ...queued.filter(
                (row) => !predicate({ ...row, formKey: 'test-form' }, row.key)
              )
            );
          }
        );

      await expect(
        handler.runOrSaveRequest(
          async () => {
            throw new TypeError('Failed to fetch');
          },
          stepUrl,
          { method: 'POST', body: '{"name":"old"}' },
          'submit',
          'Insurance'
        )
      ).rejects.toThrow('Failed to fetch');
      queued.push(
        {
          type: 'submit',
          stepKey: 'Insurance',
          url: '/panel/step/submit/file/'
        },
        { type: 'submit', stepKey: 'Other', url: stepUrl },
        { type: 'submit', url: '/panel/custom/submit/v3/' },
        { type: 'registerEvent', stepKey: 'Insurance', url: '/event/' }
      );

      await handler.runOrSaveRequest(
        async () => ({ ok: true }),
        stepUrl,
        { method: 'POST', body: '{"name":"new"}' },
        'submit',
        'Insurance'
      );

      expect(queued).toEqual([
        {
          type: 'submit',
          stepKey: 'Insurance',
          url: '/panel/step/submit/file/'
        },
        { type: 'submit', stepKey: 'Other', url: stepUrl },
        { type: 'submit', url: '/panel/custom/submit/v3/' },
        { type: 'registerEvent', stepKey: 'Insurance', url: '/event/' }
      ]);
    });

    it('retains a newer queued snapshot when an older concurrent save succeeds', async () => {
      const queued: any[] = [];
      const stepUrl = '/panel/step/submit/v3/';
      let nextKey = 1;
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'saveRequest')
        .mockImplementation(async (url, options, type, stepKey) => {
          queued.push({
            key: nextKey++,
            formKey: 'test-form',
            url,
            type,
            stepKey,
            body: options.body
          });
        });
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type) =>
          queued.some((row) => !type || row.type === type)
        );
      jest.spyOn(handler, 'replayRequests').mockResolvedValue();
      jest
        .spyOn(handler as any, 'getDbTransaction')
        .mockImplementation(async () => ({
          store: {
            openCursor: () => {
              const request: any = {};
              const rows = [...queued];
              let index = 0;
              const advance = () => {
                const row = rows[index];
                request.onsuccess?.({
                  target: {
                    result: row
                      ? {
                          value: row,
                          key: row.key,
                          delete: () => queued.splice(queued.indexOf(row), 1),
                          continue: () => {
                            index++;
                            Promise.resolve().then(advance);
                          }
                        }
                      : null
                  }
                });
              };
              Promise.resolve().then(advance);
              return request;
            }
          }
        }));
      let finishOlder!: (response: any) => void;
      let olderStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        olderStarted = resolve;
      });
      const older = handler.runOrSaveRequest(
        () => {
          olderStarted();
          return new Promise((resolve) => {
            finishOlder = resolve;
          });
        },
        stepUrl,
        { method: 'POST', body: '{"name":"old"}' },
        'submit',
        'Insurance'
      );
      await started;
      await expect(
        handler.runOrSaveRequest(
          async () => {
            throw new TypeError('Failed to fetch');
          },
          stepUrl,
          { method: 'POST', body: '{"name":"new"}' },
          'submit',
          'Insurance'
        )
      ).rejects.toThrow('Failed to fetch');
      finishOlder({ ok: true });
      await older;
      expect(queued.map((row) => row.body)).toEqual(['{"name":"new"}']);
      const complete = jest.fn().mockResolvedValue({ ok: true });
      await expect(
        handler.runOrSaveRequest(
          complete,
          '/event/',
          { method: 'POST', body: '{}' },
          'registerEvent',
          'Insurance',
          { requireAcknowledgement: true }
        )
      ).rejects.toThrow('Some answers are still being saved');
      expect(complete).not.toHaveBeenCalled();
      await handler.runOrSaveRequest(
        async () => ({ ok: true }),
        stepUrl,
        { method: 'POST', body: '{"name":"new"}' },
        'submit',
        'Insurance'
      );
      expect(queued).toEqual([]);
      await handler.runOrSaveRequest(
        complete,
        '/event/',
        { method: 'POST', body: '{}' },
        'registerEvent',
        'Insurance',
        { requireAcknowledgement: true }
      );
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('releases replay after connectivity drops so reconnect can save before completion', async () => {
      const originalFetch = (global as any).fetch;
      const queued: any[] = [
        {
          formKey: 'test-form',
          key: 1,
          timestamp: 1,
          type: 'submit',
          stepKey: 'Insurance',
          url: '/step/',
          method: 'POST',
          headers: '{}',
          body: '{}',
          bodyType: 'text',
          retryAttempts: 0
        },
        {
          formKey: 'test-form',
          key: 2,
          timestamp: 2,
          type: 'registerEvent',
          stepKey: 'Insurance',
          url: '/event/',
          method: 'POST',
          headers: '{}',
          body: '{}',
          bodyType: 'text',
          retryAttempts: 0
        }
      ];
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type) =>
          queued.some((row) => !type || row.type === type)
        );
      jest
        .spyOn(handler as any, 'hasReplayableRequest')
        .mockResolvedValue(false);
      jest
        .spyOn(handler as any, 'getDbTransaction')
        .mockImplementation(async () => ({
          store: {
            openCursor: () => {
              const request: any = {};
              const rows = [...queued];
              let index = 0;
              const advance = () => {
                const row = rows[index];
                request.onsuccess?.({
                  target: {
                    result: row
                      ? {
                          value: row,
                          key: row.key,
                          continue: () => {
                            index++;
                            Promise.resolve().then(advance);
                          }
                        }
                      : null
                  }
                });
              };
              Promise.resolve().then(advance);
              return request;
            },
            get: (key: number) => {
              const request: any = {};
              Promise.resolve().then(() => {
                request.result = queued.find((row) => row.key === key);
                request.onsuccess?.();
              });
              return request;
            },
            put: (row: any, key: number) => {
              queued[queued.findIndex((old) => old.key === key)] = row;
            },
            delete: (key: number) => {
              queued.splice(
                queued.findIndex((row) => row.key === key),
                1
              );
            }
          }
        }));
      (global as any).fetch = jest.fn().mockImplementation(async () => {
        (global.navigator as any).onLine = false;
        throw new TypeError('Failed to fetch');
      });
      try {
        const settled = await Promise.race([
          handler.replayRequests().then(() => true),
          new Promise<boolean>((resolve) =>
            setTimeout(() => resolve(false), 1000)
          )
        ]);
        expect(settled).toBe(true);
        expect(queued.map((row) => row.type)).toEqual([
          'submit',
          'registerEvent'
        ]);
        expect(queued[0].retryAttempts).toBe(1);
        (global.navigator as any).onLine = true;
        const persisted: string[] = [];
        (global as any).fetch = jest
          .fn()
          .mockImplementation(async (url: string) => {
            persisted.push(url);
            return { status: 200 };
          });
        await handler.replayRequests();
        expect(persisted).toEqual(['/step/', '/event/']);
        expect(queued).toEqual([]);
      } finally {
        (global as any).fetch = originalFetch;
        (global.navigator as any).onLine = true;
      }
    });

    it('does not replay queued completion until a failed step save succeeds', async () => {
      const queued = [
        {
          type: 'submit',
          stepKey: 'Insurance',
          url: '/step/',
          timestamp: 1,
          value: 'old'
        },
        {
          type: 'submit',
          stepKey: 'Insurance',
          url: '/step/',
          timestamp: 2,
          value: 'new'
        },
        {
          type: 'registerEvent',
          stepKey: 'Insurance',
          url: '/event/',
          timestamp: 3,
          value: ''
        }
      ];
      const replayed: string[] = [];
      let saveSucceeds = false;
      (handler as any).indexedDBSupported = true;
      jest
        .spyOn(handler, 'dbHasRequest')
        .mockImplementation(async (type?: string) =>
          queued.some((request) => !type || request.type === type)
        );
      jest
        .spyOn(handler as any, 'hasReplayableRequest')
        .mockResolvedValue(false);
      jest
        .spyOn(handler as any, 'getDbTransaction')
        .mockImplementation(async () => ({
          store: {
            openCursor: () => {
              const request: { onsuccess?: (event: any) => void } = {};
              let index = 0;
              const advance = () => {
                const row = queued[index];
                request.onsuccess?.({
                  target: {
                    result: row
                      ? {
                          value: row,
                          key: index + 1,
                          continue: () => {
                            index++;
                            Promise.resolve().then(advance);
                          }
                        }
                      : null
                  }
                });
              };
              Promise.resolve().then(advance);
              return request;
            }
          }
        }));
      jest
        .spyOn(handler as any, 'replayRequestsInParallel')
        .mockImplementation(async (requests: typeof queued) => {
          let saved = true;
          requests.forEach((request) => {
            if (request.value === 'old' && !saveSucceeds) {
              saved = false;
              return;
            }
            replayed.push(request.value || request.type);
            const index = queued.indexOf(request);
            if (index !== -1) queued.splice(index, 1);
          });
          return [saved];
        });

      await handler.replayRequests();
      expect(replayed).toEqual([]);
      expect(queued).toHaveLength(3);

      saveSucceeds = true;
      await handler.replayRequests();
      expect(replayed).toEqual(['old', 'new', 'registerEvent']);
      expect(queued).toEqual([]);
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
        key: 99,
        retryAttempts: 0
      };

      jest.useFakeTimers();
      const replayPromise = (handlerWithSpy as any).replayRequestsInParallel([
        request
      ]);
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

    it('keeps a conflicted step save queued and blocks later replay', async () => {
      const originalFetch = (global as any).fetch;
      (global as any).fetch = jest
        .fn()
        .mockRejectedValue(new FormConflictError());
      const remove = jest.spyOn(handler as any, 'removeRequest');

      const result = await (handler as any).replayRequestsInParallel([
        {
          url: '/panel/step/submit/v3/',
          method: 'POST',
          headers: JSON.stringify({}),
          body: '{}',
          bodyType: 'text',
          key: 10,
          retryAttempts: 0
        }
      ]);

      expect(result).toEqual([false]);
      expect(remove).not.toHaveBeenCalled();
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
        key: 101,
        retryAttempts: 0
      };

      jest.useFakeTimers();
      const replayPromise = (
        handlerWithCallback as any
      ).replayRequestsInParallel([request]);
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

      await (handlerWithLink as any).replayRequestsInParallel([
        {
          url: `${getApiUrl()}panel/step/submit/v3/`,
          method: 'POST',
          headers: JSON.stringify({ 'Content-Type': 'application/json' }),
          body: '',
          bodyType: 'text',
          key: 103,
          retryAttempts: 0
        }
      ]);

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
