import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import Client from './client';
import * as errors from './error';
import { dataURLToFile, isBase64Image } from './image';
import { runningInClient, featheryDoc } from './browser';
import { remountAllForms, rerenderAllForms } from './formHelperFunctions';

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
  userId?: string;
  preloadForms?: string[];
  userTracking?: 'cookie' | 'fingerprint';
  language?: string;
} & DeprecatedOptions;

type InitState = {
  initialized: boolean;
  sdkKey: string;
  preloadForms: { [formName: string]: any };
  formSessions: { [formName: string]: any };
  fieldValuesInitialized: boolean;
  redirectCallbacks: Record<string, any>;
  renderCallbacks: Record<string, Record<string, any>>;
  remountCallbacks: Record<string, any>;
  defaultErrors: Record<string, string>;
} & Omit<InitOptions, keyof DeprecatedOptions>;

let initFormsPromise: Promise<void> = Promise.resolve();
export const defaultClient = new Client();
const initState: InitState = {
  initialized: false,
  userTracking: 'cookie',
  sdkKey: '',
  userId: '',
  language: '',
  preloadForms: [],
  formSessions: {},
  defaultErrors: {},
  // Since all field values are fetched with each session, only fetch field
  // values on the first session request
  fieldValuesInitialized: false,
  redirectCallbacks: {},
  renderCallbacks: {},
  remountCallbacks: {}
};
const optionsAsInitState: (keyof InitOptions & keyof InitState)[] = [
  'userId',
  'userTracking'
];
let fieldValues: FieldValues = {};
let filePathMap: Record<string, null | string | (string | null)[]> = {};

function init(sdkKey: string, options: InitOptions = {}): Promise<string> {
  if (!sdkKey || typeof sdkKey !== 'string') {
    console.log('sdkKey', sdkKey);
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

  if (initState.initialized) return Promise.resolve(initState.userId ?? ''); // can only be initialized one time per load
  initState.initialized = true;

  initState.sdkKey = sdkKey;
  optionsAsInitState.forEach((key) => {
    // @ts-expect-error Type 'string | string[] | undefined' is not assignable to type...
    if (options[key]) initState[key] = options[key];
  });
  if (options.language) {
    const langPieces = options.language.split(',');
    initState.language = langPieces
      .map((piece) => piece.trim().slice(0, 2))
      .join(',');
  }

  // NextJS support
  if (runningInClient()) {
    // Dynamically load libraries that must be client side
    global.scriptjsLoadPromise = import('scriptjs');
    global.webfontloaderPromise = import('webfontloader');

    // FingerprintJS.load cannot run server side
    if (!initState.userId) {
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
  }

  initFormsPromise = initFormsPromise.then(() =>
    _fetchFormData(initState.preloadForms)
  );
  return initFormsPromise.then(() => initState.userId ?? '');
}

// must be called after userId loads
function _fetchFormData(formIds: string[]) {
  formIds.forEach((key) => {
    const formClient = new Client(key);
    formClient.fetchCacheForm().then((stepsResponse: any) => {
      initState.preloadForms[key] = stepsResponse;
    });
    formClient.fetchSession();
  });
}

function initInfo() {
  const { sdkKey } = initState;
  if (sdkKey === '') throw new errors.SDKKeyError('SDK key has not been set');
  return initState;
}

async function updateUserId(newUserId: string, merge = false): Promise<void> {
  if (merge) await defaultClient.updateUserId(newUserId, true);
  initState.userId = newUserId;
  if (initState.userTracking === 'cookie') {
    featheryDoc().cookie = `feathery-user-id-${initState.sdkKey}=${newUserId}; max-age=31536000; SameSite=strict`;
  }
  if (!merge) {
    fieldValues = {};
    filePathMap = {};
    initState.formSessions = {};
    initState.fieldValuesInitialized = false;
    remountAllForms();
  }
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

  if (rerender) rerenderAllForms();
}

export {
  init,
  initInfo,
  updateUserId,
  setValues,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap
};
