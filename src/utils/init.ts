import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import FeatheryClient, { updateRegionApiUrls } from './featheryClient';
import * as errors from './error';
import {
  featheryWindow,
  getCookie,
  runningInClient,
  setCookie
} from './browser';
import { remountAllForms, rerenderAllForms } from './formHelperFunctions';
import { parseUserVal } from './entities/Field';
import { authState } from '../auth/LoginForm';

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

type InitOptions = {
  userId?: string;
  cacheUserId?: boolean;
  collaboratorId?: string;
  collaboratorReview?: '' | 'readOnly' | 'editable';
  preloadForms?: string[];
  userTracking?: 'cookie' | 'fingerprint';
  language?: string;
  theme?: string;
  noSave?: boolean;
  _enterpriseRegion?: string;
};

type InitState = {
  initialized: boolean;
  sdkKey: string;
  overrideUserId: boolean;
  formSchemas: { [formId: string]: any };
  formSessions: { [formId: string]: any };
  fieldValuesInitialized: boolean;
  redirectCallbacks: Record<string, any>;
  renderCallbacks: Record<string, Record<string, any>>;
  remountCallbacks: Record<string, any>;
  defaultErrors: Record<string, string>;
  isTestEnv: boolean;
  theme: string;
  region: string;
  initNoSave: boolean;
  _internalUserId: string;
} & InitOptions;

let initFormsPromise: Promise<void> = Promise.resolve();
export const defaultClient = new FeatheryClient();
const initState: InitState = {
  initialized: false,
  userTracking: 'cookie',
  _internalUserId: '',
  sdkKey: '',
  userId: '',
  collaboratorId: '',
  collaboratorReview: '',
  overrideUserId: false,
  language: '',
  formSchemas: {},
  formSessions: {},
  defaultErrors: {},
  // Since all field values are fetched with each session, only fetch field
  // values on the first session request
  fieldValuesInitialized: false,
  redirectCallbacks: {},
  renderCallbacks: {},
  remountCallbacks: {},
  isTestEnv: false,
  initNoSave: false,
  theme: '',
  region: ''
};
let fieldValues: FieldValues = {};
let filePathMap: Record<string, null | string | (string | null)[]> = {};
// Don't resubmit files already submitted in the same session
export const fileSubmittedMap: Record<string, number> = {};

function init(sdkKey: string, options: InitOptions = {}): Promise<string> {
  if (!sdkKey || typeof sdkKey !== 'string') {
    throw new errors.SDKKeyError();
  }

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
  if (options._enterpriseRegion)
    initState.region = options._enterpriseRegion.toLowerCase();
  updateRegionApiUrls(initState.region);

  if (options.userId) {
    initState.userId = options.userId;
    initState.overrideUserId = true;
  }
  if (options.noSave) initState.initNoSave = true;
  if (options.userTracking) initState.userTracking = options.userTracking;
  if (options.theme) initState.theme = options.theme;
  if (options.collaboratorId) initState.collaboratorId = options.collaboratorId;
  if (options.collaboratorReview)
    initState.collaboratorReview = options.collaboratorReview;
  if (options.language) {
    const langPieces = options.language.split(',');
    initState.language = langPieces.map((piece) => piece.trim()).join(',');
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
      } else if (
        initState.userId !== cookieId &&
        (options.cacheUserId ?? true)
      ) {
        // If user ID is manually specified, override and save cookie
        setCookie(cookieKey, initState.userId);
      }
    } else if (initState.userTracking === 'fingerprint') {
      if (!initState.userId) {
        initFormsPromise = FingerprintJS.load()
          .then((fingerprintAgent) => fingerprintAgent.get())
          .then((result) => {
            initState.userId = result.visitorId;
          });
      }
    }
  }

  initFormsPromise = initFormsPromise.then(() =>
    _fetchFormData(options.preloadForms ?? [])
  );
  return initFormsPromise.then(() => initState.userId ?? '');
}

// must be called after userId loads
function _fetchFormData(formIds: string[]) {
  formIds.forEach((key) => {
    const formClient = new FeatheryClient(key);
    formClient.fetchCacheForm().then((stepsResponse: any) => {
      initState.formSchemas[key] = stepsResponse;
    });
  });
}

function initInfo() {
  const { sdkKey } = initState;
  if (!sdkKey) throw new errors.SDKKeyError('SDK key has not been set');
  return initState;
}

function handleNewUserSearchParams(newUserId: string) {
  // removes any search params starting with '_'
  // if _id is present, replace it with new user id
  const searchParams = new URLSearchParams(location.search);
  const paramsToDelete: string[] = [];

  let hadIdParam = false;
  searchParams.forEach(function (value, key) {
    if (key === '_id') {
      hadIdParam = true;
    }
    if (key.charAt(0) === '_' && !['_slug', '_locale'].includes(key)) {
      paramsToDelete.push(key);
    }
  });

  for (let i = 0; i < paramsToDelete.length; i++) {
    searchParams.delete(paramsToDelete[i]);
  }

  if (hadIdParam) {
    searchParams.set('_id', newUserId);
  }

  const newSearch = searchParams.toString();
  const newUrl = location.pathname + (newSearch ? '?' + newSearch : '');

  featheryWindow().history.replaceState({}, '', newUrl);
}

async function updateUserId(newUserId?: string, merge = false): Promise<void> {
  if (!newUserId) newUserId = uuidv4();
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
    // Clear URL hash on new session if not tracking location
    handleNewUserSearchParams(newUserId);
    // Need to fully reload page if auth since LoginForm isn't yet accounted
    // for by rerenderAllForms
    if (authState.authId) location.reload();
    else remountAllForms();
  }
}

async function updateTheme(newTheme = '') {
  initState.theme = newTheme;
  await remountAllForms(true);
}

/**
 * If customers provide files through setFieldValues
 * we need to explicitly convert any files to file Promises
 * since they may not have done so
 */
function setFieldValues(
  userVals: FieldValues,
  rerender = true,
  skipServerSubmit = false
): void {
  const result: FieldValues = {};
  Object.entries(userVals).forEach(([key, value]) => {
    if (Array.isArray(value))
      result[key] = value.map((entry) => parseUserVal(entry, key));
    else result[key] = parseUserVal(value, key);
  });

  Object.assign(fieldValues, result);
  if (!skipServerSubmit) defaultClient.submitCustom(result);

  if (rerender) rerenderAllForms();
}

function getFieldValues() {
  // Make a copy so users can't set fieldValues directly
  return { ...fieldValues };
}

export {
  init,
  initInfo,
  updateUserId,
  updateTheme,
  setFieldValues,
  getFieldValues,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap
};
