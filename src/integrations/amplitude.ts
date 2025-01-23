import { featheryWindow } from '../utils/browser';
import { initInfo } from '../utils/init';
import { dynamicImport } from './utils';

let amplitudeInstalled = false;

export async function installAmplitude(amplitudeConfig: any) {
  if (!amplitudeConfig || amplitudeInstalled) return;

  amplitudeInstalled = true;
  const meta = amplitudeConfig.metadata;

  const apiKey = meta.api_key;
  await dynamicImport(`https://cdn.amplitude.com/script/${apiKey}.js`);

  if (meta.session_replay) {
    const sessionReplayTracking = featheryWindow().sessionReplay.plugin();
    featheryWindow().amplitude.add(sessionReplayTracking);
  }

  featheryWindow().amplitude.init(apiKey, {
    fetchRemoteConfig: true,
    autocapture: true
  });

  if (meta.identify_user)
    featheryWindow().amplitude.setUserId(initInfo().userId);
}
