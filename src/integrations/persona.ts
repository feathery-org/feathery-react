import { dynamicImport } from './utils';
import { fieldValues, initInfo } from '../utils/init';

export async function installPersona(personaConfig: any) {
  if (personaConfig)
    await dynamicImport('https://cdn.withpersona.com/dist/persona-v4.8.0.js');
}

export function triggerPersona(
  config: any,
  onComplete: any,
  setErr: any,
  updateFieldValues: any,
  featheryClient: any
) {
  let { userId: referenceId } = initInfo();

  const personaPrefill: Record<string, any> = {};
  (config.prefill_map ?? []).forEach((prefillEntry: any) => {
    const val = fieldValues[prefillEntry.feathery_field_key];
    if (!val) return;
    if (prefillEntry.persona_attribute === 'referenceId') {
      referenceId = val as string;
    } else {
      personaPrefill[prefillEntry.persona_attribute] = val;
    }
  });

  let statusKey = '';
  (config.save_map ?? []).forEach((saveEntry: any) => {
    if (saveEntry.persona_attribute === 'verificationStatus')
      statusKey = saveEntry.feathery_field_key;
  });

  const client = new global.Persona.Client({
    templateId: config.template_id,
    environmentId: config.environment_id,
    referenceId,
    fields: personaPrefill,
    onCancel: () => setErr('The verification was cancelled'),
    onError: (error: string) => setErr(`Verification error: ${error}`),
    onComplete: ({ status }: any) => {
      if (statusKey) {
        const submitStatus = { [statusKey]: status };
        updateFieldValues(submitStatus);
        featheryClient.submitCustom(submitStatus, { shouldFlush: true });
      }
      onComplete();
    }
  });
  client.open();
}
