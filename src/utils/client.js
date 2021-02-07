import * as errors from './error';
import { initInfo } from './init';
import encodeGetParams from './string';

export default class Client {
    constructor(companyKey) {
        Client.validateKeys(companyKey);
        this._companyKey = companyKey;
    }

    static validateKeys(companyKey) {
        if (!companyKey || typeof companyKey !== 'string') {
            throw new errors.CompanyKeyError('Invalid Company Key');
        }
    }

    async begin(formKey) {
        const { userKey, sdkKey } = initInfo();
        const { _companyKey: companyKey } = this;
        const params = encodeGetParams({
            flow_key: formKey,
            fuser_key: userKey,
            company_key: companyKey
        });
        const url = `https://api.feathery.tech/api/panel/step/?${params}`;
        const options = {
            cache: 'no-store',
            headers: { Authorization: 'Token ' + sdkKey }
        };
        return fetch(url, options)
            .then((response) => {
                const { status } = response;
                switch (status) {
                    case 200:
                        return response.json();
                    case 401:
                        return Promise.reject(
                            new errors.SdkKeyError('Invalid SDK key')
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
            })
            .catch((error) => {
                throw error instanceof TypeError
                    ? new errors.FetchError('Could not connect to the server')
                    : error;
            });
    }

    async submitStep(formKey, stepNum, servars, skip = false) {
        // servars = [{key: <servarKey>, <type>: <value>}]
        const { userKey, sdkKey } = initInfo();
        const url = `https://api.feathery.tech/api/panel/step/submit/`;
        const data = {
            flow_key: formKey,
            fuser_key: userKey,
            step_number: stepNum,
            servars: skip ? [] : servars,
            skip
        };
        const options = {
            cache: 'no-store',
            headers: {
                Authorization: 'Token ' + sdkKey,
                'Content-Type': 'application/json'
            },
            method: 'POST',
            body: JSON.stringify(data)
        };
        return fetch(url, options)
            .then((response) => {
                const { status } = response;
                switch (status) {
                    case 200:
                        return response.json();
                    case 201:
                        return response.json();
                    case 401:
                        return Promise.reject(
                            new errors.SdkKeyError('Invalid SDK key')
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
            })
            .catch((error) => {
                throw error instanceof TypeError
                    ? new errors.FetchError('Could not connect to the server')
                    : error;
            });
    }
}
