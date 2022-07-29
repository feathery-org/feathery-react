/* eslint-disable no-var */
// need to use var for this to work - https://stackoverflow.com/a/69230938
declare global {
  var scriptjsLoadPromise: any;
  var webfontloaderPromise: any;
}

export default global;
