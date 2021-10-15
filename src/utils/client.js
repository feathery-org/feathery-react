import * as errors from './error';

import { initInfo, initState, initFormsPromise } from './init';

import { encodeGetParams } from './primitives';

// Convenience boolean for urls - manually change for testing
const isLocal = false;
export const API_URL = isLocal
    ? 'http://localhost:8006/'
    : 'https://api.feathery.io/';
export const CDN_URL = isLocal
    ? 'http://localhost:8006/'
    : 'https://cdn.feathery.io/';

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

    updateUserKey(newUserKey) {
        const { apiKey, userKey: oldUserKey } = initInfo();
        const data = {
            new_fuser_key: newUserKey,
            ...(oldUserKey ? { fuser_key: oldUserKey } : {})
        };
        const url = `${API_URL}api/fuser/update_key/`;
        const options = {
            cache: 'no-store',
            headers: {
                Authorization: 'Token ' + apiKey,
                'Content-Type': 'application/json'
            },
            method: 'PATCH',
            body: JSON.stringify(data)
        };
        return fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
        });
    }

    async fetchForm() {
        await initFormsPromise;
        const { apiKey, forms } = initInfo();
        if (this.formKey in forms) return Promise.resolve(forms[this.formKey]);

        const params = encodeGetParams({
            form_key: this.formKey
        });
        const url = `${CDN_URL}api/panel/v4/?${params}`;
        const options = {
            cache: 'no-store',
            importance: 'high',
            headers: {
                Authorization: 'Token ' + apiKey,
                'Accept-Encoding': 'gzip'
            }
        };
        return fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
            return response.json();
        });
    }

    async fetchSession() {
        await initFormsPromise;
        const { apiKey, userKey, sessions } = initInfo();
        if (this.formKey in sessions)
            return Promise.resolve(sessions[this.formKey]);

        const params = encodeGetParams({
            form_key: this.formKey,
            ...(userKey ? { fuser_key: userKey } : {})
        });
        const url = `${API_URL}api/panel/session/?${params}`;
        const options = {
            cache: 'no-store',
            importance: 'high',
            headers: { Authorization: 'Token ' + apiKey }
        };
        return fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
            return response.json();
        });
    }

    submitAuthInfo({ authId, authToken = '', authPhone = '', authEmail = '' }) {
        const { apiKey, userKey } = initInfo();

        const data = {
            form_key: this.formKey,
            panel_key: this.formKey,
            auth_id: authId,
            auth_phone: authPhone,
            auth_email: authEmail,
            ...(userKey ? { fuser_key: userKey } : {})
        };
        const url = `${API_URL}api/panel/update_auth/`;
        const options = {
            cache: 'no-store',
            headers: {
                Authorization: 'Token ' + apiKey,
                'Content-Type': 'application/json'
            },
            method: 'PATCH',
            body: JSON.stringify(data)
        };
        return fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
            initState.authId = authId;
            if (authToken) initState.authToken = authToken;
            if (authPhone) initState.authPhoneNumber = authPhone;
            if (authEmail) initState.authEmail = authEmail;
            return response.json();
        });
    }

    submitCustom(customKeyValues) {
        const { userKey, apiKey } = initInfo();
        const url = `${API_URL}api/panel/custom/submit/`;
        const data = {
            ...(userKey ? { fuser_key: userKey } : {}),
            custom_key_values: customKeyValues,
            form_key: this.formKey
        };
        const options = {
            cache: 'no-store',
            headers: {
                Authorization: 'Token ' + apiKey,
                'Content-Type': 'application/json'
            },
            method: 'POST',
            body: JSON.stringify(data)
        };
        fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
        });
    }

    _submitJSONData(servars) {
        const { userKey, apiKey } = initInfo();
        const url = `${API_URL}api/panel/step/submit/`;
        const data = {
            ...(userKey ? { fuser_key: userKey } : {}),
            servars,
            panel_key: this.formKey
        };
        const options = {
            cache: 'no-store',
            headers: {
                Authorization: 'Token ' + apiKey,
                'Content-Type': 'application/json'
            },
            method: 'POST',
            body: JSON.stringify(data)
        };
        return fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
        });
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
        const { userKey, apiKey } = initInfo();
        const url = `${API_URL}api/panel/step/submit/file/${userKey}/`;

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
                    fileValue.forEach((file) => formData.append(key, file));
                } else {
                    formData.append(key, fileValue);
                }
            }
        });

        const options = {
            cache: 'no-store',
            headers: {
                Authorization: 'Token ' + apiKey
            },
            method: 'POST',
            body: formData
        };
        return fetch(url, options).then((response) => {
            this._checkResponseSuccess(response);
        });
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

    registerEvent(eventData, promise = null) {
        return initFormsPromise.then(() => {
            const { userKey, apiKey } = initInfo();
            const url = `${API_URL}api/event/`;
            const data = {
                form_key: this.formKey,
                ...eventData,
                ...(userKey ? { fuser_key: userKey } : {})
            };
            const options = {
                cache: 'no-store',
                headers: {
                    Authorization: 'Token ' + apiKey,
                    'Content-Type': 'application/json'
                },
                method: 'POST',
                body: JSON.stringify(data)
            };
            if (promise) {
                promise.then(() => {
                    fetch(url, options).then((response) => {
                        this._checkResponseSuccess(response);
                    });
                });
            } else {
                fetch(url, options).then((response) => {
                    this._checkResponseSuccess(response);
                });
            }
        });
    }
}
