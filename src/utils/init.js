import Client from './client';

import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import * as errors from './error';

const fpPromise = FingerprintJS.load();
let initUserPromise = Promise.resolve();
const defaultOptions = {
    userKey: null,
    formKeys: [],
    tracking: 'cookie'
};
const initState = {
    initialized: false,
    apiKey: '',
    userKey: '',
    authId: '',
    authToken: '',
    authEmail: '',
    authPhoneNumber: '',
    forms: {},
    sessions: {}
};

function init(apiKey, options = {}) {
    options = { ...defaultOptions, ...options };

    if (initState.initialized) return; // can only be initialized one time per load
    initState.initialized = true;

    if (!apiKey || typeof apiKey !== 'string') {
        throw new errors.APIKeyError('Invalid API Key');
    }
    if (options.userKey && typeof options.userKey !== 'string') {
        throw new errors.UserKeyError();
    }

    initState.apiKey = apiKey;
    ['authId', 'authToken', 'authEmail', 'authPhoneNumber', 'userKey'].forEach(
        (key) => {
            if (options[key]) initState[key] = options[key];
        }
    );

    if (initState.userKey) _fetchFormData(options.formKeys);
    else {
        if (options.tracking === 'fingerprint') {
            initUserPromise = fpPromise
                .then((fp) => fp.get())
                .then((result) => {
                    initState.userKey = result.visitorId;
                    _fetchFormData(options.formKeys);
                });
        } else if (options.tracking === 'cookie') {
            document.cookie.split(/; */).map((c) => {
                const [key, v] = c.split('=', 2);
                if (key === 'feathery-user-id') initState.userKey = v;
            });

            if (!initState.userKey) initState.userKey = uuidv4();
            document.cookie = `feathery-user-id=${initState.userKey}; max-age=31536000`;
            _fetchFormData(options.formKeys);
        }
    }
}

// must be called after userKey loads
function _fetchFormData(formKeys) {
    formKeys.forEach((key) => {
        const formClient = new Client(key);
        formClient.fetchForm().then((stepsResponse) => {
            initState.forms[key] = stepsResponse;
        });
        formClient.fetchSession().then((session) => {
            initState.sessions[key] = session;
        });
    });
}

function initInfo() {
    const { apiKey } = initState;
    if (apiKey === '') throw new errors.APIKeyError('API key has not been set');
    return initState;
}

export { init, initInfo, initState, initUserPromise };
