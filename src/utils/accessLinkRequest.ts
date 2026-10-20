import { getApiUrl, getStaticUrl } from '@feathery/client-utils';
import { linkRequestHeaders } from './accessLink';
import { initState } from './init';
import { objectFromEntries } from './primitives';

/**
 * Requests the link header belongs on, matched by origin rather than by the
 * `/api/` prefix: the in-form assistant talks to `/agent/...` on the same host,
 * and it resolves the submission too.
 *
 * Both backend origins count. In US production the static host is a separate
 * host from the API one, and endpoints the backend gates on the link live on it
 * (`persona/poll/`, for one). The CDN and S3 hosts are separate origins that
 * hold no submission data, so they stay out; outside production they can
 * collapse onto the API origin, which is the same backend either way.
 *
 * The hosts are read per request rather than captured, so a region switch
 * (`updateRegionApiUrls`) is honored by the requests that follow it.
 */
const isLinkGatedRequest = (url: any): url is string => {
  if (typeof url !== 'string') return false;
  try {
    const requestOrigin = new URL(url).origin;
    return [getApiUrl(), getStaticUrl()].some(
      (backendUrl) => new URL(backendUrl).origin === requestOrigin
    );
  } catch (e) {
    // A relative or malformed url, or an environment that was never
    // configured, is not one of the backend origins
    return false;
  }
};

// Names the collaborator a request is acting as. The backend admits a later
// collaborator to a link-bound submission on this alone: the invite that
// brought them in gave them a collaborator id, never a token of their own.
const COLLABORATOR_HEADER = 'X-Feathery-Collaborator';

/**
 * The credentials a request to `url` should carry so the backend can resolve a
 * link-bound submission, or undefined when the url is not one it gates. The
 * access link and the collaborator id are independent of each other: a link
 * without a collaborator is the ordinary case, a collaborator without a link is
 * everyone invited after the first, and both together is a link that opened a
 * collaborative submission.
 *
 * This is the whole contract client-utils' header provider needs, so it is
 * registered there as one call; `withLinkRequestHeaders` is the SDK-side caller
 * for the requests that go out through `fetch` directly.
 *
 * `initState` is read per request rather than captured once: a single-use link
 * hands back its device secret mid-session, and a redeemed link can hand back a
 * collaborator id, so every request after that has to send what it learned.
 */
export const linkHeadersForUrl = (
  url: any
): Record<string, string> | undefined => {
  if (!isLinkGatedRequest(url)) return undefined;

  const headers: Record<string, string> = {
    ...linkRequestHeaders(initState.linkToken, initState.linkSecret)
  };
  if (initState.collaboratorId)
    headers[COLLABORATOR_HEADER] = initState.collaboratorId;

  return Object.keys(headers).length ? headers : undefined;
};

/**
 * The backend gates every SDK endpoint of a link-bound submission on the access
 * link, not only the session fetch, so each request to it carries the header.
 * Requests client-utils builds pick the same headers up from the provider it
 * was handed; this wraps the ones the SDK sends through `fetch` itself, which
 * is the assistant's endpoints and the offline replay.
 *
 * This lives outside featheryClient so the assistant can reach it: entering the
 * client through integrationClient leaves `FeatheryClient extends
 * IntegrationClient` holding a half-built class.
 */
export const withLinkRequestHeaders = (url: any, options: any) => {
  const linkHeaders = linkHeadersForUrl(url);
  if (!linkHeaders) return options;

  // `fetch` takes a Headers instance as readily as a plain object, and the
  // assistant hands its transport's own init straight through. Spreading a
  // Headers yields an empty object, so it is flattened first rather than
  // dropping every header the caller set.
  const callerHeaders: Record<string, string> =
    typeof options?.headers?.entries === 'function'
      ? objectFromEntries(options.headers.entries())
      : { ...options?.headers };

  // The link headers are this device's credentials for the submission, so they
  // outrank the same headers passed by a caller, while every other header
  // chosen for that one request still wins. Header names are case insensitive
  // and a flattened Headers arrives lowercased, so the caller's copy is dropped
  // by name rather than shadowed: two spellings in one object are sent joined
  // instead of replaced.
  const linkHeaderNames = new Set(
    Object.keys(linkHeaders).map((name) => name.toLowerCase())
  );
  Object.keys(callerHeaders).forEach((name) => {
    if (linkHeaderNames.has(name.toLowerCase())) delete callerHeaders[name];
  });

  return { ...options, headers: { ...callerHeaders, ...linkHeaders } };
};
