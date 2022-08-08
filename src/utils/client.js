import * as errors from './error';
import {
  fieldValues,
  filePathMap,
  initFormsPromise,
  initInfo,
  initState
} from './init';
import { dataURLToFile, isBase64Image } from './image';
import { encodeGetParams } from './primitives';
import {
  getABVariant,
  getDefaultFieldValue,
  updateSessionValues
} from './formHelperFunctions';
import { initializeIntegrations } from '../integrations/utils';

// Convenience boolean for urls - manually change for testing
const API_URL_OPTIONS = {
  local: 'http://localhost:8006/api/',
  staging: 'https://staging.feathery.io/api/',
  production: 'https://api.feathery.io/api/'
};

const CDN_URL_OPTIONS = {
  local: 'http://localhost:8006/api/',
  staging: 'https://staging.feathery.io/api/',
  production: 'https://cdn.feathery.io/api/'
};

const environment = 'production';

export const API_URL = API_URL_OPTIONS[environment];
export const CDN_URL = CDN_URL_OPTIONS[environment];

export default class Client {
  constructor(formKey, ignoreNetworkErrors) {
    this.formKey = formKey;
    this.ignoreNetworkErrors = ignoreNetworkErrors;
  }

  async _checkResponseSuccess(response) {
    let payload;
    switch (response.status) {
      case 200:
      case 201:
        return;
      case 400:
        payload = JSON.stringify(await response.text());
        throw new errors.FetchError(`Invalid parameters: ${payload}`);
      case 401:
        throw new errors.SDKKeyError();
      case 404:
        throw new errors.FetchError("Can't find object");
      case 500:
        throw new errors.FetchError('Internal server error');
      default:
        throw new errors.FetchError('Unknown error');
    }
  }

  _fetch(url, options) {
    const { sdkKey } = initInfo();
    const { headers, ...otherOptions } = options;
    options = {
      cache: 'no-store',
      headers: {
        Authorization: 'Token ' + sdkKey,
        ...headers
      },
      ...otherOptions
    };
    return fetch(url, options)
      .then(async (response) => {
        await this._checkResponseSuccess(response);
        return response;
      })
      .catch((e) => {
        // Ignore TypeErrors if form has redirected because `fetch` in
        // Safari will error after redirect
        if (this.ignoreNetworkErrors && e instanceof TypeError) return;
        throw e;
      });
  }

  _submitJSONData(servars) {
    const { userKey } = initInfo();
    const url = `${API_URL}panel/step/submit/`;
    const data = {
      ...(userKey ? { fuser_key: userKey } : {}),
      servars,
      panel_key: this.formKey
    };
    const options = {
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options);
  }

  async _getFileValue(servar) {
    let fileValue;
    if ('file_upload' in servar) {
      fileValue = servar.file_upload;
    } else if ('signature' in servar) {
      fileValue = servar.signature;
    }

    if (!fileValue) {
      return null;
    }

    // If we've already stored the file from a previous session
    // There will be an entry in filePathMap for it
    // If so we just need to send the S3 path to the backend, not the full file
    const resolveFile = async (file, index = null) => {
      let path = filePathMap[servar.key];
      if (path && index !== null) path = path[index];
      return path ?? (await file);
    };
    return Array.isArray(fileValue)
      ? Promise.all(fileValue.map(resolveFile))
      : resolveFile(fileValue);
  }

  async _submitFileData(servars) {
    const { userKey } = initInfo();
    const url = `${API_URL}panel/step/submit/file/${userKey}/`;

    const formData = new FormData();
    const files = await Promise.all(
      servars.map(async (servar) => {
        const file = await this._getFileValue(servar);
        return [servar.key, file];
      })
    );

    // Append files to the HTTP formData (and handle lists of files)
    files.forEach(([key, fileValue]) => {
      if (fileValue) {
        if (Array.isArray(fileValue)) {
          fileValue
            .filter((file) => !!file)
            .forEach((file) => formData.append(key, file));
        } else {
          formData.append(key, fileValue);
        }
      }
    });

    await this._fetch(url, { method: 'POST', body: formData });
  }

  updateUserKey(newUserKey, merge = false) {
    const { userKey: oldUserKey } = initInfo();
    const data = {
      new_fuser_key: newUserKey,
      merge,
      ...(oldUserKey ? { fuser_key: oldUserKey } : {})
    };
    const url = `${API_URL}fuser/update_key/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options);
  }

  setDefaultFormValues({ steps, additionalValues = {}, override = false }) {
    let values = {};
    steps.forEach((step) => {
      step.servar_fields.forEach((field) => {
        const { key, repeated, type } = field.servar;
        const val = getDefaultFieldValue(field);
        if (isBase64Image(additionalValues[key])) {
          // All base64 strings need to be wrapped in a File
          additionalValues[key] = dataURLToFile(
            additionalValues[key],
            `${key}.png`
          );
        }
        values[key] = repeated ? [val] : val;
        // Default value is null for file_upload, but value should always be an
        // array regardless if repeated or not
        if (type === 'file_upload') values[key] = [];
      });
    });
    values = { ...values, ...additionalValues };
    if (!override) values = { ...values, ...fieldValues };
    Object.assign(fieldValues, values);
  }

  fetchCacheForm() {
    const { forms } = initInfo();
    if (this.formKey in forms) return Promise.resolve(forms[this.formKey]);

    const params = encodeGetParams({
      form_key: this.formKey
    });
    const url = `${CDN_URL}panel/v7/?${params}`;
    const options = {
      importance: 'high',
      headers: { 'Accept-Encoding': 'gzip' }
    };
    return this._fetch(url, options).then((response) => response.json());
  }

  async fetchForm(initialValues) {
    const result = await this.fetchCacheForm();
    // If form is disabled, data will equal `null`
    if (!result.data) return [[], { formOff: true }];
    const steps = getABVariant(result);
    this.setDefaultFormValues({ steps, additionalValues: initialValues });
    this._loadFonts(result);
    return [steps, result];
  }

  _loadFonts(res) {
    // Load default fonts
    if (res.fonts.length && global.webfontloaderPromise) {
      global.webfontloaderPromise.then((WebFont) => {
        WebFont.load({ google: { families: res.fonts } });
      });
    }
    // Load user-uploaded fonts
    Object.entries(res.uploaded_fonts).forEach(([family, fontStyles]) => {
      fontStyles.forEach(({ source, style, weight }) =>
        new FontFace(family, `url(${source})`, { style, weight })
          .load()
          .then((font) => document.fonts.add(font))
      );
    });
  }

  async fetchSession(formPromise = null, block = false) {
    // Block if there's a chance user id isn't available yet
    await (block ? initFormsPromise : Promise.resolve());
    const {
      userKey,
      sessions,
      authId,
      fieldValuesInitialized: noData
    } = initInfo();
    const formData = await (formPromise ?? Promise.resolve());

    if (this.formKey in sessions) return [sessions[this.formKey], formData];

    initState.fieldValuesInitialized = true;
    let params = { form_key: this.formKey };
    if (userKey) params.fuser_key = userKey;
    if (authId) params.auth_id = authId;
    if (noData) params.no_data = 'true';
    params = encodeGetParams(params);
    const url = `${API_URL}panel/session/?${params}`;
    const options = { importance: 'high' };

    const response = await this._fetch(url, options);
    const session = await response.json();
    const authSession = await initializeIntegrations(
      session.integrations,
      this
    );
    if (!noData) updateSessionValues(authSession ?? session);
    return [session, formData];
  }

  submitAuthInfo({ authId, authPhone = '', authEmail = '' }) {
    const { userKey } = initInfo();
    initState.authId = authId;
    if (authPhone) initState.authPhoneNumber = authPhone;
    if (authEmail) initState.authEmail = authEmail;

    const data = {
      auth_id: authId,
      auth_phone: authPhone,
      auth_email: authEmail,
      ...(userKey ? { fuser_key: userKey } : {})
    };
    const url = `${API_URL}panel/update_auth/`;
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options).then((response) => {
      return response.json();
    });
  }

  async submitCustom(customKeyValues) {
    const { userKey } = initInfo();
    const url = `${API_URL}panel/custom/submit/v2/`;

    const jsonKeyVals = {};
    const formData = new FormData();
    const promiseResults = await Promise.all(
      Object.entries(customKeyValues).map(([key, val]) =>
        Promise.all([key, Promise.resolve(val)])
      )
    );
    promiseResults.forEach(([key, val]) => {
      if (val instanceof Blob) {
        // If you use val from customKeyValues instead of value from
        // promiseResults, the files don't actually save to the BE. Need to
        // resolve the promises for successful file upload.
        formData.append('files', val);
        formData.append('file_keys', key);
      } else {
        jsonKeyVals[key] = val;
      }
    });
    formData.set('custom_key_values', JSON.stringify(jsonKeyVals));
    if (this.formKey) formData.set('form_key', this.formKey);
    if (userKey) formData.set('fuser_key', userKey);

    return this._fetch(url, { method: 'POST', body: formData });
  }

  // servars = [{key: <servarKey>, <type>: <value>}]
  async submitStep(servars) {
    const isFileServar = (servar) =>
      ['file_upload', 'signature'].some((type) => type in servar);
    const jsonServars = servars.filter((servar) => !isFileServar(servar));
    const fileServars = servars.filter(isFileServar);

    const toAwait = [this._submitJSONData(jsonServars)];
    if (fileServars.length > 0) toAwait.push(this._submitFileData(fileServars));
    await Promise.all(toAwait);
  }

  async registerEvent(eventData, promise = null) {
    await initFormsPromise;
    const { userKey } = initInfo();
    const url = `${API_URL}event/`;
    const data = {
      form_key: this.formKey,
      ...eventData,
      ...(userKey ? { fuser_key: userKey } : {})
    };
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };
    if (promise) return promise.then(() => this._fetch(url, options));
    else return this._fetch(url, options);
  }

  // THIRD-PARTY INTEGRATIONS
  async fetchPlaidLinkToken() {
    await initFormsPromise;
    const { userKey } = initInfo();
    const params = encodeGetParams({
      form_key: this.formKey,
      ...(userKey ? { fuser_key: userKey } : {})
    });
    const url = `${API_URL}plaid/link_token/?${params}`;
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) => response.json());
  }

  async submitPlaidUserData(publicToken) {
    await initFormsPromise;
    const { userKey } = initInfo();
    const url = `${API_URL}plaid/user_data/`;
    const data = {
      public_token: publicToken,
      form_key: this.formKey,
      ...(userKey ? { fuser_key: userKey } : {})
    };
    const options = {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      body: JSON.stringify(data)
    };
    return this._fetch(url, options).then((response) => response.json());
  }

  addressSearchResults(searchTerm) {
    const params = encodeGetParams({ search_term: searchTerm });
    const url = `${API_URL}integration/address/search/?${params}`;
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) => response.json());
  }

  addressDetail(addressId) {
    const params = encodeGetParams({ address_id: addressId });
    const url = `${API_URL}integration/address/detail/?${params}`;
    const options = { headers: { 'Content-Type': 'application/json' } };
    return this._fetch(url, options).then((response) => response.json());
  }
}
