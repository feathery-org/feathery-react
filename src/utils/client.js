import * as errors from './error';
import { initInfo, initUserPromise } from './init';
import encodeGetParams from './string';

const API_URL = 'https://api.feathery.tech/';
const CDN_URL = 'https://cdn.feathery.tech/';

export default class Client {
    constructor(formKey) {
        this.formKey = formKey;
    }

    async fetchForm() {
        const { apiKey } = initInfo();
        const params = encodeGetParams({
            form_key: this.formKey
        });
        const url = `${CDN_URL}api/panel/v3/?${params}`;
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

    async fetchFormValues() {
        await initUserPromise;
        const { apiKey, userKey } = initInfo();
        const params = encodeGetParams({
            form_key: this.formKey,
            ...(userKey ? { fuser_key: userKey } : {})
        });
        const url = `${API_URL}api/panel/values/?${params}`;
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

    // servars = [{key: <servarKey>, <type>: <value>}]
    submitStep(servars) {
        const { userKey, apiKey } = initInfo();
        const url = `${API_URL}api/panel/step/submit/`;
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
        fetch(url, options).then((response) => {
            const { status } = response;
            switch (status) {
                case 200:
                    return;
                case 201:
                    return;
                case 401:
                    throw new errors.APIKeyError('Invalid API key');
                case 404:
                    throw new errors.UserKeyError('Invalid user key');
                default:
                    throw new errors.FetchError('Unknown error');
            }
        });
    }

    registerEvent(stepKey, event) {
        initUserPromise.then(() => {
            const { userKey, apiKey } = initInfo();
            const url = `${API_URL}api/event/`;
            const data = {
                form_key: this.formKey,
                step_key: stepKey,
                event,
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
            fetch(url, options).then((response) => {
                const { status } = response;
                switch (status) {
                    case 200:
                        return;
                    case 201:
                        return;
                    case 401:
                        throw new errors.APIKeyError('Invalid API key');
                    case 404:
                        throw new errors.UserKeyError('Invalid user key');
                    default:
                        throw new errors.FetchError('Unknown error');
                }
            });
        });
    }
}
