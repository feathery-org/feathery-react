export default function polyfill() {
  if (!String.prototype.replaceAll) {
    // eslint-disable-next-line no-extend-native
    String.prototype.replaceAll = function (str, newStr: any) {
      // If a regex pattern
      if (
        Object.prototype.toString.call(str).toLowerCase() === '[object regexp]'
      ) {
        return this.replace(str, newStr);
      }

      // If a string
      return this.replace(new RegExp(str, 'g'), newStr);
    };
  }
}
