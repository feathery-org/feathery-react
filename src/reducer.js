import actionTypes from './actionTypes';

const reducer = (state, action) => {
    switch (action.type) {
        case actionTypes.START:
            return {
                ...state,
                client: action.client,
                settings: null,
                error: false,
                loading: true
            };
        case actionTypes.LOADED:
            return {
                ...state,
                settings: action.settings,
                error: false,
                loading: false
            };
        case actionTypes.ERROR:
            return {
                ...state,
                settings: null,
                loading: false,
                error: action.error
            };
        case actionTypes.INITIAL:
            return {
                ...state,
                loading: false,
                error: false,
                settings: null,
                client: null
            };
        default:
            return state;
    }
};
export default reducer;
