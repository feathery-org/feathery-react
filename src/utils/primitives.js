function encodeGetParams(params) {
  return Object.entries(params)
    .map((kv) => kv.map(encodeURIComponent).join('='))
    .join('&');
}

function isNum(candidate) {
  return !isNaN(parseInt(candidate));
}

export { encodeGetParams, isNum };
