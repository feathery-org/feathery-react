import actionTypes from './actionTypes';

const reducer = (state, action) => {
    switch (action.type) {
        case actionTypes.START:
            return {
                ...state,
                client: action.client,
                flags: null,
                error: false,
                loading: true
            };
        case actionTypes.LOADED:
            return {
                ...state,
                flags: action.flags,
                error: false,
                loading: false
            };
        case actionTypes.ERROR:
            return {
                ...state,
                flags: null,
                loading: false,
                error: action.error
            };
        case actionTypes.INITIAL:
            return {
                ...state,
                loading: false,
                error: false,
                flags: null,
                client: null
            };
        default:
            return state;
    }
};
export default reducer;
