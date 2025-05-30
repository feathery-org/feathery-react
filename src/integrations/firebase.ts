import { dynamicImport } from './utils';
import { updateSessionValues } from '../utils/formHelperFunctions';
import { authState } from '../auth/LoginForm';
import { useEffect } from 'react';
import { featheryWindow, getCookie, setCookie } from '../utils/browser';

let firebasePromise: any = null;

export function installFirebase(firebaseConfig: any) {
  if (firebasePromise) return firebasePromise;
  else if (!firebaseConfig) return Promise.resolve();
  else {
    authState.authType = 'firebase';
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

export function firebaseLoginOnLoad(featheryClient: any): Promise<any> {
  return new Promise((resolve) => {
    const unsubscribe = authState.client
      .auth()
      .onAuthStateChanged(async (user: any) => {
        unsubscribe();

        try {
          if (isHrefFirebaseMagicLink()) {
            const authEmail = getCookie('featheryFirebaseEmail');
            if (authEmail) {
              const result = await authState.client
                .auth()
                .signInWithEmailLink(authEmail, featheryWindow().location.href);
              const magicLinkUser = result.user;
              const session = await featheryClient.submitAuthInfo({
                authId: magicLinkUser.uid,
                authData: {
                  email: magicLinkUser.email,
                  phone: magicLinkUser.phoneNumber,
                  first_name: magicLinkUser.displayName
                }
              });
              return resolve(session);
            }
          }

          if (user) {
            const session = await featheryClient.submitAuthInfo({
              authId: user.uid,
              authData: {
                email: user.email,
                phone: user.phoneNumber,
                first_name: user.displayName
              }
            });
            return resolve(session);
          }

          authState.setAuthId('');
          resolve(null);
        } catch (error) {
          authState.setAuthId('');
          resolve(null);
        }
      });
  });
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
      url: featheryWindow().location.href,
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
    .signInWithPhoneNumber(
      `+${fieldVal}`,
      featheryWindow().firebaseRecaptchaVerifier
    )
    .then((confirmationResult: any) => {
      authState.sentAuth = true;
      // SMS sent
      featheryWindow().firebaseConfirmationResult = confirmationResult;
      featheryWindow().firebasePhoneNumber = fieldVal;
      return {};
    })
    .catch((error: any) => {
      console.warn(error);
      // Error; SMS not sent. Reset Recaptcha
      featheryWindow()
        .firebaseRecaptchaVerifier.render()
        .then(function (widgetId: any) {
          // Reset reCaptcha
          // @ts-expect-error TS(2304): Cannot find name 'grecaptcha'.
          // eslint-disable-next-line no-undef
          grecaptcha.reset(widgetId);
        })
        .catch((e: any) => console.warn(e));
      return {
        errorMessage: error.message,
        errorField: servar
      };
    });
}

export async function firebaseVerifySms({ fieldVal, featheryClient }: any) {
  const fcr = featheryWindow().firebaseConfirmationResult;
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

export async function firebaseSignInPopup(
  oauthType: keyof typeof OAUTH_PROVIDER_MAP,
  featheryClient: any
) {
  const firebaseClient = authState.client;
  if (!firebaseClient) return;

  const providerInfo = OAUTH_PROVIDER_MAP[oauthType];
  if (!providerInfo) return;

  return firebaseClient
    .auth()
    .setPersistence(firebaseClient.auth.Auth.Persistence.LOCAL)
    .then(() => {
      const Provider = firebaseClient.auth[providerInfo.provider];
      const instance = providerInfo.id
        ? new Provider(providerInfo.id)
        : new Provider();

      return firebaseClient.auth().signInWithPopup(instance);
    })
    .then((result: any) => {
      const user = result.user;
      return featheryClient.submitAuthInfo({
        authId: user.uid,
        authData: {
          email: user.email,
          phone: user.phoneNumber,
          first_name: user.displayName
        }
      });
    })
    .then(() => {
      return { result: true };
    })
    .catch(() => {
      return { result: false };
    });
}

export function isHrefFirebaseMagicLink(): boolean {
  if (!authState.client?.auth) return false;
  return authState.client
    .auth()
    .isSignInWithEmailLink(featheryWindow().location.href);
}

export function useFirebaseRecaptcha(step: any) {
  // Once step has been set, load captcha verifier if using firebase
  useEffect(() => {
    if (
      !step ||
      !global.firebase ||
      // Firebase could be from client's own Firebase instance
      // without auth installed
      !authState.client?.auth ||
      featheryWindow().firebaseRecaptchaVerifier
    )
      return;

    const verifier = new authState.client.auth.RecaptchaVerifier(
      'featheryRecaptcha',
      {
        size: 'invisible'
      }
    );
    featheryWindow().firebaseRecaptchaVerifier =
      authState.client.auth && verifier;
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
