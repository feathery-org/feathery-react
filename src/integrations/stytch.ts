import { StytchHeadlessClient } from '@stytch/vanilla-js/headless';
import { authState } from '../auth/LoginForm';

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
      if (authState.client) resolve(authState.client);
      else {
        const initializedClient = new StytchHeadlessClient(
          stytchConfig.metadata.token,
          {
            cookieOptions: {
              availableToSubdomains: true
            }
          }
        );
        authState.setClient(initializedClient);
        resolve(initializedClient);
      }
    });
    return stytchPromise;
  }
}

export function googleOauthRedirect() {
  const stytchClient = authState.client;
  if (!stytchClient) return;

  const redirectUrl = getRedirectUrl();
  stytchClient.oauth.google.start({
    login_redirect_url: redirectUrl,
    signup_redirect_url: redirectUrl
  });
}

export function sendMagicLink({ fieldVal }: any) {
  const client = authState.client;
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
  const client = authState.client;
  if (!client) return;

  // need to add + in front, https://stytch.com/docs/api/log-in-or-create-user-by-sms
  return client.otps.sms.loginOrCreate(`+${fieldVal}`).then((resp: any) => {
    stytchPhoneMethodId = resp.method_id;
    return resp;
  });
}

export function emailLogin(featheryClient: any) {
  const stytchClient = authState.client;
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
  if (stytchSession) return stytchSubmitAuthInfo(featheryClient);
  // If there is no existing Stytch session & the stytch query params are
  // present, then attempt auth. If the Stytch query params exist, but a
  // session also exists, then we don't want to execute stytch auth again as
  // it will fail due to the token query param already being used
  else if (!stytchSession && validateStytchQueryParams({ token, type })) {
    const authFn = determineAuthFn({ token, type });

    // @ts-expect-error TS(2721): Cannot invoke an object which is possibly 'null'.
    return authFn()
      .then(() => stytchSubmitAuthInfo(featheryClient))
      .catch((e: any) =>
        console.log('Auth failed. Possibly because your magic link expired.', e)
      );
  }
}

export function smsLogin({ fieldVal, featheryClient }: any) {
  const client = authState.client;
  if (!client || stytchPhoneMethodId === '') return Promise.resolve();

  return client.otps
    .authenticate(fieldVal, stytchPhoneMethodId, {
      session_duration_minutes: config.metadata.session_duration
    })
    .then(() => {
      stytchPhoneMethodId = '';
      return stytchSubmitAuthInfo(featheryClient);
    });
}

function stytchSubmitAuthInfo(featheryClient: any) {
  const stytchClient = authState.client;
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
  const opts = {
    session_duration_minutes: config.metadata.session_duration
  };
  let authFn;
  if (type === 'oauth') {
    authFn = () => authState.client.oauth.authenticate(token, opts);
  } else if (type === 'magic_links') {
    authFn = () => authState.client.magicLinks.authenticate(token, opts);
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
    if (!['feathery_1', 'feathery_2', '_slug'].includes(key))
      queryParams.delete(key);
  });
  const queryString =
    queryParams.has('feathery_1') || queryParams.has('_slug')
      ? `?${queryParams}`
      : '';
  return `${origin}${pathname}${queryString}${hash}`;
}
