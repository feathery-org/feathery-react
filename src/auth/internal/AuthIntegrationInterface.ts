import { authState } from '../LoginForm';
import {
  firebaseLoginOnLoad,
  isHrefFirebaseMagicLink,
  firebaseSendMagicLink,
  firebaseSendSms,
  firebaseVerifySms,
  firebaseOauthRedirect
} from '../../integrations/firebase';
import {
  stytchLoginOnLoad,
  stytchOauthRedirect,
  stytchSendMagicLink,
  stytchSendSms,
  stytchVerifySms,
  setStytchDomainCookie
} from '../../integrations/stytch';
import Client from '../../utils/client';
import { isAuthStytch } from './utils';
import { featheryWindow, getCookie, getStytchJwt } from '../../utils/browser';
import { defaultClient } from '../../utils/init';

// All code that needs to do something different based on the auth integration should go in this file

let nativeOtpTimeSent = 0;

function isHrefMagicLink(): boolean {
  return (
    featheryWindow().location.search.includes('stytch_token_type') ||
    isHrefFirebaseMagicLink()
  );
}

function inferLoginOnLoad(featheryClient: Client) {
  const queryParams = new URLSearchParams(featheryWindow().location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (isAuthStytch() || (type && token))
    return stytchLoginOnLoad(featheryClient);
  else return firebaseLoginOnLoad(featheryClient);
}

function isThereAnExistingSession(): boolean {
  return !!(getStytchJwt() || getCookie('featheryFirebaseRedirect'));
}

async function inferAuthLogout() {
  if (!authState.client) return;

  if (isAuthStytch()) {
    await authState.client.session.revoke();
  } else if (global.firebase) {
    await authState.client.auth().signOut();
  }

  authState.onLogout();
  authState.setAuthId('');
}

function sendSms(phoneNum: string, featheryClient: any) {
  if (authState.authType === 'stytch')
    return stytchSendSms({ fieldVal: phoneNum });
  else if (authState.authType === 'firebase')
    return firebaseSendSms({ fieldVal: phoneNum, servar: null });
  else {
    if (!nativeOtpTimeSent) nativeOtpTimeSent = Date.now();
    else {
      const timeDiff = Date.now() - nativeOtpTimeSent;
      if (timeDiff < 60000) {
        const roundedSeconds = Math.round((60000 - timeDiff) / 1000);
        throw new Error(
          `Please wait ${roundedSeconds} seconds before sending another SMS.`
        );
      }
    }
    return featheryClient.sendSMSOTP(phoneNum);
  }
}

function verifySms(params: {
  fieldVal: string;
  featheryClient: any;
}): Promise<any> {
  if (authState.authType === 'stytch') return stytchVerifySms(params);
  else if (authState.authType === 'firebase') return firebaseVerifySms(params);
  else return params.featheryClient.verifySMSOTP(params.fieldVal);
}

function sendMagicLink(email: string) {
  if (authState.authType === 'stytch')
    return stytchSendMagicLink({ fieldVal: email });
  else if (authState.authType === 'firebase')
    return firebaseSendMagicLink({
      fieldVal: email,
      servar: null
    });
}

function oauthRedirect(oauthType: string) {
  if (isAuthStytch()) stytchOauthRedirect(oauthType);
  else firebaseOauthRedirect(oauthType as any);
}

function initializeAuthClientListeners() {
  if (!authState.client) return;

  if (isAuthStytch()) {
    if (getStytchJwt() && authState._featheryHosted) setStytchDomainCookie();

    const unsubSession = authState.client.session.onChange(
      (newSession: any) => {
        if (newSession) {
          // [Hosted Login] When logging in via re-direct we need to set the authId once the user object has initialized
          defaultClient.submitAuthInfo({ authId: newSession.user_id });
          // [Hosted Login] Once the stytch user has initialized, we need to set the cookie to enable multi-domain SSO
          if (authState._featheryHosted) setStytchDomainCookie();
        } else {
          authState.setAuthId('');
        }
      }
    );
    featheryWindow().addEventListener('beforeunload', () => {
      unsubSession && unsubSession();
    });
  } else if (global.firebase) {
    const unsubSession = authState.client
      .auth()
      .onAuthStateChanged((user: any) => !user && authState.setAuthId(''));
    featheryWindow().addEventListener('beforeunload', () => {
      unsubSession && unsubSession();
    });
  }
}

/**
 * This function fires when the idle timer goes off. It either extends the auth
 * session or performs logout actions
 */
function idleTimerAction(hasAuthed: boolean, logoutActions: () => void) {
  // No block for firebase because extending the session manually requires issuing a token from the BE

  if (isAuthStytch() && authState.client.session.getSync()) {
    authState.client.session.authenticate({
      session_duration_minutes: 1440
    });
  } else if (hasAuthed) {
    // There is no session, so need to revoke it
    logoutActions();
  }
}

export default {
  isHrefMagicLink,
  inferLoginOnLoad,
  isThereAnExistingSession,
  inferAuthLogout,
  sendSms,
  verifySms,
  sendMagicLink,
  oauthRedirect,
  initializeAuthClientListeners,
  idleTimerAction
};
