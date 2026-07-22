import { generateThreadTitle } from '../utils';

describe('generateThreadTitle request shape', () => {
  const headers = () => ({ Authorization: 'Token abc' });
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: 'A Title' })
    });
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as any).fetch;
  });

  it('nests targets/current_step under `context` (ai-services reads body.context.*)', async () => {
    await generateThreadTitle(
      'https://api.test/',
      headers,
      'thread-1',
      'hello there',
      { targets: [{ type: 'envelope', id: 'e1' }], current_step: 'step-2' }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/agent/threads/title/');
    const body = JSON.parse(init.body);

    expect(body.message).toBe('hello there');
    expect(body.context).toEqual({
      targets: [{ type: 'envelope', id: 'e1' }],
      current_step: 'step-2'
    });
    // Regression guard: context fields must not leak to the top level.
    expect(body.targets).toBeUndefined();
    expect(body.current_step).toBeUndefined();
  });

  it('always sends a context object even with no context provided', async () => {
    await generateThreadTitle('https://api.test/', headers, null, 'hi');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.context).toEqual({});
  });
});
