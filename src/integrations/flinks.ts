import { featheryWindow } from '../utils/browser';
import IntegrationClient from '../utils/featheryClient/integrationClient';

const FLINKS_MAX_POLL_RETRIES = 20;
const FLINKS_REQUEST_RETRY_DELAY_MS = 5 * 1000;

type UpdateFieldValuesCallback = (fieldValues: any) => void;

export async function openFlinksConnect(
  client: IntegrationClient,
  onSuccess: () => void,
  flinksConfig: any,
  updateFieldValues: UpdateFieldValuesCallback
) {
  const childWindow = featheryWindow().open(
    '',
    'Flinks Connect',
    'width=700,height=700'
  );

  const instance =
    flinksConfig.metadata.environment === 'sandbox'
      ? 'toolbox'
      : flinksConfig.metadata.instance;

  let flinksUrl = `https://${instance}-iframe.private.fin.ag/v2/?accountSelectorEnable=true&showAllOperationsAccounts=true`;
  let accountId: string;

  if (flinksConfig.metadata.environment === 'sandbox')
    flinksUrl += '&demo=true';

  featheryWindow().addEventListener('message', async (e: any) => {
    if (e.data.step === 'ACCOUNT_SELECTED') {
      accountId = e.data.accountId;
    }
    if (e.data.step === 'REDIRECT') {
      childWindow.close();
      const loginId = new URLSearchParams(e.data.url).get('loginId');
      if (!loginId) return;
      const data = await setupFlinks(client, loginId, accountId);
      if (!data.err) updateFieldValues(data.fieldValues);
      return onSuccess();
    }
  });

  childWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Child Window</title>
      </head>
      <body style="height: 100vh; width: 100vw; margin: 0;">
        <iframe src="${flinksUrl}" width="100%" height="100%" style="border: none;"></iframe>
        <script>
          // Listen for messages from the iframe
          window.addEventListener("message", function(event) {
            // Relay the message to the parent window
            window.opener.postMessage(event.data);
          }, false);
        </script>
      </body>
    </html>
  `);
  childWindow.document.close();
}

async function setupFlinks(
  client: IntegrationClient,
  loginId: string,
  accountId: string
) {
  const toReturn = { err: '', fieldValues: {} };
  const setError = () => {
    toReturn.err = 'Unable to set up Flinks';
    return toReturn;
  };

  let res = await client.triggerFlinksLoginId(accountId, loginId);
  if (!res) return setError();

  let tries = 0;
  while (res.status === 202) {
    tries++;
    if (tries === FLINKS_MAX_POLL_RETRIES) return setError();

    await new Promise((resolve) =>
      setTimeout(resolve, FLINKS_REQUEST_RETRY_DELAY_MS)
    );
    res = await client.triggerFlinksLoginId(accountId);

    if (!res) return setError();
  }

  if (res.status === 200) {
    const data = await res.json();
    toReturn.fieldValues = data.field_values;
  } else if (res.status === 400) {
    const data = await res.json();
    toReturn.err = data.message;
  } else setError();

  return toReturn;
}
