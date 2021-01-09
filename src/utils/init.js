import * as errors from './error';

const initState = { sdkKey: null, userKey: null };

function init(sdkKey, userKey) {
    if (!sdkKey || typeof sdkKey !== 'string') {
        throw new errors.SdkKeyError('Invalid SDK Key');
    }
    if (!userKey || typeof userKey !== 'string') {
        throw new errors.UserKeyError('Invalid User Key');
    }

    initState.sdkKey = sdkKey;
    initState.userKey = userKey;
}

function keyError() {
    const { sdkKey, userKey } = initState;
    if (!sdkKey || typeof sdkKey !== 'string') {
        return new errors.SdkKeyError('Invalid SDK Key');
    }
    if (!userKey || typeof userKey !== 'string') {
        return new errors.UserKeyError('Invalid User Key');
    }
    return null;
}

function initInfo() {
    return initState;
}

export { init, initInfo, keyError };
