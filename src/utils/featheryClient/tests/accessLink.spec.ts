// Enters through index.ts for the same reason integrationClient.spec.ts does:
// the two files form an import cycle, and '../../init' is mocked because it
// instantiates FeatheryClient eagerly at module load.
import FeatheryClient, {
  API_URL,
  CDN_URL,
  updateRegionApiUrls
} from '../index';
import { initInfo, initState } from '../../init';
import { featheryDoc, featheryWindow } from '../../browser';
import { apiFetch, FormAuthenticationError } from '@feathery/client-utils';

// _fetch is what attaches the link header, so these tests run the real wrapper
// and watch the request it hands to apiFetch. Everything else in client-utils
// stays real - index.ts calls setEnvironment at module load, and the API and
// CDN hosts it derives from that are what the CDN exclusion turns on.
jest.mock('@feathery/client-utils', () => ({
  ...jest.requireActual('@feathery/client-utils'),
  apiFetch: jest.fn()
}));

jest.mock('../../init', () => ({
  initInfo: jest.fn(),
  initFormsPromise: Promise.resolve(),
  initState: {
    formSessions: {},
    fieldValuesInitialized: false,
    linkToken: '',
    linkSecret: '',
    // Read by the blocked-form handler a rejected link goes through
    remountCallbacks: {}
  },
  fieldValues: {},
  filePathMap: {},
  registerKnownFieldKeys: jest.fn(),
  registerTextVariableFormats: jest.fn(),
  setFieldValues: jest.fn(),
  markStepCompleted: jest.fn(),
  fileDeduplicationCount: {},
  fileRetryStatus: {}
}));

// Where this device keeps the token of the form under test once the server has
// accepted it, and where the secret for that token lives.
const TOKEN_KEY = 'feathery-link-token-form-key';
const SECRET_KEY = (token: string) => `feathery-link-${token}`;

const sessionInfo = (overrides: Record<string, any> = {}) => ({
  sdkKey: 'sdkKey',
  userId: 'userId',
  collaboratorId: '',
  collaboratorReview: '',
  overrideUserId: false,
  formSessions: {},
  formSchemas: {},
  fieldValuesInitialized: false,
  ...overrides
});

// A session that carries form data, i.e. one the link gate let through.
const loadedSession = (overrides: Record<string, any> = {}) => ({
  new_user_id: 'fuser',
  integrations: {},
  servars: [],
  field_values: {},
  file_values: {},
  ...overrides
});

// The same, with the backend's word that a link is what resolved the
// submission. Its absence means the request's token opened nothing here.
const linkResolvedSession = (overrides: Record<string, any> = {}) =>
  loadedSession({ link: { resolved: true }, ...overrides });

const jsonResponse = (payload: any) => ({
  status: 200,
  json: () => Promise.resolve(payload)
});

const clientReturning = (payload: any) => {
  (apiFetch as jest.Mock).mockResolvedValue(jsonResponse(payload));
  return new FeatheryClient('form-key') as any;
};

// A 403 with a message, which is the only way the backend ever tells the client
// why a link failed. _fetch turns it into the blocked form state.
const clientRejecting = (message: string) => {
  (apiFetch as jest.Mock).mockRejectedValue(
    new FormAuthenticationError(message)
  );
  return new FeatheryClient('form-key') as any;
};

// The link lives on initState rather than a captured value because _fetch reads
// it per request, which is how a secret adopted mid-session reaches the
// requests that follow the redeem.
const openedWithLink = (token: string, deviceSecret = '') => {
  initState.linkToken = token;
  initState.linkSecret = deviceSecret;
};

const openPageAt = (search: string, hash = '') =>
  featheryWindow().history.replaceState({}, '', `/to/form${search}${hash}`);

const pageQuery = () => featheryWindow().location.search;
const pageHash = () => featheryWindow().location.hash;

const storedToken = () => featheryWindow().localStorage.getItem(TOKEN_KEY);

const requestOptions = (callIndex = 0) =>
  (apiFetch as jest.Mock).mock.calls[callIndex][2];

const requestHeaders = (callIndex = 0) => requestOptions(callIndex).headers;

beforeEach(() => {
  jest.clearAllMocks();
  initState.formSessions = {};
  initState.fieldValuesInitialized = false;
  initState.authenticationError = undefined;
  openedWithLink('');
  (initInfo as jest.Mock).mockReturnValue(sessionInfo());

  // A page load starts with empty stores and a fresh url; jsdom carries both
  // across the cases in a file, so each one resets them itself.
  featheryWindow().localStorage.clear();
  featheryDoc().cookie = `${TOKEN_KEY}=; max-age=0; path=/;`;
  openPageAt('');
});

describe('the access link header on every API request', () => {
  it('sends the bare token when this device has not redeemed yet', async () => {
    openedWithLink('tok');
    const client = clientReturning({});

    await client.updateUserId('new-fuser');

    expect(requestHeaders()['X-Feathery-Link']).toBe('tok');
  });

  it('sends the device secret alongside the token once redeemed, keeping the headers the call made', async () => {
    openedWithLink('tok', 'secret');
    const client = clientReturning({});

    await client.updateUserId('new-fuser');

    expect(requestHeaders()).toEqual({
      'X-Feathery-Link': 'tok.secret',
      'Content-Type': 'application/json'
    });
  });

  it('picks up a secret adopted after an earlier request went out', async () => {
    openedWithLink('tok');
    const client = clientReturning({});

    await client.updateUserId('new-fuser');
    openedWithLink('tok', 'secret');
    await client.updateUserId('new-fuser');

    expect(requestHeaders(0)['X-Feathery-Link']).toBe('tok');
    expect(requestHeaders(1)['X-Feathery-Link']).toBe('tok.secret');
  });

  it('adds no header for a form opened without a link', async () => {
    const client = clientReturning({});

    await client.updateUserId('new-fuser');

    expect(requestHeaders()).toEqual({ 'Content-Type': 'application/json' });
  });
});

describe('fetchSession with an access link', () => {
  it('sends the bare token when this device has not redeemed yet', async () => {
    openedWithLink('tok');
    const client = clientReturning({ link: { confirm: true } });

    await client.fetchSession();

    expect(requestHeaders()).toEqual({ 'X-Feathery-Link': 'tok' });
  });

  it('sends the device secret alongside the token once redeemed', async () => {
    openedWithLink('tok', 'secret');
    const client = clientReturning(linkResolvedSession());

    const [session] = await client.fetchSession();

    expect(requestHeaders()).toEqual({ 'X-Feathery-Link': 'tok.secret' });
    // The redeemed link opens the submission, so form data comes back with it
    expect(session).toMatchObject({ new_user_id: 'fuser' });
    expect(initState.formSessions['form-key']).toBeDefined();
  });

  it('sends no link header on an ordinary session', async () => {
    const client = clientReturning({ link: { required: true } });

    await client.fetchSession();

    expect(requestHeaders()).toBeUndefined();
  });

  it('returns the confirm flag and no form data', async () => {
    openedWithLink('tok');
    const client = clientReturning({ link: { confirm: true } });

    const [session] = await client.fetchSession();

    expect(session).toEqual({ link: { confirm: true } });
    expect(initState.formSessions).toEqual({});
  });

  it('leaves field values unloaded so the fetch after redeeming asks again', async () => {
    // A session that already skipped values still has to ask for them again:
    // the redeemed link opens a different submission than this request saw.
    openedWithLink('tok');
    (initInfo as jest.Mock).mockReturnValue(
      sessionInfo({ fieldValuesInitialized: true })
    );
    const client = clientReturning({ link: { confirm: true } });

    await client.fetchSession();

    expect(initState.fieldValuesInitialized).toBe(false);
  });

  it('returns the required flag when the form only opens from a link', async () => {
    const client = clientReturning({ link: { required: true } });

    const [session] = await client.fetchSession();

    expect(session).toEqual({ link: { required: true } });
  });

  it('leaves the values flag alone when the form only opens from a link', async () => {
    // `required` is terminal for this form - there is no link to redeem and no
    // fetch follows - so the reset the confirm branch needs has nothing left to
    // protect here
    const client = clientReturning({ link: { required: true } });

    await client.fetchSession();

    expect(initState.fieldValuesInitialized).toBe(true);
  });
});

describe('taking the token out of the address bar', () => {
  it('keeps it per form and strips it once the link resolves the session', async () => {
    openPageAt('?_lt=tok&utm_source=email', '#step-2');
    openedWithLink('tok');
    const client = clientReturning(linkResolvedSession());

    await client.fetchSession();

    expect(storedToken()).toBe('tok');
    // Everything the page was opened with other than the credential survives
    expect(pageQuery()).toBe('?utm_source=email');
    expect(pageHash()).toBe('#step-2');
  });

  it('keeps nothing when the server resolved the session without the link', async () => {
    // A token minted for another form is ignored rather than refused, and the
    // session comes back for the tracked user. Keeping it here would send
    // another form's credential on every later visit to this one.
    openPageAt('?_lt=other-form-token');
    openedWithLink('other-form-token');
    const client = clientReturning(loadedSession());

    await client.fetchSession();

    expect(storedToken()).toBeNull();
    expect(pageQuery()).toBe('?_lt=other-form-token');
  });

  it('strips it once a single-use link asks for confirmation', async () => {
    // The confirm answer proves the token is this form's, which is all the
    // address bar was still holding it for
    openPageAt('?_lt=tok');
    openedWithLink('tok');
    const client = clientReturning({ link: { confirm: true } });

    await client.fetchSession();

    expect(storedToken()).toBe('tok');
    expect(pageQuery()).toBe('');
  });

  it('strips a token the host page passed explicitly', async () => {
    // Hosted forms read `_lt` themselves and hand it to init, so the param is
    // still on display even though the SDK never read it
    openPageAt('?_lt=from-url');
    openedWithLink('from-host');
    const client = clientReturning(linkResolvedSession());

    await client.fetchSession();

    expect(storedToken()).toBe('from-host');
    expect(pageQuery()).toBe('');
  });

  it('leaves it alone when the form only opens from a link', async () => {
    // `required` means no usable link was presented, so there is nothing to
    // keep and the url stays as the user found it
    openPageAt('?_lt=tok');
    openedWithLink('tok');
    const client = clientReturning({ link: { required: true } });

    await client.fetchSession();

    expect(storedToken()).toBeNull();
    expect(pageQuery()).toBe('?_lt=tok');
  });

  it('leaves it alone when the link is rejected', async () => {
    // The token has to stay put for a retry elsewhere, and for the login round
    // trip, which rebuilds its redirect out of the url
    openPageAt('?_lt=tok');
    openedWithLink('tok');
    const client = clientRejecting('This link has expired.');

    await client.fetchSession();

    expect(storedToken()).toBeNull();
    expect(pageQuery()).toBe('?_lt=tok');
  });
});

describe('resuming a link session from a plain url', () => {
  it('reopens the form with the token and secret this device kept', async () => {
    featheryWindow().localStorage.setItem(TOKEN_KEY, 'tok');
    featheryWindow().localStorage.setItem(SECRET_KEY('tok'), 'secret');
    const client = clientReturning(linkResolvedSession());

    await client.fetchSession();

    expect(requestHeaders()).toEqual({ 'X-Feathery-Link': 'tok.secret' });
    expect(initState.linkToken).toBe('tok');
    expect(initState.linkSecret).toBe('secret');
  });

  it('leaves a token the page was opened with in place', async () => {
    // The url (or the init option) is the newer credential of the two
    featheryWindow().localStorage.setItem(TOKEN_KEY, 'stored');
    openedWithLink('from-url');
    const client = clientReturning(linkResolvedSession());

    await client.fetchSession();

    expect(requestHeaders()['X-Feathery-Link']).toBe('from-url');
  });

  it('forgets the token once the session says the link is spent', async () => {
    featheryWindow().localStorage.setItem(TOKEN_KEY, 'tok');
    featheryWindow().localStorage.setItem(SECRET_KEY('tok'), 'secret');
    openedWithLink('tok', 'secret');
    const client = clientRejecting(
      'This link has already been used on another device.'
    );

    await client.fetchSession();

    // Without this the device would replay a dead token forever and never see
    // anything but the error page
    expect(storedToken()).toBeNull();
    expect(featheryWindow().localStorage.getItem(SECRET_KEY('tok'))).toBeNull();
    // The in-memory pair goes too, or the assistant's own fetches keep sending
    // the dead credential for the rest of this visit
    expect(initState.linkToken).toBe('');
    expect(initState.linkSecret).toBe('');
  });

  it('keeps the token when the 403 was about something else', async () => {
    featheryWindow().localStorage.setItem(TOKEN_KEY, 'tok');
    openedWithLink('tok', 'secret');
    const client = clientRejecting('Please log in to continue.');

    await client.fetchSession();

    expect(storedToken()).toBe('tok');
    expect(initState.linkToken).toBe('tok');
    expect(initState.linkSecret).toBe('secret');
  });
});

describe('redeemLink', () => {
  it('posts the token and returns the submission it opens', async () => {
    const redemption = {
      fuser_key: 'fuser',
      collaborator_id: 'collab',
      device_secret: 'secret'
    };
    const client = clientReturning(redemption);

    await expect(client.redeemLink('tok')).resolves.toEqual(redemption);

    const [, url] = (apiFetch as jest.Mock).mock.calls[0];
    const options = requestOptions();
    expect(url).toContain('panel/link/redeem/');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ token: 'tok' });
  });

  it('redeems nothing when the link was rejected', async () => {
    // A 403 is turned into the blocked form state inside _fetch, which then
    // resolves with nothing rather than a response.
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest.fn().mockResolvedValue(undefined);

    await expect(client.redeemLink('tok')).resolves.toBeUndefined();
  });

  it('forgets the stored token when the link was rejected', async () => {
    featheryWindow().localStorage.setItem(TOKEN_KEY, 'tok');
    openedWithLink('tok', 'secret');
    const client = clientRejecting('This link is not valid.');

    await expect(client.redeemLink('tok')).resolves.toBeUndefined();

    expect(storedToken()).toBeNull();
    expect(initState.linkToken).toBe('');
    expect(initState.linkSecret).toBe('');
  });

  it('surfaces a rate limit so the caller can offer a retry', async () => {
    const client = new FeatheryClient('form-key') as any;
    client._fetch = jest.fn().mockRejectedValue(new Error('Unknown error'));

    await expect(client.redeemLink('tok')).rejects.toThrow('Unknown error');
  });
});

// Last in the file because switching regions is module state: every case after
// one of these reads the hosts it leaves behind.
describe('the backend hosts a client request reaches', () => {
  it('leaves the CDN form fetch alone', async () => {
    // Pinned to a region whose API, static and CDN hosts all differ. Under
    // BACKEND_ENV=local or staging they are one origin, and this case would
    // pass or fail by accident rather than proving the exclusion.
    updateRegionApiUrls('ca');
    expect(new URL(CDN_URL).origin).not.toBe(new URL(API_URL).origin);
    openedWithLink('tok', 'secret');
    const client = clientReturning({});

    await client.fetchCacheForm();

    const [, url] = (apiFetch as jest.Mock).mock.calls[0];
    expect(url).toContain(new URL(CDN_URL).host);
    expect(requestHeaders()['X-Feathery-Link']).toBeUndefined();
  });

  it('follows a region switch to the new API host', async () => {
    // The wrapper reads the hosts per request, so a form that switched regions
    // still sends its credential to the region it is now talking to
    updateRegionApiUrls('eu');
    openedWithLink('tok', 'secret');
    const client = clientReturning({});

    await client.updateUserId('new-fuser');

    const [, url] = (apiFetch as jest.Mock).mock.calls[0];
    expect(url).toContain('api-eu.feathery.io');
    expect(requestHeaders()['X-Feathery-Link']).toBe('tok.secret');
  });
});
