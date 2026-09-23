import { deleteCookie, featheryWindow, getCookie, setCookie } from './browser';

// URL param carrying an access link token, e.g. /to/<slug>/?_lt=<token>
export const LINK_TOKEN_PARAM = '_lt';

// The cookie copies of a device secret and of a token are fallbacks, and one is
// written per link on a shared host (form.feathery.io), where every cookie
// rides every request. Keep them far shorter lived than the SDK's year-long
// identity cookies so abandoned links stop being sent along.
const LINK_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

// Written and removed within the probe below, never carrying a real secret.
// The max age only bounds the stray cookie left behind if the removal itself
// is what the browser refuses.
const STORAGE_PROBE_KEY = 'feathery-link-probe';
const STORAGE_PROBE_VALUE = '1';
const PROBE_COOKIE_MAX_AGE_SECONDS = 60;

const secretStorageKey = (token: string) => `feathery-link-${token}`;
const formTokenStorageKey = (formKey: string) =>
  `feathery-link-token-${formKey}`;

// The backend's 403s for a presented token that is itself spent, verbatim from
// `apps/api/access_links.py`; "only from its access link" means none was usable
const REJECTED_LINK_MESSAGES = new Set([
  'This link is not valid.',
  'This link has expired.',
  'This link has already been used on another device.'
]);

/**
 * localStorage is the primary store for everything a link keeps on the device,
 * because none of it is ever read by the server off a request. The cookie is a
 * fallback for the embeds where localStorage is unavailable, written only when
 * localStorage did not keep the value; either store may also throw outright
 * when the browser blocks it.
 */
function readLinkStorage(key: string): string {
  try {
    const storedValue = featheryWindow().localStorage?.getItem(key);
    if (storedValue) return storedValue;
  } catch (e) {
    // Storage blocked - fall through to the cookie
  }

  try {
    return getCookie(key) ?? '';
  } catch (e) {
    return '';
  }
}

function writeLinkStorage(key: string, value: string) {
  try {
    const storage = featheryWindow().localStorage;
    storage?.setItem(key, value);
    // Nothing more to write once localStorage holds the value. A store that
    // takes the write and hands back nothing (private and partitioned modes)
    // still needs the cookie, and so does one that threw. Keeping the cookie a
    // genuine fallback matters on the shared hosted form domain, where one is
    // written per link and every one of them rides every request.
    if (storage?.getItem(key) === value) return;
  } catch (e) {
    // Storage blocked - the cookie below is the only copy
  }

  try {
    setCookie(key, value, LINK_COOKIE_MAX_AGE_SECONDS);
  } catch (e) {
    // Cookies unavailable too, so nothing holds the value. The current page
    // keeps working, but a reload sends the bare token and the server answers
    // that the link has already been used on another device.
    // `canPersistLinkSecret` is what keeps a single-use link from being
    // redeemed into this state.
  }
}

function clearLinkStorage(key: string) {
  try {
    featheryWindow().localStorage?.removeItem(key);
  } catch (e) {
    // Storage blocked, so it holds nothing of ours to remove
  }

  try {
    deleteCookie(key);
  } catch (e) {
    // Nothing left to try. A stale copy is sent once more and rejected again,
    // which is the same state this device was already in.
  }
}

/**
 * What redeeming an access link hands back. The client learns only which
 * submission it opened and its own device secret - expiry and single-use state
 * stay on the server.
 */
export type LinkRedemption = {
  fuser_key: string;
  collaborator_id: string | null;
  device_secret: string;
};

/**
 * What the Continue screen should do next. `adopted` remounts the form and
 * `blocked` hands over to the blocked state, so only `failed` and
 * `storage_blocked` leave the user on the Continue screen with something to
 * retry. `storage_blocked` is decided before the server is touched, so the link
 * it describes is still unredeemed and can be opened elsewhere.
 */
export type LinkConfirmOutcome =
  | 'adopted'
  | 'blocked'
  | 'failed'
  | 'storage_blocked';

/**
 * Read the access link token from the page URL. Only meaningful in the browser.
 * A repeated `_lt` is ambiguous, so neither copy is used.
 */
export function getLinkTokenFromUrl(): string {
  const search = featheryWindow().location?.search ?? '';
  const tokens = new URLSearchParams(search).getAll(LINK_TOKEN_PARAM);
  return tokens.length === 1 ? tokens[0] : '';
}

/**
 * The device secret proves this browser is the one that redeemed a single-use
 * link, so it is stored per token: another link to the same submission gets its
 * own secret, and revoking one link leaves the others alone.
 */
export function getStoredLinkSecret(token: string): string {
  return readLinkStorage(secretStorageKey(token));
}

export function storeLinkSecret(token: string, secret: string) {
  writeLinkStorage(secretStorageKey(token), secret);
}

/**
 * What this browser kept for a form after its token left the address bar. Read
 * as a pair so the secret is always looked up under the token it belongs to.
 */
export type StoredLinkCredentials = {
  token: string;
  secret: string;
};

export function getStoredLinkCredentials(
  formKey: string
): StoredLinkCredentials {
  const token = readLinkStorage(formTokenStorageKey(formKey));
  return { token, secret: token ? getStoredLinkSecret(token) : '' };
}

/**
 * Keep the token the server has just accepted for this form, and take it out of
 * the address bar. The token is a bearer credential, so leaving it on display
 * feeds it to browser history, referrers, screen shares, and every url the user
 * copies; the stored copy is what reopens the link on a reload or in a new tab.
 *
 * Stored per form rather than per page so a second form on the same device is
 * unaffected, and so the token that comes back is the one minted for the form
 * asking for it.
 */
export function retainLinkToken(formKey: string, token?: string): void {
  if (!formKey || !token) return;

  const key = formTokenStorageKey(formKey);
  writeLinkStorage(key, token);
  // Only give the url copy up once another one is genuinely in hand. Both
  // stores can be blocked (a cross origin iframe, private mode), and there the
  // address bar is the only thing carrying the token through a reload or a
  // login redirect.
  if (readLinkStorage(key) === token) stripLinkTokenFromUrl();
}

// Drop a rejected token and its secret. The form's kept token goes only if it
// is that token, so an old emailed link never wipes a newer one
export function forgetLinkToken(formKey: string, token: string): void {
  if (!token) return;

  clearLinkStorage(secretStorageKey(token));
  const tokenKey = formTokenStorageKey(formKey);
  if (formKey && readLinkStorage(tokenKey) === token)
    clearLinkStorage(tokenKey);
}

export function isRejectedLinkMessage(message?: string): boolean {
  return !!message && REJECTED_LINK_MESSAGES.has(message);
}

/**
 * Remove `_lt` from the address bar, leaving every other param and the hash
 * exactly where they were. Runs once per page load by construction rather than
 * by a flag: the first call takes the param away, so later ones find nothing.
 */
function stripLinkTokenFromUrl(): void {
  const { location, history } = featheryWindow();
  if (!location || !history?.replaceState) return;

  const params = new URLSearchParams(location.search ?? '');
  if (!params.has(LINK_TOKEN_PARAM)) return;
  params.delete(LINK_TOKEN_PARAM);

  const query = params.toString();
  history.replaceState(
    {},
    '',
    `${location.pathname}${query ? `?${query}` : ''}${location.hash ?? ''}`
  );
}

/**
 * Whether this browser can hold a device secret at all, checked before a
 * single-use link is redeemed. In a cross origin iframe (Safari blocks storage,
 * Chrome partitions it) the redeem would succeed, the secret would have nowhere
 * to live, and the next reload would send the bare token and be told the link
 * was already used on another device. Failing here instead leaves the link
 * unredeemed, so the user can still open it in a top level tab.
 *
 * Only a write, read back, and removal proves a store: a blocked browser may
 * expose localStorage and accept the write, then hand back nothing. Either
 * store round-tripping is enough, since that is all `storeLinkSecret` needs.
 */
export function canPersistLinkSecret(): boolean {
  try {
    const storage = featheryWindow().localStorage;
    storage.setItem(STORAGE_PROBE_KEY, STORAGE_PROBE_VALUE);
    const storedProbe = storage.getItem(STORAGE_PROBE_KEY);
    storage.removeItem(STORAGE_PROBE_KEY);
    if (storedProbe === STORAGE_PROBE_VALUE) return true;
  } catch (e) {
    // Storage blocked or absent - fall through to the cookie
  }

  try {
    setCookie(
      STORAGE_PROBE_KEY,
      STORAGE_PROBE_VALUE,
      PROBE_COOKIE_MAX_AGE_SECONDS
    );
    const probeCookie = getCookie(STORAGE_PROBE_KEY);
    deleteCookie(STORAGE_PROBE_KEY);
    return probeCookie === STORAGE_PROBE_VALUE;
  } catch (e) {
    return false;
  }
}

/**
 * `X-Feathery-Link: <token>` until this device has redeemed the link, and
 * `<token>.<device secret>` afterwards. The server needs both halves to let a
 * redeemed single-use link reopen on the device that claimed it.
 */
export function linkRequestHeaders(
  token?: string,
  deviceSecret?: string
): Record<string, string> | undefined {
  if (!token) return undefined;
  return {
    'X-Feathery-Link': deviceSecret ? `${token}.${deviceSecret}` : token
  };
}
