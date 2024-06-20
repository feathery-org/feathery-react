import { dynamicImport } from './utils';
import { fieldValues } from '../utils/init';

let alloyPromise: any = null;

export function installAlloy(isAlloyActive: any) {
  if (alloyPromise) return alloyPromise;
  else if (!isAlloyActive) return Promise.resolve();
  else {
    alloyPromise = dynamicImport(
      'https://scripts.alloy.com/2/2/alloy_sdk_bundle.js'
    );
    return alloyPromise;
  }
}

export async function verifyAlloyId(
  actionConfig: any,
  alloyConfig: any,
  onSuccess: any
) {
  await global.alloy.init({
    key: alloyConfig.metadata.sdk_key,
    production: alloyConfig.metadata.environment === 'production',
    journeyToken: actionConfig.journey_token,
    journeyApplicationToken:
      fieldValues[actionConfig.journey_application_field_key]
  });

  global.alloy.open((data: any) => {
    if (
      data.status === 'completed' &&
      data.journey_application_status.toLowerCase() === 'approved'
    )
      onSuccess();
  });
}
