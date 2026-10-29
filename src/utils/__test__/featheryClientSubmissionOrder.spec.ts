import FeatheryClient, { API_URL } from '../featheryClient';
import { featheryWindow } from '../browser';
import { FetchError } from '@feathery/client-utils';
import { FEATHERY_INTERACTION_EVENT } from '../interactionState';
import {
  FakeRequest,
  fakeResponse,
  installFakeIndexedDB,
  waitUntil
} from './test-utils';

// Interaction is global module state. Each test starts as a user who has
// interacted, and a test that needs the first interaction resets it.
const mockInteraction = { isDetected: true };
jest.mock('../interactionState', () => ({
  ...jest.requireActual('../interactionState'),
  isInteractionDetected: () => mockInteraction.isDetected,
  setInteractionDetected: () => {
    mockInteraction.isDetected = true;
  }
}));

jest.mock('@feathery/client-utils', () => ({
  ...jest.requireActual('@feathery/client-utils'),
  setRequestHeaderProvider: jest.fn()
}));

jest.mock('../init', () => ({
  initInfo: () => ({ sdkKey: 'key', userId: 'user' }),
  initFormsPromise: Promise.resolve(),
  initState: { defaultErrors: {}, language: '', formSessions: {} },
  fieldValues: {},
  filePathMap: {},
  fileDeduplicationCount: {},
  fileRetryStatus: {},
  restoredFileKeys: new Set(),
  setFieldValues: () => {},
  normalizeKnownAsciiValues: (values: Record<string, any>) => values,
  markStepCompleted: () => {},
  registerKnownFieldKeys: () => {},
  registerTextVariableFields: () => {}
}));

describe('step save and completion ordering', () => {
  let originalFetch: any;
  let fakeIndexedDB: ReturnType<typeof installFakeIndexedDB> | undefined;

  beforeAll(() => {
    (global as any).Request = FakeRequest;
  });

  beforeEach(() => {
    originalFetch = (global as any).fetch;
    mockInteraction.isDetected = true;
    jest.spyOn(featheryWindow(), 'confirm').mockReturnValue(false);
    const { fileRetryStatus, fileDeduplicationCount } =
      jest.requireMock('../init');
    Object.keys(fileRetryStatus).forEach((key) => delete fileRetryStatus[key]);
    Object.keys(fileDeduplicationCount).forEach(
      (key) => delete fileDeduplicationCount[key]
    );
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    fakeIndexedDB?.uninstall();
    fakeIndexedDB = undefined;
    jest.restoreAllMocks();
  });

  // A client whose offline queue sits on a fresh in-memory IndexedDB. The
  // queue detects IndexedDB when it is constructed, so the store goes first.
  const createClientWithStorage = () => {
    fakeIndexedDB = installFakeIndexedDB('form');
    const client: any = new FeatheryClient('form');
    // Retries go out at once instead of waiting out the backoff
    jest
      .spyOn(client.offlineRequestHandler, 'delay')
      .mockResolvedValue(undefined);
    return { client, store: fakeIndexedDB };
  };
  const queuedAnswer = (row: Record<string, any>) => ({
    type: 'submit',
    userId: 'user',
    retryAttempts: 4,
    ...row
  });

  it('clears an optional empty file with a persisted rejection before mount replay', async () => {
    const { client, store } = createClientWithStorage();
    const url = `${API_URL}panel/step/submit/file/user/`;
    store.seed(
      queuedAnswer({
        url,
        stepKey: 'Documents',
        metadata: { fieldKey: 'card' },
        rejected: true
      })
    );
    jest.spyOn(client, '_getFileValue').mockResolvedValue(undefined);
    const send = jest.spyOn(client, '_fetch').mockResolvedValue({ ok: true });

    await client._submitFileData({ key: 'card' }, 'Documents');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe(url);
    expect((send.mock.calls[0][1] as any).body.get('card')).toBe('');
    expect(store.rows()).toEqual([]);
    expect(featheryWindow().confirm).not.toHaveBeenCalled();
  });

  it('sends the SDK build version separately from the form version on saves and events', async () => {
    const client: any = new FeatheryClient('form');
    client.version = 'published-form-version';
    jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
    jest
      .spyOn(client.offlineRequestHandler, 'runOrSaveRequest')
      .mockImplementation(async (request) => request());
    const send = jest.spyOn(client, '_fetch').mockResolvedValue({});

    await client._submitJSONData(
      [{ key: 'profile', text_field: 'synthetic answer' }],
      'first',
      true
    );
    await client._registerEventInternal({
      event: 'complete',
      step_key: 'first'
    });

    expect(send).toHaveBeenCalledTimes(2);
    for (const [, options] of send.mock.calls as any[]) {
      expect(JSON.parse(options.body)).toMatchObject({
        __feathery_sdk_version: '0.0.0-test',
        __feathery_version: 'published-form-version'
      });
    }
  });

  it('sends the step answers when resetting stored retry budgets fails', async () => {
    const { client } = createClientWithStorage();
    jest
      .spyOn(client.offlineRequestHandler, 'resetAnswerWriteRetries')
      .mockRejectedValue(new Error('IndexedDB connection lost'));
    const send = jest.spyOn(client, '_fetch').mockResolvedValue({});

    await expect(
      client.submitStep(
        [{ key: 'profile', text_field: 'synthetic answer' }],
        { key: 'Insurance', buttons: [], subgrids: [] },
        true
      )
    ).resolves.toBeDefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][1].body)).toMatchObject({
      step_key: 'Insurance',
      servars: [{ key: 'profile', text_field: 'synthetic answer' }]
    });
  });

  it('queues completion behind a save that fails after the event starts, then allows retry', async () => {
    const { client, store } = createClientWithStorage();
    const handler = client.offlineRequestHandler;
    jest.spyOn(featheryWindow(), 'alert').mockImplementation(() => {});
    jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
    const sendEvent = jest.spyOn(client, '_fetch').mockResolvedValue({});
    (global as any).fetch = jest.fn(async () => fakeResponse(503));
    let settleSave!: (error?: Error) => void;
    let signalSaveStarted!: () => void;
    const saveStarted = new Promise<void>((resolve) => {
      signalSaveStarted = resolve;
    });
    const save = handler.runOrSaveRequest(
      () =>
        new Promise((resolve, reject) => {
          signalSaveStarted();
          settleSave = (error) => {
            if (error) reject(error);
            else resolve(undefined);
          };
        }),
      `${API_URL}panel/step/submit/v3/`,
      { method: 'POST', body: '{}' },
      'submit',
      'Insurance'
    );
    save.catch(() => {});
    client.submitQueue = save;

    const completion = client._registerEventInternal({
      event: 'complete',
      step_key: 'Insurance',
      completed: true
    });
    await Promise.resolve();
    expect(sendEvent).not.toHaveBeenCalled();

    // The failed save is recorded before the event checks the offline queue.
    await saveStarted;
    settleSave(new TypeError('Failed to fetch'));
    await expect(save).rejects.toThrow('Failed to fetch');
    await expect(completion).rejects.toThrow(
      'Some answers are still being saved'
    );
    expect(sendEvent).not.toHaveBeenCalled();
    expect(store.rows().map((row) => [row.type, row.stepKey])).toEqual([
      ['submit', 'Insurance']
    ]);

    // Submitting again retries the save and leaves the UI completion action
    // retryable after its first rejected attempt.
    (global as any).fetch = jest.fn(async () => fakeResponse(200));
    await client.submitStep(
      [],
      { key: 'Insurance', buttons: [], subgrids: [] },
      false
    );
    await expect(
      client._registerEventInternal({
        event: 'complete',
        step_key: 'Insurance',
        completed: true
      })
    ).resolves.toEqual({});
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(store.rows()).toEqual([]);
  });

  it('holds a step event registered while its submission is starting behind the failed save', async () => {
    const { client, store } = createClientWithStorage();
    jest.spyOn(featheryWindow(), 'alert').mockImplementation(() => {});
    jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
    // Neither the save nor its replay can reach the server
    (global as any).fetch = jest.fn(async () => fakeResponse(503));
    const sent: string[] = [];
    jest
      .spyOn(client, '_fetch')
      .mockImplementation(async (_url: any, options: any) => {
        if (JSON.parse(options.body).servars) {
          sent.push('save');
          throw new TypeError('Failed to fetch');
        }
        sent.push('submit event');
        return {};
      });

    const submission = client.submitStep(
      [{ key: 'name', text_field: 'synthetic answer' }],
      { key: 'Insurance', buttons: [], subgrids: [] },
      true
    );
    submission.catch(() => {});
    // Navigation registers the step's submit event without awaiting the save
    await client.registerEvent({
      event: 'complete',
      step_key: 'Insurance',
      next_step_key: 'Contact'
    });

    expect(sent).toEqual(['save']);
    expect(store.rows().map((row) => [row.type, row.stepKey])).toEqual([
      ['submit', 'Insurance'],
      ['registerEvent', 'Insurance']
    ]);
  });

  it.each(['with JSON fields', 'without JSON fields'])(
    'retries exhausted earlier answers on a new step submission %s before completing once',
    async (variant) => {
      const { client, store } = createClientWithStorage();
      store.seed(
        queuedAnswer({
          stepKey: 'first',
          url: `${API_URL}panel/step/submit/v3/`,
          body: 'retained step answer'
        })
      );
      store.seed(
        queuedAnswer({
          url: `${API_URL}panel/custom/submit/v3/`,
          body: 'retained custom answer'
        })
      );
      store.seed(
        queuedAnswer({
          stepKey: 'first',
          url: `${API_URL}panel/step/submit/file/user/`,
          metadata: { fieldKey: 'card' },
          body: 'retained card'
        })
      );
      const persisted: string[] = [];
      (global as any).fetch = jest.fn(async (_url: string, options: any) => {
        persisted.push(options.body);
        return fakeResponse(200);
      });
      jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
      const send = jest
        .spyOn(client, '_fetch')
        .mockImplementation(async (_url: any, options: any) => {
          const body = JSON.parse(options.body);
          persisted.push(
            body.completed ? 'complete' : body.servars[0].text_field
          );
          return { ok: true };
        });

      await client.submitStep(
        variant === 'with JSON fields'
          ? [{ key: 'confirmation', text_field: 'confirmed' }]
          : [],
        { key: 'second', buttons: [], subgrids: [] },
        true
      );
      await client._registerEventInternal({
        event: 'complete',
        step_key: 'second',
        completed: true
      });

      expect(persisted).toEqual([
        'retained step answer',
        'retained custom answer',
        'retained card',
        ...(variant === 'with JSON fields' ? ['confirmed'] : []),
        'complete'
      ]);
      expect(store.rows()).toEqual([]);
      expect(
        send.mock.calls.filter(
          ([, options]: any) => JSON.parse(options.body).completed
        )
      ).toHaveLength(1);
    }
  );

  it('alerts the user once when the server rejects queued answers', async () => {
    const { client, store } = createClientWithStorage();
    const url = `${API_URL}panel/step/submit/v3/`;
    store.seed(queuedAnswer({ stepKey: 'first', url, retryAttempts: 0 }));
    store.seed(queuedAnswer({ stepKey: 'second', url, retryAttempts: 0 }));
    (global as any).fetch = jest.fn(async () => fakeResponse(400));
    const alert = jest
      .spyOn(featheryWindow(), 'alert')
      .mockImplementation(() => {});

    await client.offlineRequestHandler.replayRequests();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith(
      expect.stringContaining('submit that step again')
    );
    // Rejected answers remain durable so a reload cannot unblock completion.
    expect(store.rows().map((row) => row.stepKey)).toEqual(['first', 'second']);

    // A later replay that rejects another step's answers alerts again
    store.seed(queuedAnswer({ stepKey: 'third', url, retryAttempts: 0 }));
    await client.offlineRequestHandler.replayRequests();
    expect(alert).toHaveBeenCalledTimes(2);
  });

  // Expectation moved: only completion waits on the flush; other events go out alongside it
  it('waits for custom field persistence before checking the queue for completion', async () => {
    const client: any = new FeatheryClient('form');
    let resolveCustom!: () => void;
    jest.spyOn(client, 'flushCustomFields').mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCustom = resolve;
      })
    );
    const request = jest
      .spyOn(client.offlineRequestHandler, 'runOrSaveRequest')
      .mockResolvedValue({});

    const event = client._registerEventInternal({
      event: 'complete',
      step_key: 'Insurance',
      completed: true
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).not.toHaveBeenCalled();

    resolveCustom();
    await event;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['sends a step event', {}, ['submit event']],
    ['withholds completion', { completed: true }, []]
  ])(
    '%s when the custom field flush is rejected',
    async (_behaviour, completion, expectedSent) => {
      const { client } = createClientWithStorage();
      jest
        .spyOn(client, 'flushCustomFields')
        .mockRejectedValue(new FetchError('"Invalid value"'));
      const sent: string[] = [];
      jest.spyOn(client, '_fetch').mockImplementation(async () => {
        sent.push('submit event');
        return {};
      });

      await expect(
        client.registerEvent({
          event: 'complete',
          step_key: 'Insurance',
          next_step_key: 'Contact',
          ...completion
        })
      ).rejects.toThrow('Invalid value');

      expect(sent).toEqual(expectedSent);
    }
  );

  it('replays an event held for the first interaction behind earlier submissions, not the one releasing it', async () => {
    mockInteraction.isDetected = false;
    const { client, store } = createClientWithStorage();
    jest.spyOn(featheryWindow(), 'alert').mockImplementation(() => {});
    jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
    // Neither the save nor its replay can reach the server
    (global as any).fetch = jest.fn(async () => fakeResponse(503));
    const sent: string[] = [];
    jest
      .spyOn(client, '_fetch')
      .mockImplementation(async (_url: any, options: any) => {
        const body = JSON.parse(options.body);
        if (body.servars) {
          sent.push('save');
          throw new TypeError('Failed to fetch');
        }
        sent.push(`${body.event} event`);
        return {};
      });
    // The load event waits for the user's first interaction
    const loadEvent = client.registerEvent({
      event: 'load',
      step_key: 'Insurance'
    });

    // The first interaction is a click that submits the step
    mockInteraction.isDetected = true;
    const submission = client.submitStep(
      [{ key: 'name', text_field: 'synthetic answer' }],
      { key: 'Insurance', buttons: [], subgrids: [] },
      true
    );
    const stepEvent = client.registerEvent({
      event: 'complete',
      step_key: 'Insurance',
      next_step_key: 'Contact'
    });
    const isSettled = await Promise.race([
      Promise.allSettled([loadEvent, submission, stepEvent]).then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000))
    ]);

    expect(isSettled).toBe(true);
    expect(sent).toEqual(['load event', 'save']);
    expect(store.rows().map((row) => [row.type, row.stepKey])).toEqual([
      ['submit', 'Insurance'],
      ['registerEvent', 'Insurance']
    ]);
  });

  it('holds a step event registered while the first interaction is still replaying behind the failed save', async () => {
    mockInteraction.isDetected = false;
    const { client, store } = createClientWithStorage();
    jest.spyOn(featheryWindow(), 'alert').mockImplementation(() => {});
    jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
    // Neither the save nor its replay can reach the server
    (global as any).fetch = jest.fn(async () => fakeResponse(503));
    const sent: string[] = [];
    let landLoadEvent!: () => void;
    jest
      .spyOn(client, '_fetch')
      .mockImplementation(async (_url: any, options: any) => {
        const body = JSON.parse(options.body);
        if (body.servars) {
          sent.push('save');
          throw new TypeError('Failed to fetch');
        }
        sent.push(`${body.event} event`);
        // The load POST is slow
        if (body.event === 'load')
          await new Promise<void>((resolve) => {
            landLoadEvent = resolve;
          });
        return {};
      });
    const loadEvent = client.registerEvent({
      event: 'load',
      step_key: 'Insurance'
    });

    // The first interaction replays the held load event, then submits the step
    mockInteraction.isDetected = true;
    featheryWindow().dispatchEvent(new CustomEvent(FEATHERY_INTERACTION_EVENT));
    await waitUntil(() => !!landLoadEvent);
    const submission = client.submitStep(
      [{ key: 'name', text_field: 'synthetic answer' }],
      { key: 'Insurance', buttons: [], subgrids: [] },
      true
    );
    submission.catch(() => {});
    const stepEvent = client.registerEvent({
      event: 'complete',
      step_key: 'Insurance',
      next_step_key: 'Contact'
    });
    landLoadEvent();
    await Promise.all([loadEvent, stepEvent]);

    expect(sent).toEqual(['load event', 'save']);
    expect(store.rows().map((row) => [row.type, row.stepKey])).toEqual([
      ['submit', 'Insurance'],
      ['registerEvent', 'Insurance']
    ]);
  });

  it('reports a rejected step event only through its promise while the flush is pending', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const client: any = new FeatheryClient('form');
      let finishFlush!: () => void;
      jest.spyOn(client, 'flushCustomFields').mockReturnValue(
        new Promise<void>((resolve) => {
          finishFlush = resolve;
        })
      );
      // The previous step's save failed on the server
      client.submitQueue = Promise.reject(
        new FetchError('Internal server error')
      );
      client.submitQueue.catch(() => {});

      const event = client.registerEvent({
        event: 'complete',
        step_key: 'Insurance',
        next_step_key: 'Contact'
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      finishFlush();

      await expect(event).rejects.toThrow('Internal server error');
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('keeps a newer upload that failed while an older one of the field was still in flight', async () => {
    const { client, store } = createClientWithStorage();
    let landOlderUpload!: () => void;
    const uploads: string[] = [];
    jest
      .spyOn(client, '_fetch')
      .mockImplementation(async (_url: any, options: any) => {
        const file = options.body.get('card') as File;
        uploads.push(file.name);
        if (file.name === 'newer.png') throw new TypeError('Failed to fetch');
        return new Promise((resolve) => {
          landOlderUpload = () => resolve({});
        });
      });
    const upload = (name: string) =>
      client.submitFiles([
        {
          servar: { key: 'card', file_upload: new File([name], name) },
          stepKey: 'Insurance'
        }
      ]);

    const olderUpload = upload('older.png');
    await waitUntil(() => uploads.length === 1);
    const newerUpload = upload('newer.png');
    newerUpload.catch(() => {});
    await waitUntil(() => store.rows().length === 1);
    landOlderUpload();
    await olderUpload;
    await expect(newerUpload).rejects.toThrow('Failed to fetch');

    expect(uploads).toEqual(['older.png', 'newer.png']);
    expect(store.rows()).toEqual([
      expect.objectContaining({ metadata: { fieldKey: 'card' } })
    ]);
  });

  it("keeps a field's newer upload status when an older upload of it fails afterwards", async () => {
    const { client } = createClientWithStorage();
    const { fileRetryStatus } = jest.requireMock('../init');
    let failOlderUpload!: () => void;
    const uploads: string[] = [];
    jest
      .spyOn(client, '_fetch')
      .mockImplementation(async (_url: any, options: any) => {
        const file = options.body.get('card') as File;
        uploads.push(file.name);
        if (file.name === 'newer.png') return {};
        return new Promise((resolve, reject) => {
          failOlderUpload = () => reject(new TypeError('Failed to fetch'));
        });
      });
    const upload = (name: string) =>
      client.submitFiles([
        {
          servar: { key: 'card', file_upload: new File([name], name) },
          stepKey: 'Insurance'
        }
      ]);

    const olderUpload = upload('older.png');
    await waitUntil(() => uploads.length === 1);
    // Its submission settles after the older one, which it waits behind
    const newerUpload = upload('newer.png');
    await waitUntil(() => fileRetryStatus.card === true);
    failOlderUpload();
    await Promise.all([olderUpload, newerUpload]);

    expect(uploads).toEqual(['older.png', 'newer.png']);
    expect(fileRetryStatus.card).toBe(true);
  });

  it('persists click-rule custom fields after the button step answers', async () => {
    const { client: formClient } = createClientWithStorage();
    const ruleClient: any = new FeatheryClient('form');
    let finishStepAnswers!: () => void;
    let signalStepAnswers!: () => void;
    const stepStarted = new Promise<void>((resolve) => {
      signalStepAnswers = resolve;
    });
    const sent: string[] = [];
    jest.spyOn(formClient, 'flushCustomFields').mockResolvedValue(undefined);
    jest.spyOn(ruleClient, '_fetch').mockImplementation(async (url: any) => {
      sent.push(url.includes('/custom/submit/') ? 'custom fields' : 'step');
      return {};
    });
    jest.spyOn(formClient, '_fetch').mockImplementation(async () => {
      sent.push('step');
      signalStepAnswers();
      return new Promise((resolve) => {
        finishStepAnswers = () => resolve({});
      });
    });

    const stepSubmission = formClient.submitStep(
      [{ key: 'name', text_field: 'before click action' }],
      { key: 'first', buttons: [], subgrids: [] },
      true
    );
    await stepStarted;

    ruleClient.pendingCustomFieldUpdates.name = 'after click action';
    const ruleSubmission = ruleClient._debouncedSubmitCustom(true);
    await Promise.resolve();
    expect(sent).toEqual(['step']);

    finishStepAnswers();
    await Promise.all([stepSubmission, ruleSubmission]);
    expect(sent).toEqual(['step', 'custom fields']);
  });
});
