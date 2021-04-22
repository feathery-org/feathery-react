import * as errors from './error';
import { initInfo } from './init';
import encodeGetParams from './string';

export default class Client {
    constructor(formKey) {
        this.formKey = formKey;
    }

    async fetchForm() {
        const { apiKey } = initInfo();
        const params = encodeGetParams({
            form_key: this.formKey
        });
        const url = `https://cdn.feathery.tech/api/panel/?${params}`;
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
        const { apiKey, userKey } = initInfo();
        const params = encodeGetParams({
            form_key: this.formKey,
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

    // servars = [{key: <servarKey>, <type>: <value>}]
    submitStep(servars) {
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

    registerEvent(stepNumber, event) {
        const { userKey, apiKey } = initInfo();
        const url = `https://api.feathery.tech/api/event/`;
        const data = {
            form_key: this.formKey,
            step_number: stepNumber,
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
    }
}
