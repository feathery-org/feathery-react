import Client from './client';

import FingerprintJS from '@fingerprintjs/fingerprintjs';
import { v4 as uuidv4 } from 'uuid';

import * as errors from './error';
import TagManager from 'react-gtm-module';
import $script from 'scriptjs';

const fpPromise = FingerprintJS.load();
let initFormsPromise = Promise.resolve();
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

    if (initState.userKey) initFormsPromise = _fetchFormData(options.formKeys);
    else {
        if (options.tracking === 'fingerprint') {
            initFormsPromise = fpPromise
                .then((fp) => fp.get())
                .then(async (result) => {
                    initState.userKey = result.visitorId;
                    await _fetchFormData(options.formKeys);
                });
        } else if (options.tracking === 'cookie') {
            document.cookie.split(/; */).map((c) => {
                const [key, v] = c.split('=', 2);
                if (key === 'feathery-user-id') initState.userKey = v;
            });

            if (!initState.userKey) initState.userKey = uuidv4();
            document.cookie = `feathery-user-id=${initState.userKey}; max-age=31536000`;
            initFormsPromise = _fetchFormData(options.formKeys);
        }
    }
    return initFormsPromise;
}

function dynamicImport(dependency) {
    return new Promise((resolve) => {
        $script(dependency, resolve);
    });
}

const initializeIntegrations = async (
    integrations,
    clientArg,
    init = false
) => {
    const gtm = integrations['google-tag-manager'];
    if (gtm && !TagManager.initialized) {
        TagManager.initialized = true;
        TagManager.initialize({
            gtmId: gtm.api_key,
            dataLayer: { userId: initState.userKey }
        });
    }

    const fb = integrations.firebase;
    if (fb) {
        const firebase = await new Promise((resolve) => {
            if (global.firebase) resolve(global.firebase);
            else {
                // Bring in Firebase dependencies dynamically if this form uses Firebase
                return dynamicImport([
                    'https://www.gstatic.com/firebasejs/8.7.1/firebase-app.js',
                    'https://www.gstatic.com/firebasejs/8.7.1/firebase-auth.js'
                ]).then(() => {
                    global.firebase.initializeApp({
                        apiKey: fb.api_key,
                        authDomain: `${fb.metadata.project_id}.firebaseapp.com`,
                        databaseURL: `https://${fb.metadata.project_id}.firebaseio.com`,
                        projectId: fb.metadata.project_id,
                        storageBucket: `${fb.metadata.project_id}.appspot.com`,
                        messagingSenderId: fb.metadata.sender_id,
                        appId: fb.metadata.app_id
                    });
                    resolve(global.firebase);
                });
            }
        });

        if (
            !init &&
            firebase.auth().isSignInWithEmailLink(window.location.href)
        ) {
            const authEmail = window.localStorage.getItem(
                'featheryFirebaseEmail'
            );
            if (authEmail) {
                return firebase
                    .auth()
                    .signInWithEmailLink(authEmail, window.location.href)
                    .then(async (result) => {
                        const authToken = await result.user.getIdToken();
                        return await clientArg
                            .submitAuthInfo({
                                authId: result.user.uid,
                                authToken,
                                authEmail
                            })
                            .then((session) => {
                                return session;
                            });
                    });
            }
        }
    }
};

// must be called after userKey loads
async function _fetchFormData(formKeys) {
    await Promise.all(
        formKeys.map((key) => {
            const formClient = new Client(key);
            const fp = formClient.fetchForm().then((stepsResponse) => {
                initState.forms[key] = stepsResponse;
            });
            return formClient.fetchSession().then(async (session) => {
                initState.sessions[key] = session;
                await initializeIntegrations(
                    session.integrations,
                    formClient,
                    true
                );
                await fp;
            });
        })
    );
}

function initInfo() {
    const { apiKey } = initState;
    if (apiKey === '') throw new errors.APIKeyError('API key has not been set');
    return initState;
}

export { init, initInfo, initializeIntegrations, initState, initFormsPromise };
