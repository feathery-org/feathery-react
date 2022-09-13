import { featheryDoc } from '../utils/browser';

export function installSegment(segmentConfig: any) {
  if (segmentConfig) {
    // Script from https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/quickstart/#step-2-add-the-segment-snippet
    // Create a queue, but don't obliterate an existing one!
    const analytics = (window.analytics = window.analytics || []);
    // If the real analytics.js is already on the page return.
    if (analytics.initialize) return;
    // If the snippet was invoked already show an error.
    if (analytics.invoked) return;

    // Invoked flag, to make sure the snippet
    // is never invoked twice.
    analytics.invoked = true;
    // A list of the methods in Analytics.js to stub.
    analytics.methods = [
      'trackSubmit',
      'trackClick',
      'trackLink',
      'trackForm',
      'pageview',
      'identify',
      'reset',
      'group',
      'track',
      'ready',
      'alias',
      'debug',
      'page',
      'once',
      'off',
      'on',
      'addSourceMiddleware',
      'addIntegrationMiddleware',
      'setAnonymousId',
      'addDestinationMiddleware'
    ];
    // Define a factory to create stubs. These are placeholders
    // for methods in Analytics.js so that you never have to wait
    // for it to load to actually record data. The `method` is
    // stored as the first argument, so we can replay the data.
    analytics.factory = function (method: any) {
      return function () {
        // eslint-disable-next-line prefer-rest-params
        const args = Array.prototype.slice.call(arguments);
        args.unshift(method);
        analytics.push(args);
        return analytics;
      };
    };
    // For each of our methods, generate a queueing stub.
    for (let i = 0; i < analytics.methods.length; i++) {
      const key = analytics.methods[i];
      analytics[key] = analytics.factory(key);
    }
    // Define a method to load Analytics.js from our CDN,
    // and that will be sure to only ever load it once.
    analytics.load = function (key: any, options: any) {
      // Create an async script element based on your key.
      const script = featheryDoc().createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.src =
        'https://cdn.segment.com/analytics.js/v1/' + key + '/analytics.min.js';
      // Insert our script next to the first script element.
      const first = featheryDoc().getElementsByTagName('script')[0];
      first.parentNode.insertBefore(script, first);
      analytics._loadOptions = options;
    };
    analytics._writeKey = segmentConfig.metadata.api_key;
    // Add a version to keep track of what's in the wild.
    analytics.SNIPPET_VERSION = '4.15.2';
    // Load Analytics.js with your key, which will automatically
    // load the tools you've enabled for your account. Boosh!
    analytics.load(segmentConfig.metadata.api_key);
    // Make the first page call to load the integrations. If
    // you'd like to manually name or tag the page, edit or
    // move this call however you'd like.
    analytics.page();
  }

  return Promise.resolve();
}
