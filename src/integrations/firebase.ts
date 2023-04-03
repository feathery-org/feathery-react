import { dynamicImport } from './utils';
import { updateSessionValues } from '../utils/formHelperFunctions';
import { authState } from '../auth/LoginForm';
import { useEffect } from 'react';
import { ACTION_SEND_SMS } from '../utils/elementActions';
import { deleteCookie, getCookie, setCookie } from '../utils/browser';
import { getVisibleElements } from '../utils/hideAndRepeats';

let firebasePromise: any = null;

export function installFirebase(firebaseConfig: any) {
  if (firebasePromise) return firebasePromise;
  else if (!firebaseConfig) return Promise.resolve();
  else {
    firebasePromise = new Promise((resolve) => {
      if (authState.client) resolve(authState.client);
      else {
        // Bring in Firebase dependencies dynamically if this form uses Firebase
        return dynamicImport(
          [
            'https://www.gstatic.com/firebasejs/8.7.1/firebase-app.js',
            'https://www.gstatic.com/firebasejs/8.7.1/firebase-auth.js'
          ],
          false
        ).then(() => {
          global.firebase.initializeApp({
            apiKey: firebaseConfig.api_key,
            authDomain: `${firebaseConfig.metadata.project_id}.firebaseapp.com`,
            databaseURL: `https://${firebaseConfig.metadata.project_id}.firebaseio.com`,
            projectId: firebaseConfig.metadata.project_id,
            storageBucket: `${firebaseConfig.metadata.project_id}.appspot.com`,
            messagingSenderId: firebaseConfig.metadata.sender_id,
            appId: firebaseConfig.metadata.app_id
          });
          authState.setClient(global.firebase);
          resolve(authState.client);
        });
      }
    });
    return firebasePromise;
  }
}

export function firebaseLoginOnLoad(featheryClient: any) {
  if (isHrefFirebaseMagicLink()) {
    const authEmail = getCookie('featheryFirebaseEmail');
    if (authEmail) {
      return authState.client
        .auth()
        .signInWithEmailLink(authEmail, window.location.href)
        .then((result: any) => {
          const user = result.user;
          return featheryClient
            .submitAuthInfo({
              authId: user.uid,
              authData: {
                email: user.email,
                phone: user.phoneNumber,
                first_name: user.displayName
              }
            })
            .then((session: any) => session);
        });
    }
  } else {
    const oauthRedirect = getCookie('featheryFirebaseRedirect');
    if (oauthRedirect) {
      deleteCookie('featheryFirebaseRedirect');
      authState.client
        .auth()
        .getRedirectResult()
        .then((result: any) => {
          return featheryClient
            .submitAuthInfo({
              authId: result.user.uid,
              authEmail: result.user.email
            })
            .then((session: any) => session);
        });
    }
  }
}

export async function firebaseSendMagicLink({
  fieldVal,
  servar
}: {
  fieldVal: string;
  servar: any;
}) {
  return await authState.client
    .auth()
    .sendSignInLinkToEmail(fieldVal, {
      url: window.location.href,
      handleCodeInApp: true
    })
    .then(() => {
      authState.sentAuth = true;
      setCookie('featheryFirebaseEmail', fieldVal);
      return {};
    })
    .catch((error: any) => {
      return {
        errorMessage: error.message,
        errorField: servar
      };
    });
}

export async function firebaseSendSms({
  fieldVal,
  servar
}: {
  fieldVal: string;
  servar: any;
}) {
  return await authState.client
    .auth()
    .signInWithPhoneNumber(`+1${fieldVal}`, window.firebaseRecaptchaVerifier)
    .then((confirmationResult: any) => {
      authState.sentAuth = true;
      // SMS sent
      window.firebaseConfirmationResult = confirmationResult;
      window.firebasePhoneNumber = fieldVal;
      return {};
    })
    .catch((error: any) => {
      console.log(error);
      // Error; SMS not sent. Reset Recaptcha
      window.firebaseRecaptchaVerifier
        .render()
        .then(function (widgetId: any) {
          // Reset reCaptcha
          // @ts-expect-error TS(2304): Cannot find name 'grecaptcha'.
          // eslint-disable-next-line no-undef
          grecaptcha.reset(widgetId);
        })
        .catch((e: any) => console.log(e));
      return {
        errorMessage: error.message,
        errorField: servar
      };
    });
}

export async function firebaseVerifySms({ fieldVal, featheryClient }: any) {
  const fcr = window.firebaseConfirmationResult;
  if (fcr) {
    return await fcr
      .confirm(fieldVal)
      .then(async (result: any) => {
        const user = result.user;
        // User signed in successfully.
        return await featheryClient
          .submitAuthInfo({
            authId: user.uid,
            authData: {
              email: user.email,
              phone: user.phoneNumber,
              first_name: user.displayName
            }
          })
          .then((session: any) => {
            updateSessionValues(session);
            return { loggedIn: true };
          });
      })
      .catch(() => {
        // User couldn't sign in (bad verification code?)
        throw new Error('Invalid code');
      });
  } else {
    throw new Error('Please refresh and try again');
  }
}

export function isHrefFirebaseMagicLink(): boolean {
  if (!authState.client?.auth) return false;
  return authState.client.auth().isSignInWithEmailLink(window.location.href);
}

export function useFirebaseRecaptcha(step: any, visiblePositions: any) {
  // Logic to run on each step once firebase is loaded
  useEffect(() => {
    if (!step || !global.firebase) return;

    const smsButton = getVisibleElements(step, visiblePositions, [
      'buttons'
    ]).find(({ element }: any) =>
      element.properties.actions.some(
        (action: any) => action.type === ACTION_SEND_SMS
      )
    );

    if (smsButton) {
      window.firebaseRecaptchaVerifier =
        authState.client.auth &&
        new authState.client.auth.RecaptchaVerifier(smsButton.id, {
          size: 'invisible'
        });
    }
  }, [step?.id]);
}

const OAUTH_PROVIDER_MAP = {
  google: { provider: 'GoogleAuthProvider', id: '' },
  facebook: { provider: 'FacebookAuthProvider', id: '' },
  apple: { provider: 'OAuthProvider', id: 'apple.com' },
  twitter: { provider: 'TwitterAuthProvider', id: '' },
  github: { provider: 'GithubAuthProvider', id: '' },
  microsoft: { provider: 'OAuthProvider', id: 'microsoft.com' }
};

export function firebaseOauthRedirect(
  oauthType: keyof typeof OAUTH_PROVIDER_MAP
) {
  const firebaseClient = authState.client;
  if (!firebaseClient) return;

  const providerInfo = OAUTH_PROVIDER_MAP[oauthType];
  if (!providerInfo) return;

  setCookie('featheryFirebaseRedirect', 'true');
  const Provider = firebaseClient.auth[providerInfo.provider];
  const instance = providerInfo.id
    ? new Provider(providerInfo.id)
    : new Provider();
  firebaseClient.auth().signInWithRedirect(instance);
}
