import { featheryDoc } from '../utils/browser';
import { fieldValues } from '../utils/init';

const configMap: Record<string, any> = {};

export async function installTrustedForm(
  trustedformConfig: any,
  formKey: string
) {
  if (!trustedformConfig) return;

  configMap[formKey] = trustedformConfig;

  const tf = featheryDoc().createElement('script');
  tf.type = 'text/javascript';
  tf.async = true;

  const protocol =
    featheryDoc().location.protocol === 'https:' ? 'https' : 'http';
  const certField = trustedformConfig.metadata.certificate_field_key;
  const pingField = trustedformConfig.metadata.ping_field_key;
  const rand = new Date().getTime() + Math.random();
  tf.src = `${protocol}://api.trustedform.com/trustedform.js?field=${certField}&ping_field=${pingField}&l=${rand}`;

  const s = featheryDoc().getElementsByTagName('script')[0];
  s.parentNode.insertBefore(tf, s);
}

export function gatherTrustedFormFields(existingFields: any, formKey: string) {
  const config = configMap[formKey];
  if (!config) return;

  ['certificate_field_key', 'ping_field_key'].forEach((attr) => {
    const fieldKey = config.metadata[attr];
    if (!(fieldKey in fieldValues)) {
      // Not stored yet
      const fieldVal = featheryDoc().getElementsByName(fieldKey)[0].value;
      fieldValues[fieldKey] = fieldVal;
      existingFields[fieldKey] = fieldVal;
    }
  });
}
