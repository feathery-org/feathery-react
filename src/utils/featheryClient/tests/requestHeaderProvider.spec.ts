// client-utils builds the requests behind its own API helpers, so the SDK's
// credentials only reach them through the header provider featheryClient
// registers at module load. Importing the client is what arms that here, the
// same way loading the SDK does on a real page, and `apiFetch` stays real so
// the headers asserted below are the ones that would go over the wire.
import '../index';
import {
  apiFetch,
  getApiUrl,
  getCdnUrl,
  inviteFormCollaborator,
  setEnvironment
} from '@feathery/client-utils';
import { initState } from '../../init';

// '../../init' is mocked for the reason integrationClient.spec.ts gives: it
// instantiates FeatheryClient at module load.
jest.mock('../../init', () => ({
  initInfo: jest.fn(() => ({ sdkKey: 'sdkKey' })),
  initFormsPromise: Promise.resolve(),
  initState: { linkToken: '', linkSecret: '', collaboratorId: '' },
  fieldValues: {},
  filePathMap: {},
  registerKnownFieldKeys: jest.fn(),
  registerTextVariableFormats: jest.fn(),
  setFieldValues: jest.fn(),
  markStepCompleted: jest.fn(),
  fileDeduplicationCount: {},
  fileRetryStatus: {}
}));

const invite = () =>
  inviteFormCollaborator(
    'sdkKey',
    'form-key',
    'template',
    [{ email: 'next@example.com' }] as any,
    'fuser',
    ''
  );

const requestHeaders = () =>
  (global.fetch as jest.Mock).mock.calls[0][1].headers;

beforeEach(() => {
  // US production, so the CDN case below is a different origin than the API one
  setEnvironment('production');
  initState.linkToken = '';
  initState.linkSecret = '';
  initState.collaboratorId = '';
  global.fetch = jest.fn().mockResolvedValue({
    status: 201,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve('')
  });
});

describe('the header provider client-utils requests go through', () => {
  it('carries the access link on a client-utils API helper', async () => {
    initState.linkToken = 'tok';
    initState.linkSecret = 'secret';

    await invite();

    expect(requestHeaders()['X-Feathery-Link']).toBe('tok.secret');
    // The helper's own headers and the SDK key survive alongside it
    expect(requestHeaders()).toMatchObject({
      Authorization: 'Token sdkKey',
      'Content-Type': 'application/json'
    });
  });

  it('carries the collaborator a later invite is acting as', async () => {
    initState.collaboratorId = 'collab';

    await invite();

    expect(requestHeaders()['X-Feathery-Collaborator']).toBe('collab');
    expect(requestHeaders()['X-Feathery-Link']).toBeUndefined();
  });

  it('carries neither for a form opened without a link', async () => {
    await invite();

    expect(requestHeaders()['X-Feathery-Link']).toBeUndefined();
    expect(requestHeaders()['X-Feathery-Collaborator']).toBeUndefined();
  });

  it('is asked per url, so a request off the backend carries nothing', async () => {
    // The provider decides by origin, and the CDN is not one the backend gates
    expect(new URL(getCdnUrl()).origin).not.toBe(new URL(getApiUrl()).origin);
    initState.linkToken = 'tok';

    await apiFetch(
      'sdkKey',
      `${getCdnUrl()}panel/v2/?form_key=form-key`,
      {},
      false
    );

    expect(requestHeaders()['X-Feathery-Link']).toBeUndefined();
  });
});
