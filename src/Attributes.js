import * as errors from './utils/error';
import { initInfo, keyError } from './utils/init';

const attributeState = {
    loaded: false,
    attributes: null,
    realTimeAttributes: {}
};

function _allAttributes() {
    return {
        ...attributeState.attributes,
        ...attributeState.realTimeAttributes
    };
}

function fetchAttributes() {
    const err = keyError();
    if (err) return Promise.reject(err);
    if (attributeState.attributes) return Promise.resolve(_allAttributes());

    const { userKey, sdkKey } = initInfo();
    const url = `https://api.feathery.tech/external/fuser/?fuser_key=${encodeURIComponent(
        userKey
    )}`;
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
            attributeState.attributes = json.reduce(function (map, attr) {
                map[attr.key] = attr.value;
                return map;
            }, {});
            return _allAttributes();
        });
}

export { fetchAttributes, attributeState };
