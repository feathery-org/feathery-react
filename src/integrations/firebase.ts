import { dynamicImport } from './utils';
import { updateSessionValues } from '../utils/formHelperFunctions';

let firebasePromise: any = null;

export function installFirebase(firebaseConfig: any) {
  if (firebasePromise) return firebasePromise;
  else if (!firebaseConfig) return Promise.resolve();
  else {
    firebasePromise = new Promise((resolve) => {
      if (global.firebase) resolve(global.firebase);
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
          resolve(global.firebase);
        });
      }
    });
    return firebasePromise;
  }
}

export function emailLogin(featheryClient: any) {
  if (global.firebase?.auth().isSignInWithEmailLink(window.location.href)) {
    const authEmail = window.localStorage.getItem('featheryFirebaseEmail');
    if (authEmail) {
      return global.firebase
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
    return await global.firebase
      .auth()
      .signInWithPhoneNumber(`+1${fieldVal}`, window.firebaseRecaptchaVerifier)
      .then((confirmationResult: any) => {
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
    return await global.firebase
      .auth()
      .sendSignInLinkToEmail(fieldVal, {
        url: window.location.href,
        handleCodeInApp: true
      })
      .then(() => {
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

export async function verifySMSCode({ fieldVal, servar, featheryClient }: any) {
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
        return {
          errorMessage: 'Invalid code',
          errorField: servar
        };
      });
  } else {
    return {
      errorMessage: 'Please refresh and try again',
      errorField: servar
    };
  }
}
