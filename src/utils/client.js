import * as errors from './error';
import { initInfo } from './init';
import encodeGetParams from './string';

export default class Client {
    async fetchForm(formKey) {
        // TODO: fetch from CDN
        const { apiKey } = initInfo();
        const params = encodeGetParams({
            form_key: formKey
        });
        const url = `https://api.feathery.tech/api/panel/?${params}`;
        const options = {
            cache: 'no-store',
            headers: { Authorization: 'Token ' + apiKey }
        };
        return fetch(url, options).then((response) => {
            const { status } = response;
            switch (status) {
                case 200:
                    return response.json();
                case 401:
                    return Promise.reject(
                        new errors.APIKeyError('Invalid API key')
                    );
                case 404:
                    return Promise.reject(
                        new errors.FormKeyError('Invalid form key')
                    );
                default:
                    return Promise.reject(
                        new errors.FetchError('Unknown error')
                    );
            }
        });
    }

    async fetchFormValues(formKey) {
        const { apiKey, userKey } = initInfo();
        const params = encodeGetParams({
            form_key: formKey,
            ...(userKey ? { fuser_key: userKey } : {})
        });
        const url = `https://api.feathery.tech/api/panel/values/?${params}`;
        const options = {
            cache: 'no-store',
            headers: { Authorization: 'Token ' + apiKey }
        };
        return fetch(url, options).then((response) => {
            const { status } = response;
            switch (status) {
                case 200:
                    return response.json();
                case 401:
                    return Promise.reject(
                        new errors.APIKeyError('Invalid API key')
                    );
                case 404:
                    return Promise.reject(
                        new errors.FormKeyError('Invalid form key')
                    );
                default:
                    return Promise.reject(
                        new errors.FetchError('Unknown error')
                    );
            }
        });
    }

    async submitStep(servars) {
        // servars = [{key: <servarKey>, <type>: <value>}]
        const { userKey, apiKey } = initInfo();
        const url = `https://api.feathery.tech/api/panel/step/submit/`;
        const data = {
            ...(userKey ? { fuser_key: userKey } : {}),
            servars
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
            const { status } = response;
            switch (status) {
                case 200:
                    return response.json();
                case 201:
                    return response.json();
                case 401:
                    return Promise.reject(
                        new errors.APIKeyError('Invalid API key')
                    );
                case 404:
                    return Promise.reject(
                        new errors.UserKeyError('Invalid User key')
                    );
                default:
                    return Promise.reject(
                        new errors.FetchError('Unknown error')
                    );
            }
        });
    }
}
