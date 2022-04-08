import Client from './client';

import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import * as errors from './error';
import { emailLogin, installFirebase } from '../integrations/firebase';
import { installPlaid } from '../integrations/plaid';
import { initializeTagManager } from '../integrations/googleTagManager';
import { dataURLToFile, isBase64PNG } from './image';

const fpPromise = FingerprintJS.load();
let initFormsPromise = Promise.resolve();
const defaultClient = new Client();
const defaultOptions = {
  userKey: null,
  formKeys: [],
  tracking: 'cookie'
};
const initState = {
  initialized: false,
  tracking: '',
  apiKey: '',
  userKey: '',
  authId: '',
  authToken: '',
  authEmail: '',
  authPhoneNumber: '',
  forms: {},
  sessions: {},
  fieldValuesInitialized: false,
  validateCallbacks: {}
};
const fieldValues = {};
const filePathMap = {};

function init(apiKey, options = {}) {
  options = { ...defaultOptions, ...options };

  if (initState.initialized) return; // can only be initialized one time per load
  initState.initialized = true;

  if (!apiKey || typeof apiKey !== 'string') {
    throw new errors.APIKeyError('Invalid API Key');
  }
  if (options.userKey && typeof options.userKey !== 'string') {
    throw new errors.UserKeyError();
  }

  initState.apiKey = apiKey;
  [
    'authId',
    'authToken',
    'authEmail',
    'authPhoneNumber',
    'userKey',
    'tracking'
  ].forEach((key) => {
    if (options[key]) initState[key] = options[key];
  });

  if (!initState.userKey) {
    if (options.tracking === 'fingerprint') {
      initFormsPromise = fpPromise
        .then((fp) => fp.get())
        .then((result) => (initState.userKey = result.visitorId));
    } else if (options.tracking === 'cookie') {
      document.cookie.split(/; */).map((c) => {
        const [key, v] = c.split('=', 2);
        if (key === `feathery-user-id-${apiKey}`) initState.userKey = v;
      });
      if (!initState.userKey) initState.userKey = uuidv4();
      document.cookie = `feathery-user-id-${apiKey}=${initState.userKey}; max-age=31536000; SameSite=strict`;
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
  initFormsPromise = initFormsPromise.then(() =>
    _fetchFormData(options.formKeys)
  );
  return initFormsPromise;
}

const initializeIntegrations = async (
  integrations,
  clientArg,
  init = false
) => {
  const gtm = integrations['google-tag-manager'];
  const fb = integrations.firebase;
  const plaid = integrations.plaid;

  const [, firebase] = await Promise.all([
    installPlaid(!!plaid),
    installFirebase(fb)
  ]);

  if (gtm) initializeTagManager(gtm);
  if (fb && !init) emailLogin(fb, firebase, clientArg);
};

// must be called after userKey loads
function _fetchFormData(formKeys) {
  return Promise.all(
    formKeys.map((key) => {
      const formClient = new Client(key);
      return Promise.all([
        formClient.fetchForm().then((stepsResponse) => {
          initState.forms[key] = stepsResponse;
        }),
        formClient.fetchSession().then(async (session) => {
          initState.sessions[key] = session;
          await initializeIntegrations(session.integrations, formClient, true);
        })
      ]);
    })
  );
}

function initInfo() {
  const { apiKey } = initState;
  if (apiKey === '') throw new errors.APIKeyError('API key has not been set');
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
  if (isBase64PNG(val)) val = dataURLToFile(val, `${key}.png`);
  // If the value is a file type, convert the file or files (if repeated) to Promises
  return val instanceof File ? Promise.resolve(val) : val;
}

/**
 * If customers provide files through setValues
 * we need to explicitly convert any files to file Promises
 * since they may not have done so
 */
function setValues(userVals) {
  const result = {};
  Object.entries(userVals).forEach(([key, value]) => {
    if (Array.isArray(value))
      result[key] = value.map((entry) => _parseUserVal(entry, key));
    else result[key] = _parseUserVal(value, key);
  });

  Object.assign(fieldValues, result);
  defaultClient.submitCustom(result);
}

function validateStep(formKey, trigger = true) {
  const callback = initState.validateCallbacks[formKey];
  if (!callback) return;
  return callback(trigger);
}

export {
  init,
  initInfo,
  initializeIntegrations,
  updateUserKey,
  setValues,
  validateStep,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap
};
