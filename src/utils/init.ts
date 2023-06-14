import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import Client, { updateRegionApiUrls } from './client';
import * as errors from './error';
import { dataURLToFile, isBase64Image } from './image';
import { runningInClient, setCookie, getCookie } from './browser';
import { remountAllForms, rerenderAllForms } from './formHelperFunctions';

export type FeatheryFieldTypes =
  | null
  | boolean
  | string
  | string[]
  | number
  | number[]
  | Promise<File>
  | Promise<File>[]
  | Record<string, any>;

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
  _enterpriseRegion?: string;
} & DeprecatedOptions;

type InitState = {
  initialized: boolean;
  sdkKey: string;
  overrideUserId: boolean;
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
  overrideUserId: false,
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
let fieldValues: FieldValues = {};
let filePathMap: Record<string, null | string | (string | null)[]> = {};

function init(sdkKey: string, options: InitOptions = {}): Promise<string> {
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

  if (initState.initialized) return Promise.resolve(initState.userId ?? ''); // can only be initialized one time per load
  initState.initialized = true;

  initState.sdkKey = sdkKey;
  updateRegionApiUrls(options._enterpriseRegion ?? '');

  if (options.userId) {
    initState.userId = options.userId;
    initState.overrideUserId = true;
  }
  if (options.userTracking) initState.userTracking = options.userTracking;
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

    // Client-side tracking logic
    if (initState.userTracking === 'cookie') {
      const cookieKey = `feathery-user-id-${sdkKey}`;
      const cookieId = getCookie(cookieKey) || uuidv4();
      if (!initState.userId) {
        initState.userId = cookieId;
        setCookie(cookieKey, cookieId);
      } else if (initState.userId !== cookieId) {
        // If user ID is manually specified, override and save cookie
        setCookie(cookieKey, initState.userId);
      }
    } else if (initState.userTracking === 'fingerprint') {
      if (!initState.userId) {
        initFormsPromise = FingerprintJS.load()
          .then((fp: any) => fp.get())
          .then((result: any) => (initState.userId = result.visitorId));
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
    setCookie(`feathery-user-id-${initState.sdkKey}`, newUserId);
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
 * If customers provide files through setFieldValues
 * we need to explicitly convert any files to file Promises
 * since they may not have done so
 */
function setFieldValues(userVals: FieldValues, rerender = true): void {
  const result: FieldValues = {};
  Object.entries(userVals).forEach(([key, value]) => {
    if (Array.isArray(value))
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
  setFieldValues,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap
};
