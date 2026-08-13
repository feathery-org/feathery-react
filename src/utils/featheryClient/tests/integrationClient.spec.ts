// integrationClient.ts imports API_URL/STATIC_URL from '.' (index.ts) at its
// own top level, while index.ts's FeatheryClient class extends
// IntegrationClient - a direct two-file cycle only resolvable by entering
// through index.ts, so this test imports FeatheryClient (which inherits every
// method below) rather than IntegrationClient directly. Matches the mocking
// convention already used in src/utils/__test__/featheryClient.spec.ts for
// the same class, which also mocks '../init' since init.ts separately
// instantiates FeatheryClient eagerly at module load.
import FeatheryClient from '../index';
import { initInfo } from '../../init';

jest.mock('../../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: { formSessions: {} },
  fieldValues: {},
  filePathMap: {}
}));

describe('IntegrationClient account connect', () => {
  const okResponse = (payload: any) => ({
    status: 200,
    json: () => Promise.resolve(payload)
  });

  beforeEach(() => {
    (initInfo as jest.Mock).mockReturnValue({
      sdkKey: 'sdkKey',
      userId: 'userId'
    });
  });

  it('starts a connection with provider and parent origin', async () => {
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest
      .fn()
      .mockResolvedValue(okResponse({ state: 's', authorization_url: 'u' }));

    const result = await client.startAccountConnect(
      'box',
      'https://forms.test'
    );

    expect(result.state).toBe('s');
    const [url, , parseResponse] = client._fetch.mock.calls[0];
    expect(url).toContain('account-connect/start/');
    expect(url).toContain('provider=box');
    // parseResponse must be false so a non-2xx status reaches our own
    // response.status/parseAPIError handling instead of apiFetch's
    // checkResponseSuccess throwing/swallowing first.
    expect(parseResponse).toBe(false);
  });

  it('throws the parsed API error when start fails', async () => {
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest.fn().mockResolvedValue({
      status: 400,
      json: () => Promise.resolve({ detail: 'not configured' })
    });

    await expect(
      client.startAccountConnect('box', 'https://forms.test')
    ).rejects.toThrow();
  });

  it('reports pending when the status request returns nothing', async () => {
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest.fn().mockResolvedValue(undefined);

    await expect(client.getAccountConnectStatus('s')).resolves.toEqual({
      status: 'pending'
    });
    expect(client._fetch.mock.calls[0][2]).toBe(false);
  });

  it('posts a selection when saving config', async () => {
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest
      .fn()
      .mockResolvedValue(okResponse({ config: {}, values: {} }));

    await client.saveAccountConfig('box', { folder_id: '42' });

    const [url, options, parseResponse] = client._fetch.mock.calls[0];
    expect(url).toContain('account-connect/config/');
    expect(JSON.parse(options.body).selection).toEqual({ folder_id: '42' });
    // Shared by browseAccountResources and saveAccountConfig via
    // _accountConnectPost - must be false, see startAccountConnect test above.
    expect(parseResponse).toBe(false);
  });

  it('passes a create name through browse', async () => {
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest.fn().mockResolvedValue(okResponse({ folders: [] }));

    await client.browseAccountResources('box', '0', { create: 'New Folder' });

    const [url, options] = client._fetch.mock.calls[0];
    expect(url).toContain('account-connect/browse/');
    expect(JSON.parse(options.body).create).toBe('New Folder');
  });
});
