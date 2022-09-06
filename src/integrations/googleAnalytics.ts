import { dynamicImport } from './utils';

export let gaInstalled = false;

export function installGoogleAnalytics(gaConfig: any) {
  if (gaConfig && !gaInstalled) {
    gaInstalled = true;

    dynamicImport(
      `https://www.googletagmanager.com/gtag/js?id=${gaConfig.metadata.api_key}`
    );
    (window as any).dataLayer = (window as any).dataLayer || [];
    triggerGTag('js', new Date());
    triggerGTag('config', gaConfig.metadata.api_key);
  }

  return Promise.resolve();
}

function triggerGTag(...args: any[]) {
  (window as any).dataLayer.push(args);
}

export function trackGAEvent(title: any, metadata: any) {
  triggerGTag('event', title, metadata);
}
