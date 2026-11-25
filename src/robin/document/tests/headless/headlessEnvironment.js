/**
 * The headless lane's test environment: `jest-environment-node` plus the
 * platform globals jest 26's sandbox does not install.
 *
 * jest 26 predates most of them, so `AbortController` and friends are simply
 * absent inside a test file even on Node 22. `puppeteer-core` builds an
 * `AbortController` for every `waitForFunction`, so without this the lane fails
 * with `ReferenceError: AbortController is not defined` and never reaches the
 * engine. Each global is copied from the REAL Node global, never polyfilled, so
 * the lane measures the runtime it actually runs on.
 */
const NodeEnvironment = require('jest-environment-node');

const BORROWED = [
  'AbortController',
  // `page.screenshot` decodes the CDP response with `atob`, so without these
  // the evidence shot throws `ReferenceError: atob is not defined` and takes
  // the assertion that follows it down with it.
  'atob',
  'btoa',
  'AbortSignal',
  'Blob',
  'CompressionStream',
  'DecompressionStream',
  'Event',
  'EventTarget',
  'MessageChannel',
  'MessageEvent',
  'MessagePort',
  'ReadableStream',
  'TransformStream',
  'WritableStream',
  'fetch',
  'performance',
  'structuredClone'
];

class HeadlessEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();
    for (const name of BORROWED)
      if (this.global[name] === undefined && globalThis[name] !== undefined)
        this.global[name] = globalThis[name];
  }
}

module.exports = HeadlessEnvironment;
