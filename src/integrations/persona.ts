import { dynamicImport } from './utils';
import { initInfo } from '../utils/init';

export async function installPersona(personaConfig: any) {
  if (personaConfig)
    await dynamicImport('https://cdn.withpersona.com/dist/persona-v4.8.0.js');
}

export function triggerPersona(
  templateId: string,
  environmentId: string,
  onComplete: any,
  setErr: any
) {
  const { userId } = initInfo();
  const client = new global.Persona.Client({
    templateId,
    environmentId,
    referenceId: userId,
    onCancel: () => setErr('The verification was cancelled'),
    onError: (error: string) => setErr(`Verification error: ${error}`),
    onComplete
  });
  client.open();
}
