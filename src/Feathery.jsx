import React, { useEffect, useReducer, useCallback } from 'react';
import FeatheryClient from 'feathery-js-client-sdk';
import featheryContext from './featheryContext';

import actionTypes from './actionTypes';
import reducer from './reducer';

const initialState = {
    client: null,
    settings: null,
    error: false,
    loading: true
};

function Feathery({
    sdkKey = false,
    userKey = false,
    children,
    async = false,
    fallback = null
}) {
    const [state, dispatch] = useReducer(reducer, initialState);

    const load = useCallback(async () => {
        if (sdkKey === false || userKey === false) {
            dispatch({ type: actionTypes.INITIAL });
            return;
        }
        try {
            const featheryClient = new FeatheryClient(sdkKey, userKey);
            dispatch({
                type: actionTypes.START,
                client: featheryClient
            });
            const settings = await featheryClient.fetch();
            dispatch({
                type: actionTypes.LOADED,
                settings: settings,
            });
        } catch (error) {
            dispatch({ type: actionTypes.ERROR, error });
        }
    }, [sdkKey, userKey]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <featheryContext.Provider value={{ ...state }}>
            {!state.loading || async ? children : fallback}
        </featheryContext.Provider>
    );
}

export default React.memo(Feathery);
