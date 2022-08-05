import Client from './client';

import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import * as errors from './error';
import { dataURLToFile, isBase64Image } from './image';
import { runningInClient } from './browser.js';
import { inferEmailLoginFromURL } from '../integrations/utils';

let initFormsPromise = Promise.resolve();
const defaultClient = new Client();
const defaultOptions = {
  authClient: null,
  userKey: null,
  tracking: 'cookie'
};
const initState = {
  initialized: false,
  tracking: '',
  sdkKey: '',
  userKey: '',
  authId: '',
  authEmail: '',
  authPhoneNumber: '',
  forms: {},
  sessions: {},
  // Since all field values are fetched with each session, only fetch field
  // values on the first session request
  fieldValuesInitialized: false,
  validateCallbacks: {},
  renderCallbacks: {}
};
const fieldValues = {};
const filePathMap = {};

function init(sdkKey, options = {}) {
  if (!sdkKey || typeof sdkKey !== 'string') {
    throw new errors.SDKKeyError('Invalid SDK Key');
  }

  // If client attempts to set userKey but it's not yet valid, don't initialize
  // until it becomes valid
  if (
    options.userKey !== undefined &&
    (!options.userKey || typeof options.userKey !== 'string')
  ) {
    throw new errors.UserKeyError();
  }

  options = { ...defaultOptions, ...options };
  // TODO: deprecate legacy formKeys option
  options.forms = options.formKeys ?? options.forms ?? [];

  if (initState.initialized) return; // can only be initialized one time per load
  initState.initialized = true;

  initState.sdkKey = sdkKey;
  [
    'authClient',
    'authId',
    'authEmail',
    'authPhoneNumber',
    'userKey',
    'tracking'
  ].forEach((key) => {
    if (options[key]) initState[key] = options[key];
  });

  // dynamically load libraries that must be client side only for NextJs support
  if (runningInClient()) {
    global.scriptjsLoadPromise = import('scriptjs');
    global.webfontloaderPromise = import('webfontloader');
  }

  // NextJS support - FingerprintJS.load cannot run server side
  if (!initState.userKey && runningInClient()) {
    if (options.tracking === 'fingerprint') {
      initFormsPromise = FingerprintJS.load()
        .then((fp) => fp.get())
        .then((result) => (initState.userKey = result.visitorId));
    } else if (options.tracking === 'cookie') {
      document.cookie.split(/; */).map((c) => {
        const [key, v] = c.split('=', 2);
        if (key === `feathery-user-id-${sdkKey}`) initState.userKey = v;
      });
      if (!initState.userKey) initState.userKey = uuidv4();
      document.cookie = `feathery-user-id-${sdkKey}=${initState.userKey}; max-age=31536000; SameSite=strict`;
    }
  }
  if (initState.authId) {
    initFormsPromise = initFormsPromise.then(() =>
      defaultClient.submitAuthInfo({
        authId: initState.authId,
        authPhone: initState.authPhoneNumber,
        authEmail: initState.authEmail
      })
    );
  }
  initFormsPromise = initFormsPromise.then(() => _fetchFormData(options.forms));
  return initFormsPromise;
}

// must be called after userKey loads
function _fetchFormData(formKeys) {
  return Promise.all(
    formKeys.map((key) => {
      const formClient = new Client(key);
      return Promise.all([
        formClient.fetchCacheForm().then((stepsResponse) => {
          initState.forms[key] = stepsResponse;
        }),
        formClient
          .fetchSession()
          .then(([session]) => (initState.sessions[key] = session))
      ]);
    })
  );
}

function initInfo() {
  const { sdkKey } = initState;
  if (sdkKey === '') throw new errors.SDKKeyError('SDK key has not been set');
  return initState;
}

function updateUserKey(newUserKey, merge = false) {
  defaultClient.updateUserKey(newUserKey, merge).then(() => {
    initState.userKey = newUserKey;
    if (initState.tracking === 'cookie') {
      document.cookie = `feathery-user-id=${newUserKey}; max-age=31536000; SameSite=strict`;
    }
  });
}

function _parseUserVal(userVal, key) {
  let val = userVal;
  if (isBase64Image(val)) val = dataURLToFile(val, `${key}.png`);
  // If the value is a file type, convert the file or files (if repeated) to Promises
  return val instanceof File ? Promise.resolve(val) : val;
}

/**
 * If customers provide files through setValues
 * we need to explicitly convert any files to file Promises
 * since they may not have done so
 */
function setValues(userVals, rerender = true) {
  const result = {};
  Object.entries(userVals).forEach(([key, value]) => {
    if (Array.isArray(value))
      result[key] = value.map((entry) => _parseUserVal(entry, key));
    else result[key] = _parseUserVal(value, key);
  });

  Object.assign(fieldValues, result);
  defaultClient.submitCustom(result);

  if (rerender) Object.values(initState.renderCallbacks).forEach((cb) => cb());
}

function validateStep(formKey, trigger = true) {
  const callback = initState.validateCallbacks[formKey];
  if (!callback) return;
  return callback(trigger);
}

function setAuthClient(client) {
  initState.authClient = client;
  // Attempt login after setting auth client, in case the auth client wasn't set
  // when auth was already attempted after initializing the integrations
  inferEmailLoginFromURL(defaultClient);
}

function getAuthClient() {
  return initState.authClient;
}

export {
  init,
  initInfo,
  updateUserKey,
  setValues,
  validateStep,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap,
  getAuthClient,
  setAuthClient
};
