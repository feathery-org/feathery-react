import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import Client from './client';
import * as errors from './error';
import { dataURLToFile, isBase64Image } from './image';
import { runningInClient, featheryDoc } from './browser';
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

// TODO: remove these deprecated options
type DeprecatedOptions = {
  formKeys?: string[];
  forms?: string[];
  userKey?: string;
  tracking?: 'cookie' | 'fingerprint';
};

type InitOptions = {
  authClient?: any;
  userId?: string;
  preloadForms?: string[];
  userTracking?: 'cookie' | 'fingerprint';
  authId?: string;
  authEmail?: string;
  authPhoneNumber?: string;
} & DeprecatedOptions;

type InitState = {
  initialized: boolean;
  sdkKey: string;
  preloadForms: { [formName: string]: any };
  sessions: { [formName: string]: any };
  fieldValuesInitialized: boolean;
  validateCallbacks: { [cbKey: string]: any };
  renderCallbacks: { [cbKey: string]: any };
} & Omit<InitOptions, keyof DeprecatedOptions>;

let initFormsPromise: Promise<void> = Promise.resolve();
const defaultClient = new Client();
const initState: InitState = {
  initialized: false,
  userTracking: 'cookie',
  sdkKey: '',
  userId: '',
  authClient: null,
  authId: '',
  authEmail: '',
  authPhoneNumber: '',
  preloadForms: [],
  sessions: {},
  // Since all field values are fetched with each session, only fetch field
  // values on the first session request
  fieldValuesInitialized: false,
  validateCallbacks: {},
  renderCallbacks: {}
};
const optionsAsInitState: (keyof InitOptions & keyof InitState)[] = [
  'authClient',
  'authId',
  'authEmail',
  'authPhoneNumber',
  'userId',
  'userTracking'
];
const fieldValues: FieldValues = {};
const filePathMap = {};

function init(sdkKey: string, options: InitOptions = {}): Promise<void> {
  if (!sdkKey || typeof sdkKey !== 'string') {
    throw new errors.SDKKeyError();
  }

  if (options.tracking) options.userTracking = options.tracking;
  if (options.userKey) options.userId = options.userKey;
  options.preloadForms =
    options.preloadForms ?? options.forms ?? options.formKeys ?? [];

  // If client attempts to set userId but it's not yet valid, don't initialize
  // until it becomes valid
  if (
    options.userId !== undefined &&
    (!options.userId || typeof options.userId !== 'string')
  ) {
    throw new errors.UserIdError();
  }

  if (initState.initialized) return Promise.resolve(); // can only be initialized one time per load
  initState.initialized = true;

  initState.sdkKey = sdkKey;
  optionsAsInitState.forEach((key) => {
    if (options[key]) initState[key] = options[key];
  });

  // dynamically load libraries that must be client side only for NextJs support
  if (runningInClient()) {
    global.scriptjsLoadPromise = import('scriptjs');
    global.webfontloaderPromise = import('webfontloader');
  }

  // NextJS support - FingerprintJS.load cannot run server side
  if (!initState.userId && runningInClient()) {
    if (initState.userTracking === 'fingerprint') {
      initFormsPromise = FingerprintJS.load()
        .then((fp: any) => fp.get())
        .then((result: any) => (initState.userId = result.visitorId));
    } else if (initState.userTracking === 'cookie') {
      featheryDoc()
        .cookie.split(/; */)
        .map((c: any) => {
          const [key, v] = c.split('=', 2);
          if (key === `feathery-user-id-${sdkKey}`) initState.userId = v;
        });
      if (!initState.userId) initState.userId = uuidv4();
      featheryDoc().cookie = `feathery-user-id-${sdkKey}=${initState.userId}; max-age=31536000; SameSite=strict`;
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
    _fetchFormData(initState.preloadForms)
  );
  return initFormsPromise;
}

// must be called after userId loads
function _fetchFormData(formIds: string[]) {
  formIds.forEach((key) => {
    const formClient = new Client(key);
    formClient.fetchCacheForm().then((stepsResponse: any) => {
      initState.preloadForms[key] = stepsResponse;
    });
    formClient
      .fetchSession()
      .then(([session]: any) => (initState.sessions[key] = session));
  });
}

function initInfo() {
  const { sdkKey } = initState;
  if (sdkKey === '') throw new errors.SDKKeyError('SDK key has not been set');
  return initState;
}

function updateUserId(newUserId: string, merge = false): void {
  defaultClient.updateUserId(newUserId, merge).then(() => {
    initState.userId = newUserId;
    if (initState.userTracking === 'cookie') {
      featheryDoc().cookie = `feathery-user-id=${newUserId}; max-age=31536000; SameSite=strict`;
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
function setValues(userVals: FieldValues, rerender = true): void {
  const result: FieldValues = {};
  Object.entries(userVals).forEach(([key, value]) => {
    if (Array.isArray(value))
      // @ts-expect-error TS(2322): Type 'FeatheryFieldTypes[]' is not assignable to t... Remove this comment to see the full error message
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
  updateUserId,
  setValues,
  validateStep,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap,
  getAuthClient,
  setAuthClient
};
