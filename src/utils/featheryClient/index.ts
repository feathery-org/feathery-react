import IntegrationClient from './integrationClient';
import {
  fieldValues,
  filePathMap,
  initFormsPromise,
  initInfo,
  initState,
  setFieldValues
} from '../init';
import { dataURLToFile, isBase64Image } from '../image';
import { encodeGetParams } from '../primitives';
import {
  getABVariant,
  getDefaultFormFieldValue,
  isStoreFieldValueAction,
  updateSessionValues
} from '../formHelperFunctions';
import { loadPhoneValidator } from '../validation';
import { initializeIntegrations } from '../../integrations/utils';
import { loadLottieLight } from '../../elements/components/Lottie';
import { featheryDoc, featheryWindow } from '../browser';
import { authState } from '../../auth/LoginForm';
import { parseError } from '../error';
import { loadQRScanner } from '../../elements/fields/QRScanner';
import { gatherTrustedFormFields } from '../../integrations/trustedform';
import { RequestOptions } from '../offlineRequestHandler';
import debounce from 'lodash.debounce';
import { DebouncedFunc } from 'lodash';

export const API_URL_OPTIONS = {
  local: 'http://localhost:8006/api/',
  staging: 'https://staging.feathery.io/api/',
  production: 'https://api.feathery.io/api/',
  productionAU: 'https://api-au.feathery.io/api/',
  productionEU: 'https://api-eu.feathery.io/api/',
  productionCA: 'https://api-ca.feathery.io/api/'
};

const CDN_URL_OPTIONS = {
  local: 'http://localhost:8006/api/',
  staging: 'https://staging.feathery.io/api/',
  production: 'https://cdn.feathery.io/api/',
  productionAU: 'https://cdn-au.feathery.io/api/',
  productionEU: 'https://cdn-eu.feathery.io/api/',
  productionCA: 'https://cdn-ca.feathery.io/api/'
};

const STATIC_URL_OPTIONS = {
  local: 'http://localhost:8006/api/',
  staging: 'https://staging.feathery.io/api/',
  production: 'https://api-static-2.feathery.io/api/',
  productionAU: 'https://api-au.feathery.io/api/',
  productionEU: 'https://api-eu.feathery.io/api/',
  productionCA: 'https://api-ca.feathery.io/api/'
};

type URL_ENUM = keyof typeof API_URL_OPTIONS;
let environment: URL_ENUM = 'production';
try {
  environment = (process.env.BACKEND_ENV || 'production') as URL_ENUM;
} catch (e) {} // process.env won't exist in production build

export let API_URL = API_URL_OPTIONS[environment];
export let CDN_URL = CDN_URL_OPTIONS[environment];
export let STATIC_URL = STATIC_URL_OPTIONS[environment];

export const updateRegionApiUrls = (region: string) => {
  if (region === 'au') {
    CDN_URL = CDN_URL_OPTIONS.productionAU;
    API_URL = API_URL_OPTIONS.productionAU;
    STATIC_URL = STATIC_URL_OPTIONS.productionAU;
  } else if (region === 'eu') {
    CDN_URL = CDN_URL_OPTIONS.productionEU;
    API_URL = API_URL_OPTIONS.productionEU;
    STATIC_URL = STATIC_URL_OPTIONS.productionEU;
  } else if (region === 'ca') {
    CDN_URL = CDN_URL_OPTIONS.productionCA;
    API_URL = API_URL_OPTIONS.productionCA;
    STATIC_URL = STATIC_URL_OPTIONS.productionCA;
  }
};

/**
 * The number of milliseconds waited until another submitCustom call
 */
const SUBMIT_CUSTOM_DEBOUNCE_WINDOW = 1000;

export default class FeatheryClient extends IntegrationClient {
  /**
   * Used to aggregate field value updates for sucessive calls to
   * submitCustom within the debounce window
   */
  pendingCustomFieldUpdates: { [key: string]: any };

  /**
   * Debounced implementation of submitCustom
   */
  debouncedSubmitCustom: DebouncedFunc<(override: boolean) => Promise<void>>;

  constructor(
    formKey = '',
    ignoreNetworkErrors?: any,
    draft = false,
    bypassCDN = false
  ) {
    super(formKey, ignoreNetworkErrors, draft, bypassCDN);
    this.pendingCustomFieldUpdates = {};
    this.debouncedSubmitCustom = debounce(
      this._debouncedSubmitCustom.bind(this),
      SUBMIT_CUSTOM_DEBOUNCE_WINDOW
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
    const resolveFile = async (file: any, index = null) => {
      let path = filePathMap[servar.key];
      if (path && index !== null) path = path[index];
      return path ?? (await file);
    };
    return Array.isArray(fileValue)
      ? // @ts-expect-error TS(2345): Argument of type '(file: any, index?: null) => Pro... Remove this comment to see the full error message
        Promise.all(fileValue.map(resolveFile))
      : resolveFile(fileValue);
  }

  async _submitFileData(servar: any, stepKey: string) {
    const { userId } = initInfo();
    const url = `${API_URL}panel/step/submit/file/${userId}/`;

    const formData = new FormData();
    const fileValue = await this._getFileValue(servar);

    if (fileValue) {
      if (Array.isArray(fileValue)) {
        fileValue
          .filter((file) => !!file)
          .forEach((file) => formData.append(servar.key, file));
      } else {
        formData.append(servar.key, fileValue);
      }
    }

    formData.set('__feathery_form_key', this.formKey);
    formData.set('__feathery_step_key', stepKey);
    if (this.version) formData.set('__feathery_version', this.version);

    const options: RequestOptions = {
      method: 'POST',
      body: formData,
      // In Safari, request fails with keepalive = true if over 64kb payload.
      keepalive: false
    };

    return this.offlineRequestHandler.runOrSaveRequest(
      () => this._fetch(url, options, true, true),
      url,
      options,
      'submit',
      stepKey
    );
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
          fallback.hostname = 'user-files-1.s3.us-west-1.amazonaws.com';
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
    if (!formLanguage && this.formKey in formSchemas)
      return Promise.resolve(formSchemas[this.formKey]);

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

      const res = await response.json();
      if (res.data) {
        res.steps = getABVariant(res);
        delete res.data;
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
    if (authState.authId) params.auth_id = authState.authId;
    if (noData) params.no_data = 'true';
    // @ts-expect-error TS(2322): Type 'string' is not assignable to type '{ form_ke... Remove this comment to see the full error message
    params = encodeGetParams(params);
    const url = `${API_URL}panel/session/v2/?${params}`;
    const options = { importance: 'high' };

    const response = await this._fetch(url, options);
    if (!response) return [];

    const session = await response.json().catch((reason) => {
      throw new Error(
        reason + ' ' + userId + ' ' + this.formKey + response.status
      );
    });

    // Turn form off if invalid collaborator for submission
    if (session.collaborator?.invalid || session.collaborator?.completed)
      // will cause form to be disabled
      return [{ collaborator: session.collaborator }];

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
      body: formData
    };

    // Here we can safely remove the listener because offlineRequestHandler has its own beforeunload
    this._removeCustomFieldListener();
    return await this.offlineRequestHandler.runOrSaveRequest(
      () => this._fetch(url, options, true, true),
      url,
      options,
      'submit'
    );
  }

  /**
   * If there is a pending invocation of submitCustom, this method calls it immediately
   */
  flushCustomFields(override = true) {
    // we call the debounced method and then flush() to immediately submit changes
    // see: https://github.com/lodash/lodash/issues/4185#issuecomment-462388355
    this.debouncedSubmitCustom(override);
    return this.debouncedSubmitCustom.flush();
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
    this.submitQueue = Promise.all([
      this.submitQueue,
      this.submitCustom(hiddenFields, { shouldFlush: true }),
      this._submitJSONData(jsonServars, step.key, hasNext),
      ...fileServars.map((servar: any) =>
        this._submitFileData(servar, step.key)
      )
    ]);
    return this.submitQueue;
  }

  async registerEvent(eventData: any) {
    if (this.draft) return;

    await initFormsPromise;

    const { userId, collaboratorId } = initInfo();

    const url = `${API_URL}event/`;
    const data: Record<string, string> = {
      form_key: this.formKey,
      ...eventData,
      ...(userId ? { fuser_key: userId } : {})
    };
    if (collaboratorId) data.collaborator_user = collaboratorId;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };

    let prom = null;
    let stepKey;
    if (eventData.event === 'load') {
      stepKey = eventData.previous_step_key;
    } else {
      stepKey = eventData.step_key;
      prom = this.flushCustomFields();
    }
    return Promise.all([
      prom,
      this.offlineRequestHandler.runOrSaveRequest(
        // Ensure events complete before user exits page. Submit and load event of
        // next step must happen after the previous step is done submitting
        () =>
          this.submitQueue.then(() => this._fetch(url, options, true, true)),
        url,
        options,
        'registerEvent',
        stepKey
      )
    ]);
  }

  // Logic custom APIs
  runCustomRequest(
    payload:
      | string
      | {
          method: string;
          url: string;
          data: Record<string, any> | any[];
          headers: Record<string, string>;
        },
    fieldValues: { [key: string]: any } | null = null
  ) {
    const { userId } = initInfo();
    const data: any = {
      fuser_key: userId,
      form_key: this.formKey
    };

    if (typeof payload === 'string') {
      data.name = payload;
    } else {
      data.method = payload.method;
      data.url = payload.url;
      data.user_data = payload.data;
      data.headers = payload.headers;
    }

    if (fieldValues) {
      data.field_values = fieldValues;
    }

    const url = `${STATIC_URL}custom_request/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };

    const run = () =>
      this._fetch(url, options).then((response) =>
        response ? response.json() : Promise.resolve()
      );
    if (typeof payload !== 'string' && payload.method === 'GET') {
      return run();
    }
    return this.offlineRequestHandler.runOrSaveRequest(
      run,
      url,
      options,
      'customRequest'
    );
  }

  // AI
  extractAIDocument(extractionId: string, runAsync: boolean) {
    const { userId } = initInfo();
    const data = {
      fuser_key: userId,
      extraction_id: extractionId
    };

    this._fetch(`${STATIC_URL}ai/vision/`, {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    });

    return new Promise((resolve) => {
      const CHECK_INTERVAL = 2000;
      const MAX_TIME = 3 * 60 * 1000;
      const MAX_ATTEMPTS = MAX_TIME / CHECK_INTERVAL;
      let attempts = 0;

      if (runAsync) {
        return resolve({});
      }

      const checkCompletion = async () => {
        const response = await this._fetch(
          `${STATIC_URL}ai/vision/completion/?fid=${userId}&eid=${extractionId}`,
          { method: 'GET' }
        );

        if (response && response.ok) {
          const data = await response.json();

          if (data.status === 'complete') {
            return resolve(data.data);
          } else {
            attempts += 1;

            if (attempts < MAX_ATTEMPTS) {
              setTimeout(checkCompletion, CHECK_INTERVAL);
            } else {
              console.warn('Extraction took too long...');
              return resolve({});
            }
          }
        }
      };

      setTimeout(checkCompletion, CHECK_INTERVAL); // Check every 2 seconds for a response
    });
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
    return this._fetch(url, {}).then((response) =>
      response ? response.json() : Promise.resolve()
    );
  }

  async inviteCollaborator(usersGroups: string, templateId: string) {
    const { userId, collaboratorId } = initInfo();
    const data: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      users_groups: usersGroups,
      template_id: templateId
    };
    if (collaboratorId) data.collaborator_user = collaboratorId;
    const url = `${API_URL}collaborator/invite/`;
    return this._fetch(
      url,
      {
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify(data)
      },
      false
    ).then(async (response) => {
      if (response) {
        if (response.ok) return await response.json();
        else throw Error(parseError(await response.json()));
      }
    });
  }

  async rewindCollaboration(templateId: string) {
    const { userId } = initInfo();
    const data: Record<string, any> = {
      form_key: this.formKey,
      fuser_key: userId,
      template_id: templateId
    };
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
        else throw Error(parseError(await response.json()));
      }
    });
  }
}
