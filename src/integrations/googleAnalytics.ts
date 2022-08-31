import { dynamicImport } from './utils';

export let gaInstalled = false;

export function installGoogleAnalytics(gaConfig) {
  if (gaConfig && !gaInstalled) {
    gaInstalled = true;

    dynamicImport(
      `https://www.googletagmanager.com/gtag/js?id=${gaConfig.metadata.api_key}`
    );
    window.dataLayer = window.dataLayer || [];
    triggerGTag('js', new Date());
    triggerGTag('config', gaConfig.metadata.api_key);
  }

  return Promise.resolve();
}

function triggerGTag(...args) {
  window.dataLayer.push(args);
}

export function trackGAEvent(title, metadata) {
  triggerGTag('event', title, metadata);
}
