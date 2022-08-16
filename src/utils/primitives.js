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

// This is a polyfill of Object.fromEntries.
// Needed due to https://sentry.io/organizations/feathery-forms/issues/3446152280
function objectFromEntries(arr) {
  return [...arr].reduce((obj, [key, val]) => {
    obj[key] = val;
    return obj;
  }, {});
}

function stringifyWithNull(value) {
  return value === null || value === undefined ? '' : value.toString();
}

export {
  encodeGetParams,
  isNum,
  isObjectEmpty,
  objectFromEntries,
  stringifyWithNull
};
