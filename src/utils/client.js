import * as errors from './error';
import { initInfo } from './init';
import encodeGetParams from './string';

export default class Client {
    async begin(formKey) {
        const { userKey, apiKey } = initInfo();
        const params = encodeGetParams({
            flow_key: formKey,
            ...(userKey ? { fuser_key: userKey } : {})
        });
        const url = `https://api.feathery.tech/api/panel/step/?${params}`;
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
                        new errors.UserKeyError('Invalid User key')
                    );
                default:
                    return Promise.reject(
                        new errors.FetchError('Unknown error')
                    );
            }
        });
    }

    async submitStep(formKey, stepNum, servars, action) {
        // servars = [{key: <servarKey>, <type>: <value>}]
        const { userKey, apiKey } = initInfo();
        const url = `https://api.feathery.tech/api/panel/step/submit/`;
        const data = {
            ...(userKey ? { fuser_key: userKey } : {}),
            flow_key: formKey,
            step_number: stepNum,
            servars: action === 'next' ? servars : [],
            action
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
