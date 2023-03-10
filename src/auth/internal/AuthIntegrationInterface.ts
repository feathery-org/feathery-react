import { authState } from '../LoginForm';
import {
  firebaseLoginMagicLink,
  isHrefFirebaseMagicLink,
  firebaseSendMagicLink,
  firebaseSendSms,
  firebaseVerifySms
} from '../../integrations/firebase';
import {
  stytchUrlLogin,
  stytchGoogleOauthRedirect,
  stytchSendMagicLink,
  stytchSendSms,
  stytchVerifySms
} from '../../integrations/stytch';
import Client from '../../utils/client';
import { isAuthStytch } from './utils';
import { getStytchJwt } from '../../utils/browser';
import { defaultClient } from '../../utils/init';

// All code that needs to do something different based on the auth integration should go in this file

function isHrefMagicLink(): boolean {
  return (
    window.location.search.includes('stytch_token_type') ||
    isHrefFirebaseMagicLink()
  );
}

function inferLoginFromURL(featheryClient: Client) {
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (isAuthStytch() || (type && token)) return stytchUrlLogin(featheryClient);
  else return firebaseLoginMagicLink(featheryClient);
}

function isThereAnExistingSession(): boolean {
  return !!getStytchJwt();
}

async function inferAuthLogout() {
  if (!authState.client) return;

  if (isAuthStytch()) {
    await authState.client.session.revoke();
  } else if (global.firebase) {
    await authState.client.auth().signOut();
  }

  authState.onLogout();
  authState.authPhoneNumber = '';
  authState.authEmail = '';
  authState.setAuthId('');
}

function sendSms(phoneNum: string) {
  if (isAuthStytch()) stytchSendSms({ fieldVal: phoneNum });
  else
    firebaseSendSms({
      fieldVal: phoneNum,
      servar: null
    });
}

function verifySms(params: {
  fieldVal: string;
  featheryClient: any;
}): Promise<any> {
  return isAuthStytch() ? stytchVerifySms(params) : firebaseVerifySms(params);
}

function sendMagicLink(email: string) {
  if (isAuthStytch()) stytchSendMagicLink({ fieldVal: email });
  else
    firebaseSendMagicLink({
      fieldVal: email,
      servar: null
    });
}

function oauthRedirect() {
  stytchGoogleOauthRedirect();
}

function initializeAuthClientListeners() {
  if (getStytchJwt()) {
    // When logging in via re-direct we need to set the authId once the user object has initialized
    const unsubUser = authState.client.user.onChange((newUser: any) => {
      if (newUser) defaultClient.submitAuthInfo({ authId: newUser.user_id });
    });
    const unsubSession = authState.client.session.onChange(
      (newSession: any) => !newSession && authState.setAuthId('')
    );
    window.addEventListener('beforeunload', () => {
      unsubUser && unsubUser();
      unsubSession && unsubSession();
    });
  }
}

function idleTimerAction(hasAuthed: boolean, logoutActions: () => void) {
  if (!isAuthStytch()) return;

  if (authState.client.session.getSync()) {
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
  inferLoginFromURL,
  isThereAnExistingSession,
  inferAuthLogout,
  sendSms,
  verifySms,
  sendMagicLink,
  oauthRedirect,
  initializeAuthClientListeners,
  idleTimerAction
};
