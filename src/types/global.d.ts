/* eslint-disable no-var */
// need to use var for this to work - https://stackoverflow.com/a/69230938
declare global {
  var scriptjsLoadPromise: any;
  var webfontloaderPromise: any;
  var firebase: any;

  interface Window {
    firebaseRecaptchaVerifier: any;
    firebaseConfirmationResult: any;
  }
}

export {};
