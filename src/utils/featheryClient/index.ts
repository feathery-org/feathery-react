import IntegrationClient from './integrationClient';
import {
  fieldValues,
  fileDeduplicationCount,
  filePathMap,
  fileRetryStatus,
  initFormsPromise,
  initInfo,
  initState,
  markStepCompleted,
  registerKnownFieldKeys,
  registerTextVariableFormats,
  setFieldValues
} from '../init';
import { dataURLToFile, isBase64Image } from '../image';
import { encodeGetParams } from '../primitives';
import {
  getABVariant,
  isStoreFieldValueAction,
  updateSessionValues
} from '../formHelperFunctions';
import {
  FILE_FIELD_TYPES,
  getDefaultFormFieldValue,
  isRepeatedFileField
} from '../fieldHelperFunctions';
import { loadPhoneValidator } from '../validation';
import {
  isFontDeclaredByHost,
  loadGoogleFonts,
  setFontFallbacks
} from '../fonts';
import { initializeIntegrations } from '../../integrations/utils';
import { loadLottieLight } from '../../elements/components/Lottie';
import { downloadAllFileUrls, featheryDoc, featheryWindow } from '../browser';
import { authState } from '../../auth/LoginForm';
import { loadQRScanner } from '../../elements/fields/QRScanner/qrLoader';
import { gatherTrustedFormFields } from '../../integrations/trustedform';
import { RequestOptions } from '../offlineRequestHandler';
import {
  completeUpload,
  failUpload,
  queueUpload,
  startUpload
} from '../fileUploadProgress';
import debounce from 'lodash.debounce';
import type { DebouncedFunc } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { GetConfigParams, RunComputerAgentOptions } from '../internalState';
import {
  dataHubAction as apiDataHubAction,
  extractAIDocument,
  ExtractionActionOptions,
  forwardInboxEmail,
  ForwardInboxEmailOptions,
  generateFormDocuments as apiGenerateFormDocuments,
  getApiUrl,
  getCdnUrl,
  getS3Url,
  getStaticUrl,
  HubActionOptions,
  inviteFormCollaborator as apiInviteFormCollaborator,
  setTaskStatus as apiSetTaskStatus,
  PageSelectionInput,
  parseAPIError,
  pollForCompletion,
  setEnvironment,
  URL_ENUM
} from '@feathery/client-utils';
import {
  FEATHERY_INTERACTION_EVENT,
  isInteractionDetected,
  setInteractionDetected
} from '../interactionState';
import { EventQueue } from '../eventQueue';

setEnvironment('production');
try {
  setEnvironment((process.env.BACKEND_ENV || 'production') as URL_ENUM);
} catch (e) {} // process.env won't exist in production build

export let API_URL = getApiUrl();
export let CDN_URL = getCdnUrl();
export let STATIC_URL = getStaticUrl();
export let S3_URL = getS3Url();

export const updateRegionApiUrls = (region: string) => {
  const environmentMap: Record<string, URL_ENUM> = {
    au: 'productionAU',
    ca: 'productionCA',
    eu: 'productionEU',
    jp: 'productionJP'
  };
  if (!environmentMap[region]) return;

  setEnvironment(environmentMap[region]);
  API_URL = getApiUrl();
  CDN_URL = getCdnUrl();
  STATIC_URL = getStaticUrl();
  S3_URL = getS3Url();
};

/**
 * The number of milliseconds waited until another submitCustom call
 */
const SUBMIT_CUSTOM_DEBOUNCE_WINDOW = 1000;

// Display names for the file upload progress toast. Resolved file values are
// File objects or S3 path strings; signature blobs may have no usable name.
const getUploadFileNames = (fileValue: any): string[] => {
  const files = Array.isArray(fileValue) ? fileValue : [fileValue];
  return files
    .map((file) => {
      if (typeof file === 'string') return file.split('/').pop() ?? '';
      return file?.name ?? '';
    })
    .filter(Boolean);
};

/**
 * The invite endpoint hands its error body back as unparsed text, so a friendly
 * `{"message": ...}` 400 would otherwise be shown to the user as raw JSON.
 * Anything we can't read a message out of falls back to the body as-is.
 */
export function parseInviteError(body?: string) {
  if (!body) return 'Failed to invite collaborators';
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === 'string') return parsed.message;
  } catch (e) {
    // Not JSON - fall through to the raw body
  }
  return body;
}

export default class FeatheryClient extends IntegrationClient {
  /**
   * Used to aggregate field value updates for successive calls to
   * submitCustom within the debounce window
   */
  pendingCustomFieldUpdates: { [key: string]: any };

  /**
   * Debounced implementation of submitCustom
   */
  debouncedSubmitCustom: DebouncedFunc<(override: boolean) => Promise<void>>;
  customSubmitInFlight: Record<string, any>;

  /**
   * Queue for events triggered before user interaction
   */
  private userEventQueue: EventQueue = new EventQueue();

  constructor(
    formKey = '',
    ignoreNetworkErrors?: any,
    draft = false,
    bypassCDN = false
  ) {
    super(formKey, ignoreNetworkErrors, draft, bypassCDN);
    this.pendingCustomFieldUpdates = {};
    this.customSubmitInFlight = {};
    this.debouncedSubmitCustom = debounce(
      this._debouncedSubmitCustom.bind(this),
      SUBMIT_CUSTOM_DEBOUNCE_WINDOW
    );

    this.handleInteraction = this.handleInteraction.bind(this);
    if (typeof CustomEvent !== 'undefined') {
      featheryWindow().addEventListener?.(
        FEATHERY_INTERACTION_EVENT,
        this.handleInteraction
      );
    } else {
      console.warn('CustomEvent is not available');
      setInteractionDetected();
    }
  }

  private async handleInteraction() {
    featheryWindow().removeEventListener?.(
      FEATHERY_INTERACTION_EVENT,
      this.handleInteraction
    );

    // replay queued events, then flush fields
    await this.replayQueuedEvents();
    await this.submitCustom({}, { shouldFlush: true });
  }

  private async replayQueuedEvents() {
    if (this.userEventQueue.isEmpty()) return;

    await this.userEventQueue.replayAll(async (eventData) => {
      return this._registerEventInternal(eventData);
    });
  }

  public destroy() {
    featheryWindow().removeEventListener?.(
      FEATHERY_INTERACTION_EVENT,
      this.handleInteraction
    );
  }

  async _submitJSONData(servars: any, stepKey: string, noComplete: boolean) {
    if (servars.length === 0) return Promise.resolve();

    const { userId, collaboratorId } = initInfo();
    const url = `${API_URL}panel/step/submit/v3/`;
    const data: Record<string, any> = {
      fuser_key: userId,
      step_key: stepKey,
      servars,
      panel_key: this.formKey,
      __feathery_version: this.version,
      no_complete: noComplete
    };
    if (collaboratorId) data.collaborator_user = collaboratorId;

    const options: RequestOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };

    return this.offlineRequestHandler.runOrSaveRequest(
      () => this._fetch(url, options, true, true),
      url,
      options,
      'submit',
      stepKey
    );
  }

  async _getFileValue(servar: any) {
    let fileValue;
    if ('file_upload' in servar) {
      fileValue = servar.file_upload;
    } else if ('signature' in servar) {
      fileValue = servar.signature;
    } else if ('audio_recording' in servar) {
      fileValue = servar.audio_recording;
    }

    if (!fileValue) return null;

    // If we've already stored the file from a previous session
    // There will be an entry in filePathMap for it
    // If so we just need to send the S3 path to the backend, not the full file
    const resolveFile = async (
      file: any,
      index: number | null = null,
      { rethrowOnFailure = false }: { rethrowOnFailure?: boolean } = {}
    ) => {
      let path;
      try {
        path = filePathMap[servar.key];
        if (path && index !== null && Array.isArray(path)) {
          path = path[index];
        }
        return path && path !== '' ? path : await file;
      } catch (error) {
        if (rethrowOnFailure) {
          throw error instanceof Error
            ? error
            : new Error('File resolution failed');
        }
        return null;
      }
    };

    if (Array.isArray(fileValue)) {
      // Keep every position: a repeat row with no file stays null so its index
      // survives to the wire instead of the later files shifting up.
      const isHole = (v: any) => v === null || v === undefined || v === '';
      const failures: Error[] = [];
      const resolved = await Promise.all(
        fileValue.map(async (f, i) => {
          // An empty row must not resolve to whatever path is still stored at
          // its index. filePathMap outlives the value for any writer that
          // clears a row without sweeping the map -- the `field.value` setter
          // and repeat_single both do -- and resurrecting it here would submit
          // one file at two rows at once.
          if (isHole(f)) return null;
          try {
            const value = await resolveFile(f, i, { rethrowOnFailure: true });
            return value === undefined ? null : value;
          } catch (error) {
            failures.push(
              error instanceof Error ? error : new Error('File upload failed')
            );
            return null;
          }
        })
      );

      if (!failures.length) return resolved;

      // The submit replaces the whole field, so letting a failed row through as
      // a hole would delete the file already stored at that row. Every row that
      // was meant to hold a file has to resolve, or the user hears about it.
      if (isRepeatedFileField(servar)) throw failures[0];

      // A plain multi-file field holds no positions worth keeping, so one bad
      // upload out of three still sends the other two, as it did before repeat
      // holes existed. Only losing all of them is worth an error.
      const uploaded = resolved.filter((v) => !isHole(v));
      if (!uploaded.length) throw failures[0];
      return uploaded;
    } else {
      return await resolveFile(fileValue, null, { rethrowOnFailure: true });
    }
  }

  async _submitFileData(servar: any, stepKey: string) {
    const { userId } = initInfo();
    const url = `${API_URL}panel/step/submit/file/${userId}/`;

    const formData = new FormData();
    const fileValue = await this._getFileValue(servar);

    let numFiles = 0;
    const keepIndices: number[] = [];
    const newIndices: number[] = [];

    if (fileValue || fileValue === '') {
      if (Array.isArray(fileValue)) {
        // Only real files go on the wire; their repeat indices travel alongside
        // so the backend can rebuild the holes.
        fileValue.forEach((file, index) => {
          if (!file || file === '') return;
          formData.append(servar.key, file);
          // A string is an S3 path the backend should keep, anything else is a
          // fresh upload. request.data merges those two sources, so they are
          // indexed separately.
          (typeof file === 'string' ? keepIndices : newIndices).push(index);
        });
        numFiles = keepIndices.length + newIndices.length;
      } else if (fileValue !== '') {
        formData.append(servar.key, fileValue);
        numFiles = 1;
      }
    }

    // If no files, check if we need to send clear request
    if (numFiles === 0) {
      const hasPreviousSuccess = fileRetryStatus[servar.key] !== undefined;

      // Only skip request for optional fields that were never submitted
      if (
        fileDeduplicationCount[servar.key] === undefined &&
        !hasPreviousSuccess
      ) {
        return Promise.resolve();
      }
      formData.append(servar.key, '');
    }

    // Only block duplicate submissions if the previous attempt SUCCEEDED
    // This allows retries after failures while preventing duplicate successful
    // uploads. Keyed on the indices, not just the count: moving a file between
    // repeat rows leaves the count identical but is a real change.
    const fingerprint = `${numFiles}:${keepIndices.join()}:${newIndices.join()}`;
    const hadSuccess = fileRetryStatus[servar.key];
    if (hadSuccess && fileDeduplicationCount[servar.key] === fingerprint)
      return Promise.resolve();

    fileDeduplicationCount[servar.key] = fingerprint;

    // Don't surface field-clearing requests in the upload progress toast.
    // numFiles is passed separately from the names because a value with no
    // usable name (a signature blob) still counts toward the row's label.
    if (numFiles > 0)
      startUpload(
        this.formKey,
        servar.key,
        getUploadFileNames(fileValue),
        numFiles
      );

    // Only a repeated file field has repeat rows to index. A non-repeated
    // multi-file field is a flat list, so sending indices for it would flip its
    // rows off the legacy dense representation for no gain, and would do so on
    // nearly every file submission.
    if (numFiles > 0 && servar.repeated && Array.isArray(fileValue))
      formData.set(
        '__feathery_file_indices',
        JSON.stringify({
          [servar.key]: {
            keep: keepIndices,
            new: newIndices,
            // The repeat row count. It bounds the indices server-side to rows
            // that exist, so a bug here cannot make one file expand into
            // thousands of slots in every reader.
            length: fileValue.length
          }
        })
      );

    formData.set('__feathery_form_key', this.formKey);
    formData.set('__feathery_step_key', stepKey);
    if (this.version) formData.set('__feathery_version', this.version);

    const options: RequestOptions = {
      method: 'POST',
      body: formData,
      // In Safari, request fails with keepalive = true if over 64kb payload.
      keepalive: false
    };

    // Only a queued request stays pending in the progress toast — the replay
    // engine reports its eventual outcome. Every other path has to resolve the
    // row here, including the auth and conflict failures that resolve with no
    // response at all.
    let queuedForReplay = false;
    try {
      // Reset retry attempts for this field before retrying so new submissions get the full budget
      await this.offlineRequestHandler.resetRetryAttemptsByUrl(url, {
        fieldKey: servar.key
      });

      const result = await this.offlineRequestHandler.runOrSaveRequest(
        () => this._fetch(url, options, true, true),
        url,
        options,
        'submit',
        stepKey,
        {
          fieldKey: servar.key,
          preserveStepRequests: true
        },
        () => {
          queuedForReplay = true;
          // Waiting on connectivity, not stalled mid-upload
          queueUpload(this.formKey, servar.key);
        }
      );
      // Mark as successful upload - will block duplicate attempts
      fileRetryStatus[servar.key] = true;
      if (!queuedForReplay) completeUpload(this.formKey, servar.key);
      await this.offlineRequestHandler.clearFailedRequestByUrl(url, {
        fieldKey: servar.key
      });
      return result;
    } catch (error) {
      // Mark as failed - allows retry on next submission
      fileRetryStatus[servar.key] = false;
      delete fileDeduplicationCount[servar.key];
      if (!queuedForReplay) failUpload(this.formKey, servar.key);
      throw error;
    }
  }

  updateUserId(newUserId: string, merge = false) {
    const { userId: oldUserId } = initInfo();
    const data = {
      new_fuser_key: newUserId,
      merge,
      ...(oldUserId ? { fuser_key: oldUserId } : {})
    };
    const url = `${API_URL}fuser/update_key/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options);
  }

  pollUserData() {
    const { userId } = initInfo();
    const url = `${API_URL}fuser/poll/?fuser_key=${userId}`;
    return this._fetch(url);
  }

  setDefaultFormValues({ steps, additionalValues }: any) {
    const values: Record<string, any> = {};
    steps.forEach((step: any) => {
      step.servar_fields.forEach((field: any) => {
        const servar = field.servar;
        if (isBase64Image(additionalValues[servar.key])) {
          // All base64 strings need to be wrapped in a File
          additionalValues[servar.key] = dataURLToFile(
            additionalValues[servar.key],
            `${servar.key}.png`
          );
        }

        values[servar.key] = getDefaultFormFieldValue(field);
      });
    });
    registerKnownFieldKeys({ servars: Object.keys(values) });
    Object.assign(fieldValues, {
      ...values,
      ...additionalValues,
      ...fieldValues
    });
  }

  _loadFormPackages(res: any) {
    // Load default fonts
    loadGoogleFonts(res.fonts);
    setFontFallbacks(res.font_fallbacks ?? {});
    // Load user-uploaded fonts
    Object.entries(res.uploaded_fonts).forEach(([family, fontStyles]) => {
      (
        fontStyles as {
          source: string;
          style: string;
          weight: string | number;
        }[]
      ).forEach(({ source, style, weight }) => {
        // Skip variants the host page already declared in document.fonts
        if (isFontDeclaredByHost(family, `${weight}`, `${style}`)) return;
        const loadFont = (url: string) =>
          new FontFace(family, `url(${url})`, { style, weight: `${weight}` })
            .load()
            .then((font) => featheryDoc().fonts.add(font));
        loadFont(source).catch(() => {
          // Cloudfront might run into CORS issues so fall back to
          // S3 directly if needed
          const fallback = new URL(source);
          fallback.hostname = S3_URL;
          loadFont(fallback.toString()).catch((e) =>
            console.warn(`Font load issue: ${e}`)
          );
        });
      });
    });
    // Load Lottie if form needs animations
    let needLottie = false;
    // Load phone number validator for phone and login fields
    let needPhoneVal = false;
    let needQRScanner = false;

    res.steps.some((step: any) => {
      // If we've loaded everything available, we don't need to keep looking
      if (needLottie && needPhoneVal) return true;
      step.buttons.some((button: any) => {
        if (needLottie) return true; // Already loaded
        const { loading_icon: li, loading_icon_type: lit } = button.properties;
        needLottie = li && lit === 'application/json';
        if (needLottie) loadLottieLight();
      });
      step.servar_fields.some((field: any) => {
        const fieldType = field.servar.type;
        if (!needPhoneVal) {
          needPhoneVal = ['phone', 'phone_number'].includes(fieldType);
          if (needPhoneVal) loadPhoneValidator();
        }
        if (!needQRScanner) {
          needQRScanner = fieldType === 'qr_scanner';
          if (needQRScanner) loadQRScanner();
        }
      });
      step.images.forEach((image: any) => {
        // Preload images for better performance
        const url = image.properties.source_image;
        if (url) new Image().src = url;
      });
    });
  }

  fetchCacheForm(formLanguage?: string) {
    const { formSchemas, language: globalLanguage, theme } = initInfo();
    if (!formLanguage && this.formKey in formSchemas) {
      const cacheForm = formSchemas[this.formKey];
      this._loadFormPackages(cacheForm);
      return Promise.resolve(cacheForm);
    }

    const params = encodeGetParams({
      form_key: this.formKey,
      draft: this.draft,
      theme
    });
    const baseURL = this.bypassCDN ? API_URL : CDN_URL;
    const url = `${baseURL}panel/v20/?${params}`;
    const options: Record<string, any> = {
      importance: 'high',
      headers: { 'Accept-Encoding': 'gzip' }
    };
    let language = formLanguage ?? globalLanguage;
    if (language) {
      const defaults = navigator.languages.join(',');
      if (defaults) language = language + ',' + defaults;
      options.headers['Accept-Language'] = language;
    }

    return this._fetch(url, options).then(async (response) => {
      if (!response) return {};

      let res = await response.json();
      if (res.data) {
        res = getABVariant(res);
        this._loadFormPackages(res);
      }
      initState.defaultErrors = res.default_errors;
      initState.isTestEnv = !res.production;
      // Cache the loaded schema so in-form consumers can scan it — e.g. the
      // document-editor container resolves its document from the Generate
      // Documents button action that targets it. Otherwise formSchemas is only
      // populated via init({ preloadForms }), which hosted forms don't use.
      if (res.steps) initState.formSchemas[this.formKey] = res;
      registerTextVariableFormats(res);
      return res;
    });
  }

  async fetchForm(initVals: any, language?: string) {
    const res = await this.fetchCacheForm(language);
    // If form is disabled, data will equal `null`
    if (!res.steps) return { steps: [], formOff: true };

    // Update form ID & version if using AB test variant
    if (res.new_form_id) this.formKey = res.new_form_id;
    this.version = res.version;
    this._noSave = res.no_save_data;
    this.setDefaultFormValues({ steps: res.steps, additionalValues: initVals });
    return res;
  }

  // Lazily fetch the step keys the user has already completed. Queried only
  // when a stepper element renders, so it stays out of the session payload.
  async fetchCompletedSteps(): Promise<string[]> {
    await initFormsPromise;
    const { userId, collaboratorId, overrideUserId } = initInfo();

    let params: Record<string, any> = {
      form_key: this.formKey,
      override: overrideUserId
    };
    if (userId) params.fuser_key = userId;
    if (collaboratorId) params.collaborator_user = collaboratorId;
    // @ts-expect-error encodeGetParams returns the encoded query string
    params = encodeGetParams(params);
    const url = `${API_URL}panel/step/completion/?${params}`;

    const response = await this._fetch(url, {});
    if (!response) return [];
    const data = await response.json().catch(() => ({}));
    return data.completed_steps ?? [];
  }

  async fetchSession(formPromise = null, block = false) {
    // Block if there's a chance user id isn't available yet
    await (block ? initFormsPromise : Promise.resolve());
    const {
      userId,
      collaboratorId,
      collaboratorReview,
      overrideUserId,
      formSessions,
      fieldValuesInitialized: noData
    } = initInfo();

    if (this.formKey in formSessions) {
      const formData = await (formPromise ?? Promise.resolve());
      return [formSessions[this.formKey], formData];
    }

    initState.fieldValuesInitialized = true;
    let params: Record<string, any> = {
      form_key: this.formKey,
      draft: this.draft,
      override: overrideUserId,
      // This version reads a null in file_values as an empty repeat row.
      // Versions before it map over the array dereferencing `.url`, so the
      // backend holds the dense shape back until a client asks like this.
      repeat_holes: 'true'
    };
    if (userId) params.fuser_key = userId;
    if (collaboratorId) params.collaborator_user = collaboratorId;
    if (collaboratorReview) params.collaborator_review = !!collaboratorReview;
    if (authState.authId) params.auth_id = authState.authId;
    if (noData) params.no_data = 'true';
    // @ts-expect-error TS(2322): Type 'string' is not assignable to type '{ form_ke... Remove this comment to see the full error message
    params = encodeGetParams(params);
    const url = `${API_URL}panel/session/v3/?${params}`;
    const options = { importance: 'high' };

    const response = await this._fetch(url, options);
    if (!response) return [];

    const session = await response.json().catch((reason) => {
      throw new Error(
        reason + ' ' + userId + ' ' + this.formKey + response.status
      );
    });

    // Turn form off if invalid collaborator for submission
    const collab = session.collaborator ?? {};
    if (collab.invalid || collab.completed || collab.direct_submission_disabled)
      // will cause form to be disabled
      return [{ collaborator: collab }];

    // If tracking disabled or ID overridden, update user id from backend
    if (!noData && session.new_user_id) initState.userId = session.new_user_id;

    // Auth session only contains new field data
    const authSession = await initializeIntegrations(
      session.integrations,
      this
    );

    const trueSession = { ...session, ...authSession };
    // Registered even when the session carries no data, since the field keys are
    // returned regardless and text variables need them to resolve empty fields
    registerKnownFieldKeys(trueSession);
    if (!noData) updateSessionValues(trueSession);

    // submitAuthInfo can set formCompleted before the session is set, so we don't want to override completed flags
    if (initState.formSessions[this.formKey]?.form_completed)
      trueSession.form_completed = true;
    initState.formSessions[this.formKey] = trueSession;
    initState._internalUserId = trueSession.internal_id;

    const formData = await (formPromise ?? Promise.resolve());
    return [trueSession, formData];
  }

  async submitAuthInfo({
    authId,
    authData = {},
    isStytchTemplateKey = false
  }: any) {
    const { userId } = initInfo();
    await authState.onLogin();

    const data = {
      auth_id: authId,
      auth_data: authData,
      auth_form_key: authState.authFormKey,
      is_stytch_template_key: isStytchTemplateKey,
      // This response also feeds updateSessionValues, so it needs the same
      // hole signal the session fetch sends.
      repeat_holes: true,
      ...(userId ? { fuser_key: userId } : {})
    };
    const url = `${API_URL}panel/update_auth/v3/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options)
      .then((response) => {
        return response ? response.json() : Promise.resolve();
      })
      .then((data: any) => {
        if (!data) return Promise.resolve();

        let toReturn;
        if (data?.no_merge) {
          setFieldValues(data.field_values);
        } else {
          data.completed_forms.forEach((formKey: string) => {
            if (!initState.formSessions[formKey])
              initState.formSessions[formKey] = {};
            initState.formSessions[formKey].form_completed = true;
          });
          toReturn = data;
        }

        // Need to wait until form_completed has been fetched before setting
        // authId, otherwise we would flash the onboarding questions before
        // LoginForm renders its children
        authState.setAuthId(authId);

        return Promise.resolve(toReturn);
      });
  }

  /**
   * Debounceable function responsible for pinging `/api/panel/custom/submit/<version>`
   */
  async _debouncedSubmitCustom(override: boolean) {
    if (Object.keys(this.pendingCustomFieldUpdates).length === 0) {
      // if no pending changes, no need to keep listening for unload events.
      this._removeCustomFieldListener();
      return;
    }

    if (!isInteractionDetected()) {
      return;
    }

    // If the previous flush hasn't finished yet, skip this cycle. The pending
    // updates stay queued and a new debounced cycle is scheduled so they get
    // submitted once the in-flight request completes.
    if (Object.keys(this.customSubmitInFlight).length) {
      this.debouncedSubmitCustom(override);
      return;
    }

    const customKeyValues = { ...this.pendingCustomFieldUpdates };
    this.pendingCustomFieldUpdates = {}; // Clear pending updates after copying them

    const { userId } = initInfo();
    const url = `${API_URL}panel/custom/submit/v3/`;

    const jsonKeyVals: Record<string, any> = {};
    const formData = new FormData();

    await Promise.all(
      Object.entries(customKeyValues).map(async ([key, entry]) => {
        if (Array.isArray(entry)) {
          // Need to resolve the promises for successful file upload.
          const vals = await Promise.all(entry);
          if (vals.some((val) => val instanceof Blob)) {
            vals.forEach((val) => {
              formData.append('files', val);
              formData.append('file_keys', key);
            });
            return;
          }
        }

        entry = await entry;
        if (entry instanceof Blob) {
          formData.append('files', entry);
          formData.append('file_keys', key);
          return;
        }

        jsonKeyVals[key] = entry;
      })
    );

    formData.set('custom_key_values', JSON.stringify(jsonKeyVals));
    // @ts-expect-error TS(2345): Argument of type 'boolean' is not assignable to pa... Remove this comment to see the full error message
    formData.set('override', override);
    if (this.formKey) {
      formData.set('form_key', this.formKey);
      if (this.version) formData.set('__feathery_version', this.version);
    }
    if (userId) formData.set('fuser_key', userId);

    const options: RequestOptions = {
      method: 'POST',
      body: formData,
      // Ran into a situation with Baldwin where request would not go through
      // with keepalive = true
      keepalive: false
    };

    // Here we can safely remove the listener because offlineRequestHandler has its own beforeunload
    this._removeCustomFieldListener();
    const uniqueId = uuidv4();
    const req = this.offlineRequestHandler.runOrSaveRequest(
      () => this._fetch(url, options, true, true),
      url,
      options,
      'submit'
    );
    // Clean up on both success and failure so a failed request doesn't
    // permanently register as in flight and block future flush cycles
    const removeInFlight = () => delete this.customSubmitInFlight[uniqueId];
    this.customSubmitInFlight[uniqueId] = req.then(
      removeInFlight,
      removeInFlight
    );
    return await req;
  }

  /**
   * If there is a pending invocation of submitCustom, this method calls it immediately
   */
  async flushCustomFields(override = true) {
    // we call the debounced method and then flush() to immediately submit changes
    // see: https://github.com/lodash/lodash/issues/4185#issuecomment-462388355
    this.debouncedSubmitCustom(override);
    let ret = await this.debouncedSubmitCustom.flush();
    // A flush cycle is skipped if a previous submission is still in flight, so
    // wait for in-flight submissions to settle and re-flush until any updates
    // still pending have actually been submitted
    while (Object.keys(this.customSubmitInFlight).length) {
      await Promise.all(Object.values(this.customSubmitInFlight));
      if (!Object.keys(this.pendingCustomFieldUpdates).length) break;
      this.debouncedSubmitCustom(override);
      ret = await this.debouncedSubmitCustom.flush();
    }
    return ret;
  }

  /**
   * `beforeunload` event handler that flushes the pending submit custom changes
   * when a user is attempting to exit the page.
   * Defined via an arrow function so that event handler has a consistent reference
   * when adding and removing the listener
   * @param event `BeforeUnloadEvent`
   * @returns
   */
  _flushCustomFieldsBeforeUnload = (event: BeforeUnloadEvent) => {
    // allow navigation if user has not interacted with form
    if (!isInteractionDetected()) return;

    event.preventDefault();
    this.flushCustomFields();
    return (event.returnValue = '');
  };

  _removeCustomFieldListener() {
    featheryWindow().removeEventListener(
      'beforeunload',
      this._flushCustomFieldsBeforeUnload
    );
  }

  _addCustomFieldListener() {
    featheryWindow().addEventListener(
      'beforeunload',
      this._flushCustomFieldsBeforeUnload
    );
  }

  getNoSave() {
    if (this._noSave !== undefined) return this._noSave;
    return initInfo().initNoSave;
  }

  async submitCustom(
    customKeyValues: { [key: string]: any },
    // Options
    {
      override = true,
      shouldFlush = false
    }: { override?: boolean; shouldFlush?: boolean } = {}
  ) {
    if (this.draft || this.getNoSave()) return;
    if (Object.keys(customKeyValues).length === 0 && !shouldFlush) return;
    // If there are values passed, aggregate them in the pending queue
    Object.entries(customKeyValues).forEach(([key, value]) => {
      if (value !== undefined) this.pendingCustomFieldUpdates[key] = value;
    });
    // if we don't want to override the existing values or the caller tells us to flush, immediately flush
    if (!override || shouldFlush) {
      return this.flushCustomFields(override);
    }
    if (Object.keys(this.pendingCustomFieldUpdates).length) {
      // if there are pending changes, prevent user from exiting page and losing them
      this._addCustomFieldListener();
    }
    // otherwise, ping the API in normal debounced cadence
    return this.debouncedSubmitCustom(override);
  }

  // servars = [{key: <servarKey>, <type>: <value>}]
  async submitStep(servars: any, step: any, hasNext: boolean) {
    if (this.draft || this.getNoSave()) return;

    const items = [
      ...step.buttons.filter(isStoreFieldValueAction),
      ...step.subgrids.filter(isStoreFieldValueAction)
    ];
    const hiddenFields: Record<string, any> = {};
    items.forEach(({ properties }: any) => {
      const fieldKey = properties.custom_store_field_key;
      const value = fieldValues[fieldKey];
      // need to include value === '' so that we can clear out hidden fields
      if (value !== undefined) hiddenFields[fieldKey] = value;
    });
    gatherTrustedFormFields(hiddenFields, this.formKey);

    const isFileServar = (servar: any) =>
      FILE_FIELD_TYPES.some((type) => type in servar);
    const jsonServars = servars.filter((servar: any) => !isFileServar(servar));
    const fileServars = servars.filter(isFileServar);

    await this.handleInteraction();
    const waitForPreviousSubmission = this.submitQueue.catch(() => undefined);
    const submission = Promise.all([
      waitForPreviousSubmission,
      this.submitCustom(hiddenFields, { shouldFlush: true }),
      this._submitJSONData(jsonServars, step.key, hasNext),
      ...fileServars.map((servar: any) =>
        this._submitFileData(servar, step.key)
      )
    ]);

    // Maintain submitQueue semantics so downstream consumers (like registerEvent)
    // still see actual success/failure while preventing previous rejections
    // from blocking new submit attempts.
    this.submitQueue = submission;

    return submission;
  }

  // Submit only specific file/signature servars without submitting the rest of
  // the step. Used to auto-submit an AI extraction's file field(s) on trigger,
  // independent of the button's "Validate & Submit Step" toggle. Re-submitting
  // an already-submitted file is a safe no-op (deduped client-side by field and
  // server-side by S3 path).
  // fileEntries = [{servar: {key, <type>: <value>}, stepKey}]
  async submitFiles(fileEntries: { servar: any; stepKey: string }[]) {
    if (this.draft || this.getNoSave()) return;
    if (!fileEntries.length) return;

    await this.handleInteraction();
    const submission = Promise.all([
      this.submitQueue.catch(() => undefined),
      ...fileEntries.map(({ servar, stepKey }) =>
        this._submitFileData(servar, stepKey)
      )
    ]);
    this.submitQueue = submission;
    return submission;
  }

  async registerEvent(eventData: any) {
    if (this.draft) return;

    // A 'complete' event means the step was submitted — record it so the
    // stepper reflects which steps are completed vs merely skipped over.
    if (eventData.event === 'complete') markStepCompleted(eventData.step_key);

    if (!isInteractionDetected() || this.userEventQueue.isReplayingEvents()) {
      return this.userEventQueue.enqueue(eventData);
    }

    return this._registerEventInternal(eventData);
  }

  private async _registerEventInternal(eventData: any) {
    await initFormsPromise;

    const { userId, collaboratorId } = initInfo();

    const url = `${API_URL}event/`;
    const data: Record<string, string> = {
      form_key: this.formKey,
      ...eventData,
      ...(userId ? { fuser_key: userId } : {}),
      event_id: uuidv4(),
      timestamp: new Date().toISOString()
    };
    if (collaboratorId) data.collaborator_user = collaboratorId;
    if (this.version) data.__feathery_version = this.version;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };

    let prom = null;
    let stepKey = '';
    if (eventData.event === 'load') {
      stepKey = eventData.previous_step_key;
    } else {
      stepKey = eventData.step_key;
      prom = this.flushCustomFields();
    }

    const triggerEvent = () =>
      this.offlineRequestHandler.runOrSaveRequest(
        // Ensure events complete before user exits page. Submit and load event of
        // next step must happen after the previous step is done submitting
        () =>
          this.submitQueue
            // Swallow TypeErrors (network failures) so _fetch proceeds regardless
            .catch((error) => {
              if (error instanceof TypeError) return;
              throw error;
            })
            .then(() => this._fetch(url, options, true, true)),
        url,
        options,
        'registerEvent',
        stepKey
      );

    let eventPromise: Promise<any>;
    if (eventData.completed && prom)
      eventPromise = prom.then(() => triggerEvent());
    else eventPromise = Promise.all([prom, triggerEvent()]);

    this.eventQueue = this.eventQueue.then(() => eventPromise);
    return eventPromise;
  }

  runServerSideLogicRule(id: string) {
    const { userId, collaboratorId } = initInfo();
    const data: any = {
      id: id,
      form_key: this.formKey,
      fuser_key: userId
    };
    if (collaboratorId) data.collaborator_id = collaboratorId;

    const url = `${API_URL}panel/logic-rule/execute/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data),
      keepalive: false
    };

    return this._fetch(url, options).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  AI_CHECK_INTERVAL = 2000;
  AI_MAX_TIME = 10 * 60 * 1000;
  COMPUTER_AGENT_MAX_TIME = 30 * 60 * 1000;

  // AI
  async runAIExtraction({
    extractionId,
    options,
    pages,
    setPollFuserData,
    onStatusUpdate
  }: {
    extractionId: string;
    options: ExtractionActionOptions | boolean;
    pages?: PageSelectionInput;
    setPollFuserData?: any;
    onStatusUpdate?: any;
  }) {
    const { userId, sdkKey, collaboratorId } = initInfo();
    return await extractAIDocument(
      sdkKey,
      extractionId,
      options,
      userId,
      pages,
      undefined,
      collaboratorId,
      this.AI_CHECK_INTERVAL,
      this.AI_MAX_TIME,
      () => setPollFuserData?.(true),
      onStatusUpdate,
      this.formKey
    );
  }

  async runComputerAgent(
    agentId: string,
    options: RunComputerAgentOptions = {}
  ) {
    const { userId, sdkKey } = initInfo();
    await this.submitQueue;
    const url = `${API_URL}computer-agent/run/`;
    const reqOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({
        agent_id: agentId,
        fuser_key: userId,
        panel_key: this.formKey
      })
    };
    const res = await this._fetch(url, reqOptions, false);
    if (!res || res.status !== 201)
      return { ok: false, error: (await res?.text()) ?? '' };

    const payload = await res.json();
    const pollUrl =
      `${API_URL}computer-agent/run/completion/` +
      `?fid=${userId}&rid=${payload.run_id}`;
    const poll = pollForCompletion(
      sdkKey,
      pollUrl,
      this.AI_CHECK_INTERVAL,
      this.COMPUTER_AGENT_MAX_TIME,
      'Computer agent',
      options.onStatusUpdate
    ).then((data) => {
      options.onComplete?.(data);
      return data;
    });

    if (!options.waitForCompletion) return { ok: true, payload };
    return { ok: true, payload: { ...payload, ...(await poll) } };
  }

  async forwardInboxEmail({ options }: { options: ForwardInboxEmailOptions }) {
    const { userId, sdkKey } = initInfo();
    const forwardUserId = options.submissionId || userId;

    if (!forwardUserId) {
      throw new Error('No submission ID or user ID available for forwarding');
    }

    await forwardInboxEmail(
      sdkKey,
      forwardUserId,
      options,
      undefined,
      this.formKey
    );
  }

  async getConfig(configParams: GetConfigParams) {
    const url = `${API_URL}account/config/`;
    const reqOptions = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify({ ...configParams, form_key: this.formKey })
    };
    const res = await this._fetch(url, reqOptions, false);
    if (res && res.status === 200) return await res.json();
    else return [];
  }

  // Collaboration
  async verifyCollaborator(email: string) {
    const { userId, collaboratorId } = initInfo();
    const params: Record<string, any> = {
      fuser_key: userId,
      email,
      form_key: this.formKey
    };
    if (collaboratorId) params.collaborator_user = collaboratorId;
    const url = `${API_URL}collaborator/verify/?${encodeGetParams(params)}`;
    return this._fetch(url).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  async inviteCollaborator(usersGroups: string[], templateId: string) {
    const { userId, collaboratorId, sdkKey } = initInfo();
    const res = await apiInviteFormCollaborator(
      sdkKey,
      this.formKey,
      templateId,
      usersGroups,
      userId,
      collaboratorId
    );

    if (res && res.ok) {
      return res;
    } else throw Error(parseInviteError(res?.error));
  }

  async rewindCollaboration(templateId: string, rewindEmailKey: string) {
    const { userId } = initInfo();
    const data: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      template_id: templateId
    };
    const email = fieldValues[rewindEmailKey];
    if (email) data.rewind_email = email;

    const url = `${API_URL}collaborator/rewind/`;
    return this._fetch(
      url,
      {
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
        body: JSON.stringify(data)
      },
      false
    ).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  async setTaskStatus(templateId: string, taskStatusId: string) {
    const { userId, collaboratorId, sdkKey } = initInfo();
    const res = await apiSetTaskStatus(
      sdkKey,
      this.formKey,
      templateId,
      taskStatusId,
      userId,
      collaboratorId
    );

    if (res && res.ok) {
      return res.payload;
    } else throw Error(parseAPIError(res));
  }

  async setCollaboratorAsCompleted(templateId: string) {
    const { userId } = initInfo();
    const data: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      template_id: templateId
    };

    const url = `${API_URL}collaborator/complete/`;
    return this._fetch(
      url,
      {
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
        body: JSON.stringify(data)
      },
      false
    ).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseAPIError(await response.json()));
      }
    });
  }

  async generateDocuments({
    documentIds,
    download = false,
    merge = false,
    repeatable = false,
    zipName,
    mergedFileName
  }: {
    documentIds: string[];
    download?: boolean;
    merge?: boolean;
    repeatable?: boolean;
    zipName?: string;
    mergedFileName?: string;
  }) {
    const { userId, sdkKey } = initInfo();
    const payload = await apiGenerateFormDocuments({
      sdkKey,
      formId: this.formKey,
      documentIds,
      userId,
      envelopeAction: 'fill',
      mergeDocuments: merge,
      repeatable,
      mergedFileName
    });
    if (payload.status === 'error') throw Error(payload.message);

    const files = payload?.files;
    if (download) await downloadAllFileUrls(files, zipName);
    return { files };
  }

  async resetPendingFileUploads(fieldKeys: string[]) {
    if (!fieldKeys.length) return;
    await initFormsPromise;
    const { userId } = initInfo();
    if (!userId) return;
    const url = `${API_URL}panel/step/submit/file/${userId}/`;
    await Promise.all(
      fieldKeys.map((key) =>
        this.offlineRequestHandler.resetRetryAttemptsByUrl(url, {
          fieldKey: key
        })
      )
    );
    this.offlineRequestHandler.replayRequests().catch(() => {});
  }

  // Delegates to client-utils so the browser and the server-side lambdas
  // share one request shape. `create` + verification 'unverified'
  // stages `rows` as an import batch; when the button action configures an
  // ID field, the current user's key is the batch value - stamped into that
  // field server-side - so a pending import survives reloads without a
  // dedicated backend column.
  async dataHubAction(options: HubActionOptions) {
    const { sdkKey, userId } = initInfo();
    const resolved =
      options.operation === 'create' && options.idFieldId && !options.idValue
        ? { ...options, idValue: userId }
        : options;
    return apiDataHubAction(sdkKey, resolved, this.formKey);
  }

  async getHubSchemas(hubIds: string[]) {
    const params = new URLSearchParams({ hub_ids: hubIds.join(',') });
    if (this.formKey) params.set('form_key', this.formKey);
    const url = `${API_URL}hub/schema/?${params.toString()}`;
    const res = await this._fetch(
      url,
      { headers: { 'Content-Type': 'application/json' }, method: 'GET' },
      false
    );
    if (res) {
      if (res.ok) return await res.json();
      throw Error(parseAPIError(await res.json()));
    }
    return { hubs: [] };
  }
}
