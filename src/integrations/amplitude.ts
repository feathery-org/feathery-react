import { featheryWindow } from '../utils/browser';
import { initInfo } from '../utils/init';
import { dynamicImport } from './utils';

let amplitudeInstalled = false;

export async function installAmplitude(amplitudeConfig: any) {
  if (!amplitudeConfig || amplitudeInstalled) return;

  amplitudeInstalled = true;
  const meta = amplitudeConfig.metadata;

  const apiKey = meta.api_key;
  let cdn = 'cdn';
  if (meta.eu_server) cdn = 'cdn.eu';
  await dynamicImport(`https://${cdn}.amplitude.com/script/${apiKey}.js`);

  if (!featheryWindow().amplitude) {
    console.warn('Failed to load Amplitude.');
    return;
  }

  if (meta.session_replay) {
    const sessionReplayTracking = featheryWindow().sessionReplay.plugin();
    featheryWindow().amplitude.add(sessionReplayTracking);
  }

  const options: Record<string, any> = {
    fetchRemoteConfig: true,
    autocapture: true
  };
  if (meta.eu_server) options.serverZone = 'EU';
  featheryWindow().amplitude.init(apiKey, options);

  if (meta.identify_user)
    featheryWindow().amplitude.setUserId(initInfo().userId);
}
