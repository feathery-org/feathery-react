import { featheryWindow } from '../utils/browser';
import { dynamicImport } from './utils';

export let rudderStackInstalled = false;

export async function installRudderStack(rudderStackConfig: any) {
  if (rudderStackConfig && !rudderStackInstalled) {
    rudderStackInstalled = true;

    dynamicImport('https://cdn.rudderlabs.com/v1.1/rudder-analytics.min.js');
    const rudderanalytics: any = (featheryWindow().rudderanalytics = []);
    const methods = [
      'load',
      'page',
      'track',
      'identify',
      'alias',
      'group',
      'ready',
      'reset',
      'getAnonymousId',
      'setAnonymousId',
      'getUserId',
      'getUserTraits',
      'getGroupId',
      'getGroupTraits',
      'startSession',
      'endSession',
      'getSessionId'
    ];
    for (let i = 0; i < methods.length; i++) {
      const method = methods[i] as any;
      rudderanalytics[method] = (function (methodName) {
        return function () {
          rudderanalytics.push(
            // eslint-disable-next-line prefer-rest-params
            [methodName].concat(Array.prototype.slice.call(arguments))
          );
        };
      })(method);
    }

    rudderanalytics.load(
      rudderStackConfig.metadata.write_key,
      rudderStackConfig.metadata.data_plane_url
    );
    rudderanalytics.page();
  }

  return Promise.resolve();
}

export function trackRudderEvent(
  title: string,
  properties: Record<string, any>,
  integ: any
) {
  const trackEvents = integ?.metadata.track_events;
  if (!trackEvents || trackEvents.includes(title))
    featheryWindow().rudderanalytics.track(title, properties);
}
