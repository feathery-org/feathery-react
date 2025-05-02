import { dynamicImport } from './utils';
import { fieldValues, initInfo } from '../utils/init';
import { TEXT_VARIABLE_PATTERN } from '../elements/components/TextNodes';
import { STATIC_URL } from '../utils/featheryClient';
import { parseError } from '../utils/error';

export async function installPersona(personaConfig: any) {
  if (personaConfig)
    await dynamicImport('https://cdn.withpersona.com/dist/persona-v5.1.2.js');
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
    templateId: getPersonaAttrVal(config, 'template_id'),
    environmentId: getPersonaAttrVal(config, 'environment_id'),
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
      const pollForResponse = (): Promise<{
        status?: string;
        error?: string;
        [key: string]: any;
      }> => {
        return new Promise((resolve) => {
          let attempts = 0;
          const PERSONA_CHECK_INTERVAL = 2000;
          const PERSONA_MAX_TIME = 60 * 2000;
          const maxAttempts = PERSONA_MAX_TIME / PERSONA_CHECK_INTERVAL;
          const pollUrl = `${STATIC_URL}persona/webhook/poll/${featheryClient.formKey}/${referenceId}/`;
          const { sdkKey } = initInfo();

          const checkCompletion = async (): Promise<void> => {
            try {
              const response = await fetch(pollUrl, {
                headers: {
                  Authorization: 'Token ' + sdkKey
                }
              });

              if (response?.status === 400) {
                const errorData = await response.json();
                resolve({ error: parseError(errorData) });
              } else if (response?.status === 200) {
                const data = await response.json();
                if (data.status === 'complete') {
                  resolve(data);
                  const submitStatus = { [statusKey]: data.value };
                  updateFieldValues(submitStatus);
                  featheryClient.submitCustom(submitStatus, {
                    shouldFlush: true
                  });
                  onComplete();
                } else {
                  attempts += 1;
                  if (attempts < maxAttempts) {
                    setTimeout(checkCompletion, PERSONA_CHECK_INTERVAL);
                  } else {
                    console.warn('Persona response took too long...');
                    resolve({ status: 'timeout', error: 'Polling timed out' });
                  }
                }
              }
            } catch (error) {
              console.error('Error polling for document:', error);
              return resolve({ error: 'Failed to poll for document' });
            }
          };

          setTimeout(checkCompletion, PERSONA_CHECK_INTERVAL);
        });
      };

      pollForResponse();
    }
  });
  client.open();
}

function getPersonaAttrVal(config: any, key: string) {
  let varId = config[key];
  const matches = varId.match(TEXT_VARIABLE_PATTERN);
  if (matches) {
    const varField = matches[0].slice(2, -2);
    const val = fieldValues[varField];
    if (val) varId = val;
  }
  return varId;
}
