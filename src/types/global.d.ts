/* eslint-disable no-var */
// need to use var for this to work - https://stackoverflow.com/a/69230938
declare global {
  var scriptjsLoadPromise: any;
  var webfontloaderPromise: any;
  var Persona: any;
  var firebase: any;
  var lottie: any;
  var libphonenumber: any;
  var Argyle: any;
  var Plaid: any;
  var Stytch: any;
  var alloy: any;
  var FeatheryInterface: any;

  interface Window {
    firebaseRecaptchaVerifier: any;
    firebaseConfirmationResult: any;
    firebasePhoneNumber: any;
    analytics: Array;
    heap: any;
    grecaptcha: any;
  }
}

export {};
