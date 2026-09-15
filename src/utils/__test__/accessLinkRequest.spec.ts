import {
  getApiUrl,
  getCdnUrl,
  getStaticUrl,
  setEnvironment
} from '@feathery/client-utils';
import {
  linkHeadersForUrl,
  withLinkRequestHeaders
} from '../accessLinkRequest';
import { initState } from '../init';

// Only the submission state is faked. The backend hosts come from the real
// client-utils, since which of them the headers follow is the whole contract
// under test here. '../init' is mocked because it instantiates FeatheryClient at
// module load, which would drag the rest of the SDK in with it.
jest.mock('../init', () => ({
  initState: { linkToken: '', linkSecret: '', collaboratorId: '' }
}));

// Pinned rather than inherited from BACKEND_ENV: local, docker and staging put
// the API, static and CDN endpoints on one origin, so every exclusion below
// would pass or fail by accident there. US production is the environment where
// all three differ, which is what makes these cases meaningful.
const US_PRODUCTION = 'production';

const openedWithLink = (token: string, deviceSecret = '') => {
  initState.linkToken = token;
  initState.linkSecret = deviceSecret;
};

const actingAsCollaborator = (collaboratorId: string) => {
  initState.collaboratorId = collaboratorId;
};

beforeEach(() => {
  setEnvironment(US_PRODUCTION);
  openedWithLink('');
  actingAsCollaborator('');
});

describe('the credentials a gated request carries', () => {
  const sessionUrl = () => `${getApiUrl()}panel/session/v3/`;

  it('sends the collaborator id on its own', () => {
    // Everyone invited after the first collaborator reaches a link-bound
    // submission through their invite, never with a token of their own
    actingAsCollaborator('collab');

    expect(linkHeadersForUrl(sessionUrl())).toEqual({
      'X-Feathery-Collaborator': 'collab'
    });
  });

  it('sends both when a link opened a collaborative submission', () => {
    openedWithLink('tok', 'secret');
    actingAsCollaborator('collab');

    expect(linkHeadersForUrl(sessionUrl())).toEqual({
      'X-Feathery-Link': 'tok.secret',
      'X-Feathery-Collaborator': 'collab'
    });
  });

  it('sends nothing when there is neither', () => {
    expect(linkHeadersForUrl(sessionUrl())).toBeUndefined();
  });

  it('keeps the collaborator id off a host the backend does not gate', () => {
    actingAsCollaborator('collab');

    expect(linkHeadersForUrl(getCdnUrl())).toBeUndefined();
  });

  it('overrides a collaborator header the caller passed', () => {
    actingAsCollaborator('collab');

    const options = withLinkRequestHeaders(sessionUrl(), {
      headers: { 'X-Feathery-Collaborator': 'caller-collab' }
    });

    expect(options.headers).toEqual({ 'X-Feathery-Collaborator': 'collab' });
  });
});

describe('the backend hosts the access link header follows', () => {
  beforeEach(() => openedWithLink('tok', 'secret'));

  it('sends it to the API host', () => {
    expect(linkHeadersForUrl(`${getApiUrl()}panel/session/v3/`)).toEqual({
      'X-Feathery-Link': 'tok.secret'
    });
  });

  it('sends it to the static host, a separate host in US production', () => {
    // The backend gates endpoints on this host too, so the header has to reach
    // them; in US production it is not the host getApiUrl() resolves to
    expect(new URL(getStaticUrl()).origin).not.toBe(
      new URL(getApiUrl()).origin
    );

    expect(
      linkHeadersForUrl(`${getStaticUrl()}persona/poll/?fuser_key=f`)
    ).toEqual({ 'X-Feathery-Link': 'tok.secret' });
  });

  it('follows a region switch to the new API host', () => {
    // The hosts are read per request, so a form that switched regions after
    // load still sends the header to the region it is now talking to
    setEnvironment('productionEU');

    expect(new URL(getApiUrl()).origin).toContain('api-eu');
    expect(linkHeadersForUrl(`${getApiUrl()}panel/session/v3/`)).toBeDefined();
  });

  it('leaves the CDN host alone', () => {
    expect(new URL(getCdnUrl()).origin).not.toBe(new URL(getApiUrl()).origin);

    expect(
      linkHeadersForUrl(`${getCdnUrl()}panel/v2/?form_key=f`)
    ).toBeUndefined();
  });

  it('leaves a signed S3 url alone', () => {
    expect(
      linkHeadersForUrl(
        'https://feathery-files.s3.us-west-1.amazonaws.com/f.pdf?X-Amz-Signature=abc'
      )
    ).toBeUndefined();
  });

  it('leaves a url it cannot resolve to an origin alone', () => {
    expect(linkHeadersForUrl('/api/panel/session/v3/')).toBeUndefined();
    expect(linkHeadersForUrl(undefined)).toBeUndefined();
  });

  it('sends nothing for a form opened without a link', () => {
    openedWithLink('');

    expect(
      linkHeadersForUrl(`${getApiUrl()}panel/session/v3/`)
    ).toBeUndefined();
  });
});

describe('withLinkRequestHeaders', () => {
  const apiUrl = () => `${getApiUrl()}panel/step/submit/v3/`;

  it('returns the options untouched when the url is not gated', () => {
    openedWithLink('tok');
    const options = { method: 'POST', headers: { 'Content-Type': 'text/csv' } };

    expect(withLinkRequestHeaders(getCdnUrl(), options)).toBe(options);
  });

  it('keeps the headers the caller chose for the request', () => {
    openedWithLink('tok', 'secret');

    const options = withLinkRequestHeaders(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    expect(options).toMatchObject({ method: 'POST' });
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Feathery-Link': 'tok.secret'
    });
  });

  it('overrides a link header the caller passed', () => {
    // The header is this device's credential for the submission rather than a
    // per-call option, so a stale or hand-rolled one must not win
    openedWithLink('tok', 'secret');

    const options = withLinkRequestHeaders(apiUrl(), {
      headers: { 'X-Feathery-Link': 'caller-token', Accept: 'application/json' }
    });

    expect(options.headers).toEqual({
      'X-Feathery-Link': 'tok.secret',
      Accept: 'application/json'
    });
  });

  it('adds the header to a call that passed no options at all', () => {
    openedWithLink('tok');

    expect(withLinkRequestHeaders(apiUrl(), undefined)).toEqual({
      headers: { 'X-Feathery-Link': 'tok' }
    });
  });

  it('keeps the headers of a caller that passed a Headers instance', () => {
    // The assistant's chat transport builds its own request init, and `fetch`
    // takes a Headers there as readily as a plain object. Spreading one yields
    // nothing, so every header the caller set would go missing.
    openedWithLink('tok', 'secret');
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Thread-Id': 'thread'
    });

    const options = withLinkRequestHeaders(apiUrl(), {
      method: 'POST',
      headers
    });

    expect(options.headers).toEqual({
      // Header names come back lowercased from a Headers instance, which is how
      // they go out on the wire either way
      'content-type': 'application/json',
      'x-thread-id': 'thread',
      'X-Feathery-Link': 'tok.secret'
    });
  });

  it('overrides a link header a Headers instance carried', () => {
    openedWithLink('tok', 'secret');
    const headers = new Headers({ 'X-Feathery-Link': 'caller-token' });

    const options = withLinkRequestHeaders(apiUrl(), { headers });

    expect(options.headers).toEqual({ 'X-Feathery-Link': 'tok.secret' });
  });
});
