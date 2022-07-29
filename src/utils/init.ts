import global from '../global';
import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import Client from './client';
import * as errors from './error';
import { dataURLToFile, isBase64Image } from './image';
import { runningInClient } from './browser.js';
import { inferEmailLoginFromURL } from '../integrations/utils';

export type FeatheryFieldTypes =
  | null
  | boolean
  | string
  | string[]
  | number
  | number[]
  | Promise<File>
  | Promise<File>[];

export type FieldValues = {
  [fieldKey: string]: FeatheryFieldTypes;
};

type InitOptions = {
  authClient?: any;
  userKey?: null | string;
  forms?: string[];
  tracking?: 'cookie' | 'fingerprint' | '';
  authId?: string;
  authEmail?: string;
  authPhoneNumber?: string;
};

type DeprecatedInitOptions = {
  formKeys?: string[];
};

type InitState = {
  initialized: boolean;
  sdkKey: string;
  forms: { [formName: string]: any };
  sessions: { [formName: string]: any };
  fieldValuesInitialized: boolean;
  validateCallbacks: any;
  renderCallbacks: any;
} & Omit<InitOptions, 'forms'>;

let initFormsPromise: Promise<void> = Promise.resolve();
const defaultClient = new Client();
const defaultOptions: InitOptions = {
  authClient: null,
  userKey: null,
  tracking: 'cookie'
};
const initState: InitState = {
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
const fieldValues: FieldValues = {};
const filePathMap = {};

// TODO(ts) type form options
function init(sdkKey: string, options: InitOptions = {}) {
  options = { ...defaultOptions, ...options };
  // TODO: deprecate legacy formKeys option
  options.forms =
    (options as DeprecatedInitOptions).formKeys ?? options.forms ?? [];

  if (initState.initialized) return; // can only be initialized one time per load
  initState.initialized = true;

  if (!sdkKey || typeof sdkKey !== 'string') {
    throw new errors.SDKKeyError('Invalid SDK Key');
  }
  if (options.userKey && typeof options.userKey !== 'string') {
    throw new errors.UserKeyError();
  }

  initState.sdkKey = sdkKey;
  [
    'authClient',
    'authId',
    'authEmail',
    'authPhoneNumber',
    'userKey',
    'tracking'
  ].forEach((key) => {
    if (options[key as keyof InitOptions])
      // @ts-expect-error TODO(ts) - we need to improve the typings here
      initState[key as keyof InitState] = options[key as keyof InitOptions];
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
        .then((fp: any) => fp.get())
        .then((result: any) => (initState.userKey = result.visitorId));
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
  initFormsPromise = initFormsPromise.then(() => {
    _fetchFormData(options.forms ?? []);
  });
  return initFormsPromise;
}

// must be called after userKey loads
function _fetchFormData(formKeys: string[]) {
  return Promise.all(
    formKeys.map((key) => {
      const formClient = new Client(key);
      return Promise.all([
        formClient.fetchCacheForm().then((stepsResponse: any) => {
          initState.forms[key] = stepsResponse;
        }),
        formClient
          .fetchSession()
          .then(([session]: any) => (initState.sessions[key] = session))
      ]);
    })
  );
}

function initInfo() {
  const { sdkKey } = initState;
  if (sdkKey === '') throw new errors.SDKKeyError('SDK key has not been set');
  return initState;
}

function updateUserKey(newUserKey: string, merge = false) {
  defaultClient.updateUserKey(newUserKey, merge).then(() => {
    initState.userKey = newUserKey;
    if (initState.tracking === 'cookie') {
      document.cookie = `feathery-user-id=${newUserKey}; max-age=31536000; SameSite=strict`;
    }
  });
}

function _parseUserVal(userVal: FeatheryFieldTypes, key: string) {
  // TODO(ts): Should we make an internal vs external FeatheryFieldTypes? or just | File like this?
  let val: FeatheryFieldTypes | File = userVal;
  if (isBase64Image(val)) val = dataURLToFile(val, `${key}.png`);
  // If the value is a file type, convert the file or files (if repeated) to Promises
  return val instanceof File ? Promise.resolve(val) : val;
}

/**
 * If customers provide files through setValues
 * we need to explicitly convert any files to file Promises
 * since they may not have done so
 */
function setValues(userVals: FieldValues, rerender = true) {
  const result: FieldValues = {};
  Object.entries(userVals).forEach(([key, value]) => {
    if (Array.isArray(value))
      // @ts-expect-error TODO(ts) - we need to improve the typings here
      result[key] = value.map((entry) => _parseUserVal(entry, key));
    else result[key] = _parseUserVal(value, key);
  });

  Object.assign(fieldValues, result);
  defaultClient.submitCustom(result);

  if (rerender)
    Object.values(initState.renderCallbacks).forEach((cb: any) => cb());
}

function validateStep(
  formKey: string,
  trigger = true
): undefined | { [fieldKey: string]: string } {
  const callback = initState.validateCallbacks[formKey];
  if (!callback) return;
  return callback(trigger);
}

function setAuthClient(client: any): void {
  initState.authClient = client;
  // Attempt login after setting auth client, in case the auth client wasn't set
  // when auth was already attempted after initializing the integrations
  inferEmailLoginFromURL(defaultClient);
}

function getAuthClient(): any {
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
