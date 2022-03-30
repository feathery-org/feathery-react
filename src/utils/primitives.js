function encodeGetParams(params) {
  return Object.entries(params)
    .map((kv) => kv.map(encodeURIComponent).join('='))
    .join('&');
}

function isNum(candidate) {
  return !isNaN(parseInt(candidate));
}

function isObjectEmpty(obj) {
  return Object.keys(obj).length === 0;
}

export { encodeGetParams, isNum, isObjectEmpty };
