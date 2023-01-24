import { getAuthClient, setAuthClient } from '../utils/init';
import { dynamicImport } from './utils';
import { featheryDoc } from '../utils/browser';
import { authState } from '../elements/components/FeatheryAuthGate';

const STYTCH_JS_URL = 'https://js.stytch.com/stytch.js';

export const authHookCb: Record<string, () => void> = {};

let stytchPromise: any = null;
let config: any = null;
// When verifying the SMS OTP we can't just provide the phone number again. We
// need to provide this method_id from Stytch. It is in the network response
// after sending the SMS
let stytchPhoneMethodId = '';
// This guard prevents a second auth attempt to stytch if the form is preloaded
let authSent = false;

export function installStytch(stytchConfig: any) {
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
        const isStytchImported = featheryDoc().querySelectorAll(
          `script[src="${STYTCH_JS_URL}"]`
        )[0];
        // @ts-expect-error TS(2794): Expected 1 arguments, but got 0. Did you forget to... Remove this comment to see the full error message
        if (isStytchImported) return resolve();

        return dynamicImport(STYTCH_JS_URL).then(() => {
          const initializedClient = global.Stytch(stytchConfig.metadata.token);
          // Trigger the auth cbs
          authHookCb.cb();
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

export function sendMagicLink({ fieldVal }: any) {
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

export function sendSMSCode({ fieldVal }: any) {
  const client = getAuthClient();
  if (!client) return;

  // need to add + in front, https://stytch.com/docs/api/log-in-or-create-user-by-sms
  return client.otps.sms.loginOrCreate(`+${fieldVal}`).then((resp: any) => {
    stytchPhoneMethodId = resp.method_id;
    return resp;
  });
}

export function emailLogin(featheryClient: any) {
  const stytchClient = getAuthClient();
  // If there is no auth client, no config or auth has already been sent, then return early
  if (!stytchClient || !config || authSent) return;

  const stytchSession = stytchClient.session.getSync();
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');

  // Flag so that we don't attempt auth again after, if it was successful
  authSent = true;
  // This is a separate flag because it is never reset
  authState.sentAuth = true;

  // If there is an existing Stytch session when a user returns to an embedded
  // Feathery form, we need to update the auth info from Feathery's side
  if (stytchSession) return featherySubmitAuthInfo(featheryClient);
  // If there is no existing Stytch session & the stytch query params are
  // present, then attempt auth. If the Stytch query params exist, but a
  // session also exists, then we don't want to execute stytch auth again as
  // it will fail due to the token query param already being used
  else if (!stytchSession && validateStytchQueryParams({ token, type })) {
    const authFn = determineAuthFn({ token, type });

    // @ts-expect-error TS(2721): Cannot invoke an object which is possibly 'null'.
    return authFn()
      .then(() => featherySubmitAuthInfo(featheryClient))
      .catch((e: any) =>
        console.log('Auth failed. Possibly because your magic link expired.', e)
      );
  }
}

export function smsLogin({ fieldVal, featheryClient }: any) {
  const client = getAuthClient();
  if (!client || stytchPhoneMethodId === '') return Promise.resolve();

  return client.otps
    .authenticate(fieldVal, stytchPhoneMethodId, {
      session_duration_minutes: config.metadata.session_duration
    })
    .then(() => {
      stytchPhoneMethodId = '';
      return featherySubmitAuthInfo(featheryClient);
    });
}

function featherySubmitAuthInfo(featheryClient: any) {
  const stytchClient = getAuthClient();
  const user = stytchClient.user.getSync();
  if (!user) return;

  removeStytchQueryParams();
  return featheryClient
    .submitAuthInfo({
      authId: stytchClient.session.getSync()?.user_id,
      authEmail: user.emails[0]?.email ?? '',
      // Slice off the + from the phone number
      authPhone: user.phone_numbers[0]?.phone_number.slice(1) ?? '',
      isStytchTemplateKey: config.is_stytch_template_key
    })
    .catch(() => (authSent = false));
}

function validateStytchQueryParams({ token, type }: any) {
  return token && (type === 'magic_links' || type === 'oauth');
}

function determineAuthFn({ token, type }: any) {
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
  const queryParams = new URLSearchParams(window.location.search);
  queryParams.forEach((value, key) => {
    if (key !== 'feathery_1' && key !== 'feathery_2') queryParams.delete(key);
  });
  const queryString = queryParams.has('feathery_1') ? `?${queryParams}` : '';
  return `${origin}${pathname}${queryString}${hash}`;
}
