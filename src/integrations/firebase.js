import { dynamicImport } from './utils';
import {
  emailPattern,
  phonePattern,
  updateSessionValues
} from '../utils/formHelperFunctions';

let firebasePromise = null;

export function installFirebase(firebaseConfig) {
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

export function emailLogin(clientArg) {
  if (global.firebase.auth().isSignInWithEmailLink(window.location.href)) {
    const authEmail = window.localStorage.getItem('featheryFirebaseEmail');
    if (authEmail) {
      return global.firebase
        .auth()
        .signInWithEmailLink(authEmail, window.location.href)
        .then(async (result) => {
          return await clientArg
            .submitAuthInfo({
              authId: result.user.uid,
              authEmail
            })
            .then((session) => {
              return session;
            });
        });
    }
  }
}

export async function sendLoginCode(fieldVal, servar, methods = null) {
  methods = methods || servar.metadata.login_methods;
  if (methods.includes('phone') && phonePattern.test(fieldVal)) {
    return await global.firebase
      .auth()
      .signInWithPhoneNumber(`+1${fieldVal}`, window.firebaseRecaptchaVerifier)
      .then((confirmationResult) => {
        // SMS sent
        window.firebaseConfirmationResult = confirmationResult;
        window.firebasePhoneNumber = fieldVal;
        return {};
      })
      .catch((error) => {
        console.log(error);
        // Error; SMS not sent. Reset Recaptcha
        window.firebaseRecaptchaVerifier
          .render()
          .then(function (widgetId) {
            // Reset reCaptcha
            // eslint-disable-next-line no-undef
            grecaptcha.reset(widgetId);
          })
          .catch((e) => console.log(e));
        return {
          errorMessage: error.message,
          errorField: servar
        };
      });
  } else if (methods.includes('email') && emailPattern.test(fieldVal)) {
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
      .catch((error) => {
        return {
          errorMessage: error.message,
          errorField: servar
        };
      });
  } else {
    return {
      errorMessage: 'Invalid login',
      errorField: servar
    };
  }
}

export async function verifySMSCode(fieldVal, servar, client) {
  const fcr = window.firebaseConfirmationResult;
  if (fcr) {
    return await fcr
      .confirm(fieldVal)
      .then(async (result) => {
        // User signed in successfully.
        return await client
          .submitAuthInfo({
            authId: result.user.uid,
            authPhone: window.firebasePhoneNumber
          })
          .then((session) => {
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
