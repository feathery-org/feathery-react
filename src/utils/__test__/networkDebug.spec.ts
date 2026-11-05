import {
  _resetNetworkDebug,
  classifyRequest,
  enableNetworkDebug,
  NetworkDebugEntry,
  setNetworkDebugStep,
  subscribeNetworkDebug,
  summarizeBody,
  trackRequest
} from '../networkDebug';

const API = 'http://localhost:8006/api/';
const response = (status: number) =>
  ({ status, ok: status < 400 } as unknown as Response);

const latestEntries = () => {
  let latest: NetworkDebugEntry[] = [];
  subscribeNetworkDebug((entries) => {
    latest = entries;
  })();
  return latest;
};

describe('networkDebug', () => {
  beforeEach(() => _resetNetworkDebug());

  it('labels each SDK endpoint', () => {
    const cases: [string, string][] = [
      ['panel/step/submit/file/abc/', 'file_submit'],
      ['panel/step/submit/v3/', 'step_submit'],
      ['panel/custom/submit/v3/', 'custom_submit'],
      ['event/', 'event'],
      ['panel/session/v2/?form_key=x', 'session'],
      ['panel/v20/?form_key=x', 'form'],
      ['panel/logic/', 'other']
    ];
    cases.forEach(([path, kind]) =>
      expect(classifyRequest(API + path)).toBe(kind)
    );
  });

  it('makes form data readable without reading file contents', () => {
    const body = new FormData();
    body.set('custom_key_values', JSON.stringify({ name: 'Ada' }));
    body.append('files', new File(['abc'], 'cv.pdf'));
    body.append('files', new File(['de'], 'id.png'));

    expect(summarizeBody(body)).toEqual({
      custom_key_values: { name: 'Ada' },
      files: ['[file cv.pdf, 3 bytes]', '[file id.png, 2 bytes]']
    });
  });

  it('records nothing while switched off', async () => {
    const result = await trackRequest(API + 'event/', { method: 'POST' }, () =>
      Promise.resolve('done')
    );

    expect(result).toBe('done');
    expect(latestEntries()).toEqual([]);
  });

  it('records a request from pending to success with its step', async () => {
    enableNetworkDebug();
    setNetworkDebugStep('contact');
    let finish: (value: Response) => void = () => {};
    const pending = trackRequest(
      API + 'panel/custom/submit/v3/',
      { method: 'POST', body: JSON.stringify({ a: 1 }) },
      () => new Promise<Response>((resolve) => (finish = resolve))
    );

    expect(latestEntries()).toMatchObject([
      {
        kind: 'custom_submit',
        status: 'pending',
        stepKey: 'contact',
        body: { a: 1 }
      }
    ]);

    finish(response(201));
    await pending;

    expect(latestEntries()).toMatchObject([
      { status: 'success', httpStatus: 201 }
    ]);
  });

  it('records a failure and still rethrows it', async () => {
    enableNetworkDebug();
    const failure = new TypeError('Failed to fetch');

    await expect(
      trackRequest(API + 'panel/step/submit/v3/', { method: 'POST' }, () =>
        Promise.reject(failure)
      )
    ).rejects.toBe(failure);

    expect(latestEntries()).toMatchObject([
      {
        kind: 'step_submit',
        status: 'error',
        error: 'TypeError: Failed to fetch'
      }
    ]);
  });

  it('marks an error status code as failed', async () => {
    enableNetworkDebug();

    await trackRequest(
      API + 'event/',
      { method: 'POST' },
      () => Promise.resolve(response(409)),
      { retry: true }
    );

    expect(latestEntries()).toMatchObject([
      { status: 'error', httpStatus: 409, retry: true }
    ]);
  });
});
