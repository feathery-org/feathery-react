import { authState } from '../LoginForm';
import {
  firebaseLoginOnLoad,
  isHrefFirebaseMagicLink,
  firebaseSendMagicLink,
  firebaseSendSms,
  firebaseVerifySms,
  firebaseSignInPopup,
  getCurrentSession
} from '../../integrations/firebase';
import FeatheryClient from '../../utils/featheryClient';
import { featheryWindow, getCookie } from '../../utils/browser';
import { initState } from '../../utils/init';

// All code that needs to do something different based on the auth integration should go in this file

let nativeOtpCount = 0;
let nativeOtpTimeSent = 0;

function isHrefMagicLink(): boolean {
  return isHrefFirebaseMagicLink();
}

function inferLoginOnLoad(featheryClient: FeatheryClient) {
  if (authState.authType === 'firebase')
    return firebaseLoginOnLoad(featheryClient);
}

function isThereAnExistingSession(): boolean {
  return !!getCookie('featheryFirebaseRedirect');
}

async function inferAuthLogout() {
  if (!authState.client) return;

  if (global.firebase) await authState.client.auth().signOut();

  authState.onLogout();
  authState.setAuthId('');
}

function sendSms(phoneNum: string, featheryClient: any) {
  if (authState.authType === 'firebase')
    return firebaseSendSms({ fieldVal: phoneNum, servar: null });
  else {
    if (nativeOtpCount < 10) nativeOtpCount++;
    else {
      const timeDiff = Date.now() - nativeOtpTimeSent;
      if (timeDiff < 30000) {
        const roundedSeconds = Math.round((30000 - timeDiff) / 1000);
        const err = initState.defaultErrors.sms_wait.replace(
          '{time}',
          roundedSeconds.toString()
        );
        throw new Error(err);
      }
    }
    nativeOtpTimeSent = Date.now();
    return featheryClient.sendSMSMessage(phoneNum);
  }
}

function verifySMSOTP(params: {
  fieldVal: string;
  featheryClient: any;
}): Promise<any> {
  if (authState.authType === 'firebase') return firebaseVerifySms(params);
  else return params.featheryClient.verifyOTP(params.fieldVal, 'sms-otp');
}

function sendMagicLink(email: string) {
  if (authState.authType === 'firebase')
    return firebaseSendMagicLink({
      fieldVal: email,
      servar: null
    });
}

function oauthRedirect(oauthType: string, client?: any) {
  return firebaseSignInPopup(oauthType as any, client);
}

function initializeAuthClientListeners() {
  if (!authState.client) return;

  if (global.firebase) {
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
async function idleTimerAction(hasAuthed: boolean, logoutActions: () => void) {
  if (global.firebase && (await getCurrentSession())) {
    // firebase session is active, no action needed.
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
  verifySMSOTP,
  sendMagicLink,
  oauthRedirect,
  initializeAuthClientListeners,
  idleTimerAction
};
