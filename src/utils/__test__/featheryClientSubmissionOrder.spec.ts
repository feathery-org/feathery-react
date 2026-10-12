import FeatheryClient, { API_URL } from '../featheryClient';

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
  afterEach(() => jest.restoreAllMocks());

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

  it('queues completion behind a save that fails after the event starts, then allows retry', async () => {
    const client: any = new FeatheryClient('form');
    const handler = client.offlineRequestHandler;
    const queued: { type: string; stepKey?: string }[] = [];
    (handler as any).indexedDBSupported = true;
    jest
      .spyOn(handler, 'dbHasRequest')
      .mockImplementation(async (type?: string) =>
        queued.some((request) => !type || request.type === type)
      );
    jest
      .spyOn(handler, 'saveRequest')
      .mockImplementation(async (_url, _options, type, stepKey) => {
        queued.push({ type, stepKey });
      });
    jest.spyOn(handler, 'replayRequests').mockResolvedValue();
    jest.spyOn(client, 'flushCustomFields').mockResolvedValue(undefined);
    const sendEvent = jest.spyOn(client, '_fetch').mockResolvedValue({});
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
      '/panel/step/submit/v3/',
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
    expect(queued).toEqual([{ type: 'submit', stepKey: 'Insurance' }]);

    // A later successful replay frees the event barrier and leaves the UI
    // completion action retryable after its first rejected attempt.
    (handler.replayRequests as jest.Mock).mockImplementation(async () => {
      queued.splice(0, queued.length);
    });
    client.submitQueue = Promise.resolve();
    await expect(
      client._registerEventInternal({
        event: 'complete',
        step_key: 'Insurance',
        completed: true
      })
    ).resolves.toEqual({});
    expect(sendEvent).toHaveBeenCalledTimes(1);
  });

  it.each(['with JSON fields', 'without JSON fields'])(
    'retries an exhausted earlier answer on a new step submission %s before completing once',
    async (variant) => {
      const client: any = new FeatheryClient('form');
      const handler = client.offlineRequestHandler;
      const url = `${API_URL}panel/step/submit/v3/`;
      const queued: any[] = [
        {
          key: 1,
          formKey: 'form',
          type: 'submit',
          stepKey: 'first',
          timestamp: 1,
          url,
          method: 'POST',
          headers: '{}',
          body: '{"servars":[{"key":"profile","text_field":"retained"}]}',
          bodyType: 'text',
          retryAttempts: 4
        }
      ];
      const persisted: string[] = [];
      (handler as any).indexedDBSupported = true;
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
                          update: (updated: any) => {
                            queued[
                              queued.findIndex((old) => old.key === row.key)
                            ] = updated;
                          },
                          delete: () => {
                            queued.splice(
                              queued.findIndex((old) => old.key === row.key),
                              1
                            );
                          },
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
            delete: (key: number) => {
              queued.splice(
                queued.findIndex((row) => row.key === key),
                1
              );
            }
          }
        }));
      const originalFetch = (global as any).fetch;
      (global as any).fetch = jest
        .fn()
        .mockImplementation(async (_url: string, options: any) => {
          const body = JSON.parse(options.body);
          persisted.push(body.servars[0].text_field);
          return { status: 200 };
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
      try {
        const save = client._submitJSONData(
          variant === 'with JSON fields'
            ? [{ key: 'confirmation', text_field: 'confirmed' }]
            : [],
          'second',
          true
        );
        client.submitQueue = save;
        await save;
        await client._registerEventInternal({
          event: 'complete',
          step_key: 'second',
          completed: true
        });
        expect(persisted).toEqual(
          variant === 'with JSON fields'
            ? ['retained', 'confirmed', 'complete']
            : ['retained', 'complete']
        );
        expect(queued).toEqual([]);
        expect(
          send.mock.calls.filter(
            ([, options]: any) => JSON.parse(options.body).completed
          )
        ).toHaveLength(1);
      } finally {
        (global as any).fetch = originalFetch;
      }
    }
  );

  it('waits for custom field persistence before checking the event queue', async () => {
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
      step_key: 'Insurance'
    });
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();

    resolveCustom();
    await event;
    expect(request).toHaveBeenCalledTimes(1);
  });
});
