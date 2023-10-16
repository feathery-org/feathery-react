function encodeGetParams(params: any) {
  return (
    Object.entries(params)
      // @ts-expect-error TS(2345): Argument of type '(uriComponent: string | number |... Remove this comment to see the full error message
      .map((kv) => kv.map(encodeURIComponent).join('='))
      .join('&')
  );
}

function isNum(candidate: any) {
  return !isNaN(parseInt(candidate));
}

function isObjectEmpty(obj: any) {
  return !obj || Object.keys(obj).length === 0;
}

// This is a polyfill of Object.fromEntries.
// Needed due to https://sentry.io/organizations/feathery-forms/issues/3446152280
function objectFromEntries(arr: any) {
  return [...arr].reduce((obj, [key, val]) => {
    obj[key] = val;
    return obj;
  }, {});
}

function stringifyWithNull(value: any) {
  return value === null || value === undefined ? '' : value.toString();
}

function isAlphaNumeric(val: any) {
  if (!isNaN(val)) return true;

  let code, i, len;

  for (i = 0, len = val.length; i < len; i++) {
    code = val.charCodeAt(i);
    if (
      !(code > 47 && code < 58) && // numeric (0-9)
      !(code > 64 && code < 91) && // upper alpha (A-Z)
      !(code > 96 && code < 123) // lower alpha (a-z)
    ) {
      return false;
    }
  }
  return true;
}

function filterKeys(obj: any, allowedKeys: any) {
  return Object.keys(obj)
    .filter((key) => allowedKeys.includes(key))
    .reduce((cur, key) => {
      return Object.assign(cur, { [key]: obj[key] });
    }, {});
}

function formatNumeric(number: number, intlOptions = {}, locales = ['en-US']) {
  return new Intl.NumberFormat(locales, intlOptions).format(number);
}
function formatDecimal(number: number, decimalDigits = 2, locales = ['en-US']) {
  return new Intl.NumberFormat(locales, {
    minimumFractionDigits: decimalDigits,
    maximumFractionDigits: decimalDigits
  }).format(number);
}
function formatMoneyUSD(number: number, locales = ['en-US']) {
  return formatNumeric(number, { style: 'currency', currency: 'USD' }, locales);
}
function formatMoney(number: number, currency = 'USD', locales?: any) {
  return formatNumeric(number, { style: 'currency', currency }, locales);
}

function numMatchingItems(arr1: number[], arr2: number[]) {
  let i;
  for (i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) return i;
  }
  return i;
}

export {
  encodeGetParams,
  isAlphaNumeric,
  isNum,
  isObjectEmpty,
  objectFromEntries,
  stringifyWithNull,
  filterKeys,
  formatNumeric,
  formatDecimal,
  formatMoneyUSD,
  formatMoney,
  numMatchingItems
};
