import 'flat-map-polyfill';

/**
 * Used to match `RegExp`
 * [syntax characters](http://ecma-international.org/ecma-262/7.0/#sec-patterns).
 */
const reRegExpChar = /[\\^$.*+?()[\]{}|]/g;
const reHasRegExpChar = RegExp(reRegExpChar.source);

function escapeRegExp(str: string) {
  return str && reHasRegExpChar.test(str)
    ? str.replace(reRegExpChar, '\\$&')
    : str;
}

if (!String.prototype.replaceAll) {
  // eslint-disable-next-line no-extend-native
  String.prototype.replaceAll = function (str, newStr: any) {
    // If a regex pattern
    if (
      Object.prototype.toString.call(str).toLowerCase() === '[object regexp]'
    ) {
      return this.replace(str, newStr);
    } else {
      // If a string
      return this.replace(new RegExp(escapeRegExp(str as string), 'g'), newStr);
    }
  };
}

export {};
