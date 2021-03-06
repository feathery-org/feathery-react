import * as errors from './error';

const initState = { apiKey: null, userKey: null };

function init(apiKey, userKey = null) {
    if (!apiKey || typeof apiKey !== 'string') {
        throw new errors.APIKeyError('Invalid API Key');
    }
    if (userKey && typeof userKey !== 'string') {
        throw new errors.UserKeyError('Invalid User Key');
    }

    initState.apiKey = apiKey;
    initState.userKey = userKey;
}

function keyError() {
    const { apiKey, userKey } = initState;
    if (!apiKey || typeof apiKey !== 'string') {
        return new errors.APIKeyError('Invalid API Key');
    }
    if (userKey && typeof userKey !== 'string') {
        return new errors.UserKeyError('Invalid User Key');
    }
    return null;
}

function initInfo() {
    const { apiKey } = initState;
    if (apiKey === null)
        throw new errors.APIKeyError('API key has not been set');
    return initState;
}

export { init, initInfo, keyError };
