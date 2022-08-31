import { getAuthClient, setAuthClient } from '../utils/init';
import { dynamicImport } from './utils';

const STYTCH_JS_URL = 'https://js.stytch.com/stytch.js';

let stytchPromise = null;
let config = null;
// This guard prevents a second auth attempt to stytch if the form is preloaded
let authSent = false;

export function installStytch(stytchConfig) {
  if (stytchPromise) return stytchPromise;
  else if (!stytchConfig || stytchConfig.metadata.token === '')
    return Promise.resolve();
  else {
    config = stytchConfig;
    stytchPromise = new Promise((resolve) => {
      const stytchClient = getAuthClient();
      if (stytchClient) resolve(stytchClient);
      else {
        // Bring in stytch dependencies dynamically if this form uses stytch
        // When calling `await loadStytch()` with the JS SDK it does this script
        // check internally. If that loads first and then we do a dynamic import
        // it causes an error, so don't dynamic import if the script is already
        // set
        const isStytchImported = document.querySelectorAll(
          `script[src="${STYTCH_JS_URL}"]`
        )[0];
        if (isStytchImported) return resolve();

        return dynamicImport(STYTCH_JS_URL).then(() => {
          const initializedClient = global.Stytch(stytchConfig.metadata.token);
          setAuthClient(initializedClient);
          resolve(initializedClient);
        });
      }
    });
    return stytchPromise;
  }
}

export function googleOauthRedirect() {
  const stytchClient = getAuthClient();
  if (!stytchClient) return;

  const redirectUrl = getRedirectUrl();
  stytchClient.oauth.google.start({
    login_redirect_url: redirectUrl,
    signup_redirect_url: redirectUrl
  });
}

export function sendMagicLink({ fieldVal }) {
  const client = getAuthClient();
  if (!client) return;

  const redirectUrl = getRedirectUrl();
  return client.magicLinks.email.loginOrCreate(fieldVal, {
    login_magic_link_url: redirectUrl,
    signup_magic_link_url: redirectUrl,
    login_expiration_minutes: config.metadata.login_expiration,
    signup_expiration_minutes: config.metadata.signup_expiration
  });
}

export function emailLogin(featheryClient) {
  const stytchClient = getAuthClient();
  // If there is no auth client, no config or auth has already been sent, then return early
  if (!stytchClient || !config || authSent) return;

  const stytchSession = stytchClient.session.getSync();
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');

  // Flag so that we don't attempt auth again after, if it was successful
  authSent = true;

  // If there is an existing Stytch session when a user returns to an embedded
  // Feathery form, we need to update the auth info from Feathery's side
  if (stytchSession) return featherySubmitAuthInfo(featheryClient);
  // If there is no existing Stytch session & the stytch query params are
  // present, then attempt auth. If the Stytch query params exist, but a
  // session also exists, then we don't want to execute stytch auth again as
  // it will fail due to the token query param already being used
  else if (!stytchSession && validateStytchQueryParams({ token, type })) {
    const authFn = determineAuthFn({ token, type });

    return authFn()
      .then(() => featherySubmitAuthInfo(featheryClient))
      .catch((e) =>
        console.log('Auth failed. Possibly because your magic link expired.', e)
      );
  }
}

function featherySubmitAuthInfo(featheryClient) {
  const stytchClient = getAuthClient();
  // eslint-disable-next-line camelcase
  const authId = stytchClient.session.getSync()?.user_id;
  const authEmail = stytchClient.user.getSync()?.emails[0].email;
  removeStytchQueryParams();
  return featheryClient
    .submitAuthInfo({
      authId,
      authEmail,
      is_stytch_template_key: config.is_stytch_template_key
    })
    .catch(() => (authSent = false));
}

function validateStytchQueryParams({ token, type }) {
  return token && (type === 'magic_links' || type === 'oauth');
}

function determineAuthFn({ token, type }) {
  const stytchClient = getAuthClient();
  const opts = {
    session_duration_minutes: config.metadata.session_duration
  };
  let authFn;
  if (type === 'oauth') {
    authFn = () => stytchClient.oauth.authenticate(token, opts);
  } else if (type === 'magic_links') {
    authFn = () => stytchClient.magicLinks.authenticate(token, opts);
  } else {
    return null;
  }
  return authFn;
}

function removeStytchQueryParams() {
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (type && token) {
    queryParams.delete('stytch_token_type');
    queryParams.delete('token');
    // Removes stytch query params without triggering page refresh
    history.replaceState(null, '', '?' + queryParams + window.location.hash);
  }
}

function getRedirectUrl() {
  const { origin, pathname, hash } = window.location;
  return `${origin}${pathname}${hash}`;
}
