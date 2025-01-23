import { featheryWindow } from '../utils/browser';
import { initInfo } from '../utils/init';
import { dynamicImport } from './utils';

let amplitudeInstalled = false;

export async function installAmplitude(amplitudeConfig: any) {
  if (!amplitudeConfig || amplitudeInstalled) return;

  amplitudeInstalled = true;

  const apiKey = amplitudeConfig.metadata.api_key;
  await dynamicImport(`https://cdn.amplitude.com/script/${apiKey}.js`);
  featheryWindow().amplitude.init(apiKey, {
    fetchRemoteConfig: true,
    autocapture: true
  });

  if (amplitudeConfig.metadata.identify_user)
    featheryWindow().amplitude.setUserId(initInfo().userId);
}
