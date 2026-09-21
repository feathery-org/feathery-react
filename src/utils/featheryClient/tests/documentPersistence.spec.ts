import FeatheryClient from '../index';
import { initInfo, initState } from '../../init';

jest.mock('../../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {}, remountCallbacks: {} },
  fieldValues: {},
  filePathMap: {}
}));

describe('document persistence requests', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    (initInfo as jest.Mock).mockReturnValue({
      sdkKey: 'test-sdk',
      userId: 'test-user'
    });
    initState.authenticationError = undefined;
    globalThis.fetch = jest.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('preserves form authentication and surfaces a non-retryable auth failure', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({ message: 'Session expired' })
    });
    const client = new FeatheryClient('form-key');
    await expect(
      client.saveEnvelopeFile('envelope', new Blob(['docx']), 'document.docx', {
        sessionId: 'session'
      })
    ).rejects.toMatchObject({ kind: 'auth', status: 403 });
    expect(initState.authenticationError).toBe('Session expired');
    expect(
      (globalThis.fetch as jest.Mock).mock.calls[0][1].body.get('form_key')
    ).toBe('form-key');
  });

  it('sends form context on version-history reads', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers(),
      json: async () => ({ message: 'Denied' })
    });
    const client = new FeatheryClient('form-key');

    await expect(client.listEnvelopeVersions('envelope')).rejects.toMatchObject({
      status: 403
    });
    expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toContain(
      'form_key=form-key'
    );

    initState.authenticationError = undefined;
    await expect(
      client.getEnvelopeVersion('envelope', 'version')
    ).rejects.toMatchObject({ status: 403 });
    expect((globalThis.fetch as jest.Mock).mock.calls[1][0]).toContain(
      'form_key=form-key'
    );
  });

  it('times out and aborts a request that never settles', async () => {
    jest.useFakeTimers();
    (globalThis.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => undefined)
    );
    const pending = new FeatheryClient('form-key').listEnvelopeVersions(
      'envelope'
    );
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    jest.advanceTimersByTime(45_000);
    await rejected;
    expect(
      (globalThis.fetch as jest.Mock).mock.calls[0][1].signal.aborted
    ).toBe(true);
  });

  it('retains a session conflict instead of treating it as a network error', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ session_id: 'Session is no longer current' })
    });
    await expect(
      new FeatheryClient('form-key').saveEnvelopeFile('env', new Blob(['docx']))
    ).rejects.toMatchObject({ kind: 'conflict', status: 400 });
  });

  it('classifies a non-JSON 403 as authentication failure too', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 403, json: async () => { throw new Error('HTML error page'); } });
    await expect(new FeatheryClient('form-key').listEnvelopeVersions('env')).rejects.toMatchObject({ kind: 'auth', status: 403 });
    expect(initState.authenticationError).toBeTruthy();
  });

  it('bounds reading a stalled response body, not just the initial fetch', async () => {
    jest.useFakeTimers();
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => undefined) });
    const pending = new FeatheryClient('form-key').listEnvelopeVersions('env');
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await Promise.resolve();
    jest.advanceTimersByTime(45_000);
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves Retry-After on transient rate limiting', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '60' }), json: async () => ({ detail: 'Slow down' }) });
    await expect(new FeatheryClient('form-key').listEnvelopeVersions('env')).rejects.toMatchObject({ kind: 'network', status: 429, retryAfterMs: 60_000 });
  });

  it('rejects malformed version lists before returning them to the history panel', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ id: 'bad', seq: 'not-a-number' }]
    });
    await expect(
      new FeatheryClient('form-key').listEnvelopeVersions('env')
    ).rejects.toMatchObject({ kind: 'invalid' });
  });
});
