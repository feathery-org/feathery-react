import Client from './client';

import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import * as errors from './error';

const fpPromise = FingerprintJS.load();
let initUserPromise = Promise.resolve();
let initialized = false;
const initState = { apiKey: null, userKey: null, forms: {}, sessions: {} };

function init(apiKey, userKey = null, formKeys = []) {
    if (initialized) return; // can only be initialized one time per load
    initialized = true;

    if (!apiKey || typeof apiKey !== 'string') {
        throw new errors.APIKeyError('Invalid API Key');
    }
    if (userKey && typeof userKey !== 'string') {
        throw new errors.UserKeyError('Invalid User Key');
    }

    initState.apiKey = apiKey;
    initState.userKey = userKey;
    if (!initState.userKey) {
        initUserPromise = fpPromise
            .then((fp) => fp.get())
            .then((result) => {
                initState.userKey = result.visitorId;
                if (!initState.userKey) initState.userKey = uuidv4();
                // must call after userKey loads
                _fetchFormData(formKeys);
            });
    } else {
        // must call after userKey loads
        _fetchFormData(formKeys);
    }
}

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
    if (apiKey === null)
        throw new errors.APIKeyError('API key has not been set');
    return initState;
}

export { init, initInfo, initUserPromise };
