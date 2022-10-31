import ReactGA from 'react-ga4';

export let gaInstalled = false;

export function installGoogleAnalytics(gaConfig: any) {
  if (gaConfig && !gaInstalled) {
    gaInstalled = true;
    ReactGA.initialize(gaConfig.metadata.api_key);
  }

  return Promise.resolve();
}

export function trackGAEvent(title: any, metadata: any) {
  ReactGA.event(title, metadata);
}
