import { getStytchJwt } from '../utils/browser';
import { getAuthClient, setAuthClient } from '../utils/init';
import { dynamicImport } from './utils';

let stytchPromise = null;
let config = null;
// This guard prevents a second auth attempt to stytch if the form is preloaded
let authSent = false;

export function installStytch(stytchConfig) {
  if (stytchPromise) return stytchPromise;
  else if (!stytchConfig) return Promise.resolve();
  else {
    config = stytchConfig;
    stytchPromise = new Promise((resolve) => {
      const stytchClient = getAuthClient();
      if (stytchClient) resolve(stytchClient);
      else {
        // Bring in stytch dependencies dynamically if this form uses stytch
        return dynamicImport(['https://js.stytch.com/stytch.js'], false).then(
          () => {
            const initializedClient = global.Stytch(stytchConfig.api_key);
            setAuthClient(initializedClient);
            resolve(initializedClient);
          }
        );
      }
    });
    return stytchPromise;
  }
}

export async function sendMagicLink(fieldVal) {
  return getAuthClient().magicLinks.email.loginOrCreate(fieldVal, {
    login_magic_link_url: config.metadata.login_link,
    login_expiration_minutes: config.metadata.login_expiration,
    signup_magic_link_url: config.metadata.signup_link,
    signup_expiration_minutes: config.metadata.signup_expiration
  });
}

export async function emailLogin(featheryClient) {
  const jwt = getStytchJwt(false);
  const type = new URLSearchParams(window.location.search).get(
    'stytch_token_type'
  );
  const token = new URLSearchParams(window.location.search).get('token');
  const stytchClient = getAuthClient();
  // if jwt already exists, but stytch token still in URL params, then don't try
  // to auth again as it will fail due to the info already being used to login
  if (jwt || authSent || !stytchClient || !type || !token || !config) return;

  authSent = true;

  const opts = {
    session_duration_minutes: config.metadata.session_duration
  };
  let authFn;
  if (type === 'oauth') {
    authFn = () => stytchClient.oauth.authenticate(token, opts);
  } else if (type === 'magic_links') {
    authFn = () => stytchClient.magicLinks.authenticate(token, opts);
  } else {
    return;
  }

  return await authFn().then(async (result) => {
    return await featheryClient
      .submitAuthInfo({
        authId: result.user.user_id,
        authEmail: result.user.emails[0].email
      })
      .then((session) => session);
  });
}

export function googleOauthRedirect() {
  const client = getAuthClient();
  if (!client) return;

  window.location.href = client.oauth.google.start({
    login_redirect_url: config.metadata.login_link,
    signup_redirect_url: config.metadata.signup_link
  });
}
