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
// mask.ts imports nothing, so this stays free of the import cycles the rest of
// the elements tree would introduce here.
import { showsFormatInText } from '../elements/fields/TextField/mask';

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
  authenticationError?: string;
  // Step keys the user has completed (i.e. submitted), loaded lazily when a
  // stepper renders and updated as the user advances. Used to render stepper
  // completion so a step skipped over (navigated past without submitting)
  // stays uncompleted.
  completedSteps: Set<string>;
  // Form keys whose completed steps have already been fetched, so a stepper
  // only triggers the request once per form.
  completedStepsLoaded: Set<string>;
  // Every field key defined on the loaded forms and the org, whether or not the
  // user has a value for it. Lets text variables tell an unfilled field apart
  // from a name that doesn't resolve to any field.
  knownFieldKeys: Set<string>;
  // Number fields that opted into showing their format in text variables,
  // keyed by field key — all a text variable carries. A key that isn't here
  // interpolates its raw value, which is what every field did before the
  // option existed.
  textVariableFormats: Record<string, any>;
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
  region: '',
  completedSteps: new Set(),
  completedStepsLoaded: new Set(),
  knownFieldKeys: new Set(),
  textVariableFormats: {}
};
let fieldValues: FieldValues = {};
let filePathMap: Record<string, null | string | (string | null)[]> = {};
// Tracks number of files in last submission (prevents duplicate successful uploads)
export const fileDeduplicationCount: Record<string, string> = {};
// Tracks last submission result (true=success, false=failed, undefined=never tried)
export const fileRetryStatus: Record<string, boolean> = {};

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
  logFeatheryBadge();

  initState.initialized = true;
  // Clear any previous authentication errors on new initialization
  initState.authenticationError = undefined;

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
    global.scriptjsLoadPromise = import(
      /* webpackChunkName: "scriptjs" */ 'scriptjs'
    );

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
      registerTextVariableFormats(stepsResponse);
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

/**
 * Record the field keys a session declares. Servars are scoped to the form (plus
 * its draft and AB variant), hidden fields are org-wide. Not reset with the user
 * ID since field definitions don't belong to a submitter.
 */
function registerKnownFieldKeys(session: any) {
  const hidden = session?.hidden_fields;
  [
    ...(session?.servars ?? []),
    // v3 sessions key hidden fields by type; older ones send a flat list
    ...(Array.isArray(hidden) ? hidden : Object.keys(hidden ?? {}))
  ].forEach((key: string) => initState.knownFieldKeys.add(key));
}

/**
 * Record which number fields render their format inside text variables. Driven
 * off the form schema rather than the session, since only the schema carries
 * servar metadata, and re-run per schema load so toggling the option in the
 * builder takes effect on the next fetch.
 */
function registerTextVariableFormats(schema: any) {
  // Steps arrive keyed by step id from the API and as an array when a form is
  // off; Object.values covers both.
  Object.values(schema?.steps ?? {}).forEach((step: any) => {
    (step?.servar_fields ?? []).forEach((field: any) => {
      const servar = field?.servar;
      if (servar?.type !== 'integer_field' || !servar.key) return;
      // Drop rather than skip, so turning the option off releases a key that an
      // earlier load registered.
      if (showsFormatInText(servar))
        initState.textVariableFormats[servar.key] = servar;
      else delete initState.textVariableFormats[servar.key];
    });
  });
}

function getCompletedStepKeys() {
  // Make a copy so callers can't mutate the set directly
  return new Set(initState.completedSteps);
}

// Record a step as completed once it has been submitted
function markStepCompleted(stepKey: string) {
  if (stepKey) initState.completedSteps.add(stepKey);
}

// Fetch the user's completed steps for a form once (deduped per form key) and
// seed them into init state. Triggered lazily by the stepper element when it
// renders; the stepper re-renders itself once this resolves.
async function loadCompletedSteps(client: any) {
  const formKey = client?.formKey;
  if (!formKey || initState.completedStepsLoaded.has(formKey)) return;
  initState.completedStepsLoaded.add(formKey);
  try {
    // Merge rather than replace so steps already completed locally aren't
    // dropped (completion is monotonic — a step never becomes uncompleted)
    (await client.fetchCompletedSteps()).forEach(markStepCompleted);
  } catch (e) {
    // Allow a retry on the next render if the request failed
    initState.completedStepsLoaded.delete(formKey);
  }
}

declare const __PACKAGE_VERSION__: string;

function logFeatheryBadge() {
  console.log(
    '%c Feathery %c v' + __PACKAGE_VERSION__ + ' ', // replaced with real version during build
    'background: #e2626e; color: white; padding: 2px 6px; border-radius: 3px 0 0 3px; font-weight: bold;',
    'background: #fce7e9; color: #c5495a; padding: 2px 6px; border-radius: 0 3px 3px 0;'
  );
}

export {
  init,
  initInfo,
  updateUserId,
  updateTheme,
  setFieldValues,
  getFieldValues,
  registerKnownFieldKeys,
  registerTextVariableFormats,
  getCompletedStepKeys,
  markStepCompleted,
  loadCompletedSteps,
  initState,
  initFormsPromise,
  fieldValues,
  filePathMap
};
