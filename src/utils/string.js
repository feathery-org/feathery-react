function encodeGetParams(params) {
    return Object.entries(params)
        .map((kv) => kv.map(encodeURIComponent).join('='))
        .join('&');
}

export default encodeGetParams;
