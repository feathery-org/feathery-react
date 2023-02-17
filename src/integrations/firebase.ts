import { dynamicImport } from './utils';
import { updateSessionValues } from '../utils/formHelperFunctions';
import { authState } from '../auth/LoginForm';
import { useEffect } from 'react';
import { shouldElementHide } from '../utils/hideIfs';
import { ACTION_SEND_SMS } from '../utils/elementActions';

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

export function emailLogin(featheryClient: any) {
  if (isHrefFirebaseMagicLink()) {
    const authEmail = window.localStorage.getItem('featheryFirebaseEmail');
    if (authEmail) {
      return authState.client
        .auth()
        .signInWithEmailLink(authEmail, window.location.href)
        .then((result: any) => {
          return featheryClient
            .submitAuthInfo({
              authId: result.user.uid,
              authEmail
            })
            .then((session: any) => {
              return session;
            });
        });
    }
  }
}

export async function sendFirebaseLogin({
  fieldVal,
  servar,
  method
}: {
  fieldVal: string;
  servar: any;
  method: 'phone' | 'email';
}) {
  if (method === 'phone') {
    return await authState.client
      .auth()
      .signInWithPhoneNumber(`+1${fieldVal}`, window.firebaseRecaptchaVerifier)
      .then((confirmationResult: any) => {
        authState.sentAuth = true;
        // SMS sent
        window.firebaseConfirmationResult = confirmationResult;
        (window as any).firebasePhoneNumber = fieldVal;
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
  } else {
    return await authState.client
      .auth()
      .sendSignInLinkToEmail(fieldVal, {
        url: window.location.href,
        handleCodeInApp: true
      })
      .then(() => {
        authState.sentAuth = true;
        window.localStorage.setItem('featheryFirebaseEmail', fieldVal);
        return {};
      })
      .catch((error: any) => {
        return {
          errorMessage: error.message,
          errorField: servar
        };
      });
  }
}

export async function verifySMSCode({ fieldVal, featheryClient }: any) {
  const fcr = window.firebaseConfirmationResult;
  if (fcr) {
    return await fcr
      .confirm(fieldVal)
      .then(async (result: any) => {
        // User signed in successfully.
        return await featheryClient
          .submitAuthInfo({
            authId: result.user.uid,
            authPhone: (window as any).firebasePhoneNumber
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

export function useFirebaseRecaptcha(activeStep: any) {
  // Logic to run on each step once firebase is loaded
  useEffect(() => {
    if (!activeStep || !global.firebase) return;

    const renderedButtons = activeStep.buttons.filter(
      (element: any) =>
        !shouldElementHide({
          element: element
        })
    );
    const smsButton = renderedButtons.find((b: any) =>
      b.properties.actions.some(
        (action: any) => action.type === ACTION_SEND_SMS
      )
    );

    if (smsButton) {
      window.firebaseRecaptchaVerifier =
        authState.client.auth &&
        new (authState.client.auth().RecaptchaVerifier)(smsButton.id, {
          size: 'invisible'
        });
    }
  }, [activeStep?.id]);
}
