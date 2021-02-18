import * as errors from './utils/error';
import { initInfo, keyError } from './utils/init';

const fieldState = {
    loaded: false,
    fields: null,
    realTimeFields: {}
};

function _allFields() {
    const fieldUnion = {
        ...fieldState.fields,
        ...fieldState.realTimeFields
    };
    return Object.keys(fieldUnion).map((key) => {
        const { type, displayText, value } = fieldUnion[key];
        return { key, displayText, type, value };
    });
}

function fetchFields() {
    const err = keyError();
    if (err) return Promise.reject(err);
    if (fieldState.fields) return Promise.resolve(_allFields());

    const { userKey, apiKey } = initInfo();
    const url = `https://api.feathery.tech/external/fuser/?fuser_key=${encodeURIComponent(
        userKey
    )}`;
    const options = {
        cache: 'no-store',
        headers: { Authorization: 'Token ' + apiKey }
    };
    return fetch(url, options)
        .then((response) => {
            const { status } = response;
            switch (status) {
                case 200:
                    return response.json();
                case 401:
                    return Promise.reject(
                        new errors.APIKeyError('Invalid API key')
                    );
                case 404:
                    // User not available, which may be due to a race condition
                    // since the Div component triggers user creation
                    return Promise.resolve([]);
                default:
                    return Promise.reject(
                        new errors.FetchError('Unknown error')
                    );
            }
        })
        .then((json) => {
            fieldState.fields = json.reduce(function (map, attr) {
                map[attr.key] = {
                    value: attr.value,
                    displayText: attr.name,
                    type: attr.type
                };
                return map;
            }, {});
            return _allFields();
        });
}

export { fetchFields, fieldState };
