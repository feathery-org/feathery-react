import { StytchHeadlessClient } from '@stytch/vanilla-js/headless';
import { authState } from '../auth/LoginForm';
import { getRedirectUrl } from '../auth/internal/utils';
import { featheryDoc, getCookie, getStytchJwt } from '../utils/browser';

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
          stytchConfig.metadata.token
        );
        authState.setClient(initializedClient);
        resolve(initializedClient);
      }
    });
    return stytchPromise;
  }
}

export function stytchOauthRedirect(oauthType: string) {
  const stytchClient = authState.client;
  if (!stytchClient) return;

  const redirectUrl = getRedirectUrl();
  stytchClient.oauth[oauthType].start({
    login_redirect_url: redirectUrl,
    signup_redirect_url: redirectUrl
  });
}

export function stytchSendMagicLink({ fieldVal }: any) {
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

export function stytchSendSms({ fieldVal }: any) {
  const client = authState.client;
  if (!client) return;

  // need to add + in front, https://stytch.com/docs/api/log-in-or-create-user-by-sms
  return client.otps.sms.loginOrCreate(`+${fieldVal}`).then((resp: any) => {
    stytchPhoneMethodId = resp.method_id;
    return resp;
  });
}

// Login with query params from oauth redirect or magic link
export async function stytchLoginOnLoad(featheryClient: any) {
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
  if (stytchSession) {
    try {
      // [Hosted Login] We only need to validate if the session is valid for hosted forms, as
      // the session could have been revoked on a different subdomain
      if (!authState._featheryHosted)
        return stytchSubmitAuthInfo(featheryClient);

      await authState.client.session.authenticate();
      return stytchSubmitAuthInfo(featheryClient);
    } catch (e) {
      // [Hosted Login] If the session was revoked, we want to reset auth state
      authState.setAuthId('');
    }
  }
  // If there is no existing Stytch session & the stytch query params are
  // present, then attempt auth. If the Stytch query params exist, but a
  // session also exists, then we don't want to execute stytch auth again as
  // it will fail due to the token query param already being used
  else if (!stytchSession && validateStytchQueryParams({ token, type })) {
    const authFn = determineAuthFn({ token, type });

    // @ts-expect-error TS(2721): Cannot invoke an object which is possibly 'null'.
    return authFn()
      .then(() => stytchSubmitAuthInfo(featheryClient))
      .catch((e: any) => {
        authState.showError();
        console.warn(
          'Auth failed. Possibly because your magic link expired.',
          e
        );
      });
  }
}

export function stytchVerifySms({
  fieldVal,
  featheryClient
}: any): Promise<any> {
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

function _getDomain() {
  const domainParts = window.location.hostname.split('.');
  return domainParts.length === 1
    ? 'localhost'
    : domainParts[domainParts.length - 2] +
        '.' +
        domainParts[domainParts.length - 1];
}

/**
 * [Hosted Login] This fn will set the Stytch cookie on the primary site domain.
 * For example, if a form is hosted at login.feathery.io the default Stytch
 * cookie will be set to login.feathery.io, so we set the same values for the
 * domain feathery.io, so that subdomains can be authenticated
 */
export function setStytchDomainCookie() {
  const domain = _getDomain();
  const commonCookieOptions = `; Domain=${domain}; Path=/; Max-Age=86400; SameSite=Lax; Secure`;
  featheryDoc().cookie = `stytch_session_jwt=${getStytchJwt()}${commonCookieOptions}`;
  featheryDoc().cookie = `stytch_session=${getCookie(
    'stytch_session'
  )}${commonCookieOptions}`;
}

/**
 * [Hosted Login] This fn will clear the cookies set by setStytchDomainCookie.
 * This is needed if the session was revoked on another domain.
 */
export function clearStytchDomainCookie() {
  const domain = _getDomain();
  featheryDoc().cookie = `stytch_session_jwt=; Max-Age=-1; Domain=${domain}`;
  featheryDoc().cookie = `stytch_session=; Max-Age=-1; Domain=${domain}`;
}

function stytchSubmitAuthInfo(featheryClient: any): Promise<any> {
  const stytchClient = authState.client;
  const user = stytchClient.user.getSync();
  if (!user) return Promise.resolve();

  removeStytchQueryParams();
  return featheryClient
    .submitAuthInfo({
      authId: stytchClient.session.getSync()?.user_id,
      authData: {
        email: user.emails[0]?.email ?? '',
        // Slice off the + from the phone number
        phone: user.phone_numbers[0]?.phone_number.slice(1) ?? '',
        first_name: user.name.first_name,
        last_name: user.name.last_name
      },
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

export function removeStytchQueryParams() {
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
