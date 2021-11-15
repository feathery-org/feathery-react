import * as errors from './error';

import { initFormsPromise, initInfo, initState } from './init';

import { encodeGetParams } from './primitives';

// Convenience boolean for urls - manually change for testing
const isLocal = false;
export const API_URL = isLocal
  ? 'http://localhost:8006/api/'
  : 'https://api.feathery.io/api/';
export const CDN_URL = isLocal
  ? 'http://localhost:8006/api/'
  : 'https://cdn.feathery.io/api/';

export default class Client {
  constructor(formKey) {
    this.formKey = formKey;
  }

  _checkResponseSuccess(response) {
    switch (response.status) {
      case 200:
        return;
      case 201:
        return;
      case 400:
        throw new errors.FetchError('Invalid parameters');
      case 401:
        throw new errors.FetchError('Invalid API key');
      case 404:
        throw new errors.FetchError("Can't find object");
      case 500:
        throw new errors.FetchError('Internal server error');
      default:
        throw new errors.FetchError('Unknown error');
    }
  }

  async _fetch(url, options) {
    const { apiKey } = initInfo();
    const { headers, ...otherOptions } = options;
    options = {
      cache: 'no-store',
      headers: {
        Authorization: 'Token ' + apiKey,
        ...headers
      },
      ...otherOptions
    };
    return fetch(url, options).then((response) => {
      this._checkResponseSuccess(response);
      return response;
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

  async _getFileValue(servar, filePathMap) {
    let fileValue;
    if ('file_upload' in servar) {
      fileValue = servar.file_upload;
    } else if ('rich_file_upload' in servar) {
      fileValue = servar.rich_file_upload;
    } else if ('rich_multi_file_upload' in servar) {
      fileValue = servar.rich_multi_file_upload;
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

  async _submitFileData(servars, filePathMap) {
    const { userKey } = initInfo();
    const url = `${API_URL}panel/step/submit/file/${userKey}/`;

    const formData = new FormData();
    const files = await Promise.all(
      servars.map(async (servar) => {
        const file = await this._getFileValue(servar, filePathMap);
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

    return this._fetch(url, { method: 'POST', body: formData });
  }

  updateUserKey(newUserKey) {
    const { userKey: oldUserKey } = initInfo();
    const data = {
      new_fuser_key: newUserKey,
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

  async fetchForm() {
    await initFormsPromise;
    const { forms } = initInfo();
    if (this.formKey in forms) return Promise.resolve(forms[this.formKey]);

    const params = encodeGetParams({
      form_key: this.formKey
    });
    const url = `${CDN_URL}panel/v4/?${params}`;
    const options = {
      importance: 'high',
      headers: { 'Accept-Encoding': 'gzip' }
    };
    return this._fetch(url, options).then((response) => response.json());
  }

  async fetchSession() {
    await initFormsPromise;
    const { userKey, sessions, authId } = initInfo();
    if (this.formKey in sessions)
      return Promise.resolve(sessions[this.formKey]);

    const params = encodeGetParams({
      form_key: this.formKey,
      ...(userKey ? { fuser_key: userKey } : {}),
      ...(authId ? { auth_id: authId } : {})
    });
    const url = `${API_URL}panel/session/?${params}`;
    const options = { importance: 'high' };
    return this._fetch(url, options).then((response) => response.json());
  }

  submitAuthInfo({ authId, authToken = '', authPhone = '', authEmail = '' }) {
    const { userKey } = initInfo();

    const data = {
      form_key: this.formKey,
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
    return this._fetch(url, options).then(async (response) => {
      initState.authId = authId;
      if (authToken) initState.authToken = authToken;
      if (authPhone) initState.authPhoneNumber = authPhone;
      if (authEmail) initState.authEmail = authEmail;
      return response.json();
    });
  }

  submitCustom(customKeyValues) {
    const { userKey } = initInfo();
    const url = `${API_URL}panel/custom/submit/v2/`;

    const jsonKeyVals = {};
    const formData = new FormData();
    Object.entries(customKeyValues).forEach(([key, val]) => {
      if (val instanceof Blob) {
        formData.append('files', val);
        formData.append('file_keys', key);
      } else {
        jsonKeyVals[key] = val;
      }
    });
    formData.set('custom_key_values', JSON.stringify(jsonKeyVals));
    formData.set('form_key', this.formKey);
    if (userKey) formData.set('fuser_key', userKey);

    return this._fetch(url, { method: 'POST', body: formData });
  }

  // servars = [{key: <servarKey>, <type>: <value>}]
  async submitStep(servars, filePathMap) {
    const isFileServar = (servar) =>
      [
        'file_upload',
        'rich_file_upload',
        'rich_multi_file_upload',
        'signature'
      ].some((type) => type in servar);
    const jsonServars = servars.filter((servar) => !isFileServar(servar));
    const jsonPromise = this._submitJSONData(jsonServars);
    const fileServars = servars.filter(isFileServar);

    if (fileServars.length > 0)
      await this._submitFileData(fileServars, filePathMap);
    await jsonPromise;
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
}
