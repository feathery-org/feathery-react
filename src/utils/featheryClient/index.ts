import IntegrationClient from './integrationClient';
import {
  fieldValues,
  filePathMap,
  fileDeduplicationCount,
  fileRetryStatus,
  initFormsPromise,
  initInfo,
  initState,
  setFieldValues
} from '../init';
import { dataURLToFile, isBase64Image } from '../image';
import { encodeGetParams } from '../primitives';
import {
  getABVariant,
  isStoreFieldValueAction,
  updateSessionValues
} from '../formHelperFunctions';
import { getDefaultFormFieldValue } from '../fieldHelperFunctions';
import { loadPhoneValidator } from '../validation';
import { initializeIntegrations } from '../../integrations/utils';
import { loadLottieLight } from '../../elements/components/Lottie';
import { downloadAllFileUrls, featheryDoc, featheryWindow } from '../browser';
import { authState } from '../../auth/LoginForm';
import { loadQRScanner } from '../../elements/fields/QRScanner/qrLoader';
import { gatherTrustedFormFields } from '../../integrations/trustedform';
import { RequestOptions } from '../offlineRequestHandler';
import debounce from 'lodash.debounce';
import type { DebouncedFunc } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { GetConfigParams } from '../internalState';
import {
  ExtractionActionOptions,
  generateFormDocuments as apiGenerateFormDocuments,
  PageSelectionInput,
  parseAPIError,
  extractAIDocument,
  inviteFormCollaborator as apiInviteFormCollaborator,
  setEnvironment,
  URL_ENUM,
  getApiUrl,
  getStaticUrl,
  getS3Url,
  getCdnUrl,
  forwardInboxEmail
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
    eu: 'productionEU'
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
      // Use Promise.allSettled to handle failed promises gracefully
      const results = await Promise.allSettled(
        fileValue.map((f, i) => resolveFile(f, i))
      );

      const successfulFiles = results
        .filter(
          (r) =>
            r.status === 'fulfilled' &&
            r.value !== null &&
            r.value !== undefined
        )
        .map((r) => (r as PromiseFulfilledResult<any>).value);

      // If user tried to upload files but ALL failed, throw error
      const hadFiles = fileValue.length > 0;
      const allFailed = successfulFiles.length === 0;

      if (hadFiles && allFailed) {
        const firstError = results.find((r) => r.status === 'rejected');
        const errorMessage = firstError
          ? (firstError as PromiseRejectedResult).reason?.message ||
            'File upload failed'
          : 'All file uploads failed';
        throw new Error(errorMessage);
      }

      return successfulFiles;
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

    if (fileValue || fileValue === '') {
      if (Array.isArray(fileValue)) {
        const validFiles = fileValue.filter((file) => !!file && file !== '');
        validFiles.forEach((file) => formData.append(servar.key, file));
        numFiles = validFiles.length;
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
    // This allows retries after failures while preventing duplicate successful uploads
    const hadSuccess = fileRetryStatus[servar.key];
    if (hadSuccess && fileDeduplicationCount[servar.key] === numFiles)
      return Promise.resolve();

    fileDeduplicationCount[servar.key] = numFiles;

    formData.set('__feathery_form_key', this.formKey);
    formData.set('__feathery_step_key', stepKey);
    if (this.version) formData.set('__feathery_version', this.version);

    const options: RequestOptions = {
      method: 'POST',
      body: formData,
      // In Safari, request fails with keepalive = true if over 64kb payload.
      keepalive: false
    };

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
        }
      );
      // Mark as successful upload - will block duplicate attempts
      fileRetryStatus[servar.key] = true;
      await this.offlineRequestHandler.clearFailedRequestByUrl(url, {
        fieldKey: servar.key
      });
      return result;
    } catch (error) {
      // Mark as failed - allows retry on next submission
      fileRetryStatus[servar.key] = false;
      delete fileDeduplicationCount[servar.key];
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
    Object.assign(fieldValues, {
      ...values,
      ...additionalValues,
      ...fieldValues
    });
  }

  _loadFormPackages(res: any) {
    // Load default fonts
    if (res.fonts.length && global.webfontloaderPromise) {
      global.webfontloaderPromise.then((WebFont: any) => {
        WebFont.load({ google: { families: res.fonts } });
      });
    }
    // Load user-uploaded fonts
    Object.entries(res.uploaded_fonts).forEach(([family, fontStyles]) => {
      (fontStyles as any).forEach(({ source, style, weight }: any) => {
        const loadFont = (url: string) =>
          new FontFace(family, `url(${url})`, { style, weight })
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
      override: overrideUserId
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
    this.customSubmitInFlight[uniqueId] = req.then(
      () => delete this.customSubmitInFlight[uniqueId]
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
    const ret = await this.debouncedSubmitCustom.flush();
    await Promise.all(Object.values(this.customSubmitInFlight));
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
      ['file_upload', 'signature'].some((type) => type in servar);
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

  async registerEvent(eventData: any) {
    if (this.draft) return;

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
      ...(userId ? { fuser_key: userId } : {})
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
            .then(() =>
              this._fetch(url, options, true, true).catch((e) => {
                if (e instanceof TypeError && navigator.onLine)
                  // Wait 5 seconds since event may have actually been registered
                  // and just needs to be processed. If online, means it's not an
                  // offline error.
                  return new Promise((resolve) => setTimeout(resolve, 5000));
                throw e;
              })
            ),
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
      onStatusUpdate
    );
  }

  async forwardInboxEmail({
    options
  }: {
    options: {
      prefix?: string;
      emails?: string[];
      emailGroup?: string;
      submissionId?: string;
    };
  }) {
    const { userId, sdkKey } = initInfo();
    const forwardUserId = options.submissionId || userId;

    if (!forwardUserId) {
      throw new Error('No submission ID or user ID available for forwarding');
    }

    await forwardInboxEmail(
      sdkKey,
      forwardUserId,
      options.prefix || '',
      options.emails || [],
      options.emailGroup || '',
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
    } else throw Error(parseAPIError(res));
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
    download = false
  }: {
    documentIds: string[];
    download?: boolean;
  }) {
    const { userId, sdkKey } = initInfo();
    const data = await apiGenerateFormDocuments(
      sdkKey,
      this.formKey,
      documentIds,
      userId
    );
    const files = data?.files;
    if (download) await downloadAllFileUrls(files);
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
}
