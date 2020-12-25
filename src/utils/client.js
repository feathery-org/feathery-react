import * as errors from './error';
import encodeGetParams from './string';

export default class Client {
    constructor(sdkKey, userKey, companyKey) {
        Client.validateKeys(sdkKey, userKey, companyKey);
        this._sdkKey = sdkKey;
        this._userKey = userKey;
        this._companyKey = companyKey;
    }

    static validateKeys(sdkKey, userKey, companyKey) {
        if (!sdkKey || typeof sdkKey !== 'string') {
            throw new errors.SdkKeyError('Invalid SDK Key');
        }
        if (!userKey || typeof userKey !== 'string') {
            throw new errors.UserKeyError('Invalid User Key');
        }
        if (!companyKey || typeof companyKey !== 'string') {
            throw new errors.CompanyKeyError('Invalid User Key');
        }
    }

    async begin() {
        const {
            _userKey: userKey,
            _sdkKey: sdkKey,
            _companyKey: companyKey
        } = this;
        Client.validateKeys(userKey, sdkKey, companyKey);
        const params = encodeGetParams({
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

    async submitStep(stepNum, servars, skip = false) {
        // servars = [{key: <servarKey>, <type>: <value>}]
        const {
            _userKey: userKey,
            _sdkKey: sdkKey,
            _companyKey: companyKey
        } = this;
        Client.validateKeys(userKey, sdkKey, companyKey);
        const url = `https://api.feathery.tech/api/panel/step/submit/`;
        const data = {
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
