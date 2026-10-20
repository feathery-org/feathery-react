import { getApiUrl, setEnvironment } from '@feathery/client-utils';
import { getThreadList } from './utils';
import { uploadAttachment } from './attachments';
import { initState } from '../utils/init';

// The assistant's endpoints resolve the submission like the rest of the SDK, so
// a link-bound form has to send the access link header on them too. These tests
// run the real wrapper and watch the request handed to `fetch`.
//
// '../utils/init' is mocked for the reason integrationClient.spec.ts gives: it
// instantiates FeatheryClient at module load. The link state lives on it rather
// than in a captured value because the wrapper reads it per request.
jest.mock('../utils/init', () => ({
  initInfo: jest.fn(() => ({ sdkKey: 'sdkKey', userId: 'userId' })),
  initFormsPromise: Promise.resolve(),
  initState: { linkToken: '', linkSecret: '' },
  fieldValues: {},
  filePathMap: {},
  registerKnownFieldKeys: jest.fn(),
  registerTextVariableFormats: jest.fn(),
  setFieldValues: jest.fn(),
  markStepCompleted: jest.fn(),
  fileDeduplicationCount: {},
  fileRetryStatus: {}
}));

// Mocking '../utils/init' keeps featheryClient, which is what normally
// configures the environment at module load, out of this file. Setting it here
// makes the backend hosts these cases match against explicit rather than
// whatever BACKEND_ENV happened to be when the suite ran.
setEnvironment('production');

// Where Form/index.tsx points the in-form assistant: the API host, off the
// `/api/` path the SDK's other endpoints sit on.
const ASSISTANT_BASE = `${new URL(getApiUrl()).origin}/agent/assistant/`;

const authHeaders = () => ({ Authorization: 'Token sdkKey' });

const openedWithLink = (token: string, deviceSecret = '') => {
  initState.linkToken = token;
  initState.linkSecret = deviceSecret;
};

const requestHeaders = () =>
  (global.fetch as jest.Mock).mock.calls[0][1].headers;

beforeEach(() => {
  openedWithLink('');
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve([])
  });
});

describe('the access link header on assistant requests', () => {
  it('sends the token and device secret once this device has redeemed', async () => {
    openedWithLink('tok', 'secret');

    await getThreadList(ASSISTANT_BASE, authHeaders, 'form-key');

    expect(requestHeaders()).toEqual({
      'X-Feathery-Link': 'tok.secret',
      Authorization: 'Token sdkKey'
    });
  });

  it('sends the bare token before this device has redeemed', async () => {
    openedWithLink('tok');

    await getThreadList(ASSISTANT_BASE, authHeaders, 'form-key');

    expect(requestHeaders()['X-Feathery-Link']).toBe('tok');
  });

  it('adds no header for a form opened without a link', async () => {
    await getThreadList(ASSISTANT_BASE, authHeaders, 'form-key');

    expect(requestHeaders()).toEqual({ Authorization: 'Token sdkKey' });
  });

  it('sends it on an attachment upload, keeping the headers the call made', async () => {
    openedWithLink('tok', 'secret');
    const file = new File(['contents'], 'proof.pdf', {
      type: 'application/pdf'
    });

    await uploadAttachment(
      file,
      ASSISTANT_BASE,
      authHeaders,
      'session',
      new AbortController().signal,
      'form-key'
    );

    expect(requestHeaders()).toEqual({
      'X-Feathery-Link': 'tok.secret',
      Authorization: 'Token sdkKey',
      'X-Session-ID': 'session'
    });
  });

  it('leaves an assistant hosted off the API origin alone', async () => {
    openedWithLink('tok', 'secret');

    await getThreadList(
      'https://assistant.example.com/agent/assistant/',
      authHeaders,
      'form-key'
    );

    expect(requestHeaders()).toEqual({ Authorization: 'Token sdkKey' });
  });
});
