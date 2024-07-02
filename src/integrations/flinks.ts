import { featheryWindow } from '../utils/browser';
import IntegrationClient from '../utils/featheryClient/integrationClient';

const FLINKS_TIMEOUT_MS = 60 * 1000;
const FLINKS_REQUEST_RETRY_TIME_MS = 5 * 1000;

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
    'width=600,height=400'
  );

  const instance =
    flinksConfig.metadata.environment === 'sandbox'
      ? 'toolbox'
      : flinksConfig.metadata.instance;

  let flinksUrl = `https://${instance}-iframe.private.fin.ag/v2/`;

  if (flinksConfig.metadata.environment === 'sandbox')
    flinksUrl += '?demo=true';

  featheryWindow().addEventListener('message', async (e: any) => {
    if (e.data.step === 'REDIRECT') {
      const loginId = new URLSearchParams(e.data.url).get('loginId');
      client
        .triggerFlinksLoginId(loginId as string)
        .then((response: any) =>
          setupFlinks(client, updateFieldValues, loginId as string)
        )
        .catch((err: any) => null);
      return onSuccess();
    }
  });

  childWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Child Window</title>
      </head>
      <body style="height: 100vh; width: 100vw;">
        <iframe src="${flinksUrl}" width="100%" height="100%"></iframe>
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

function pollerClosure(
  client: IntegrationClient,
  loginId: string
): (resolve: (value: unknown) => void, reject: (reason?: any) => void) => void {
  let pollInterval: NodeJS.Timeout;
  let intervalCleared = false;

  return function (
    resolve: (value: unknown) => void,
    reject: (reason?: any) => void
  ): void {
    let innerResponse: any;

    const clearPollInterval = (): void => {
      if (!intervalCleared) {
        clearInterval(pollInterval);
        intervalCleared = true;
      }
    };

    setTimeout(() => {
      if (!intervalCleared) {
        clearPollInterval();
        resolve(innerResponse);
      }
    }, FLINKS_TIMEOUT_MS);

    pollInterval = setInterval(() => {
      client.fetchAndHandleFlinksResponse(
        loginId,
        resolve,
        reject,
        clearPollInterval,
        true
      );
    }, FLINKS_REQUEST_RETRY_TIME_MS);
  };
}

function checkResponseAndUpdateFieldValues(
  response: any,
  updateFieldValues: UpdateFieldValuesCallback
): void {
  if (response?.field_values) {
    updateFieldValues(response.field_values);
  }
}

async function setupFlinks(
  client: IntegrationClient,
  updateFieldValues: any,
  loginId: string
) {
  let initialResponseData: any = await new Promise((resolve, reject) =>
    client.fetchAndHandleFlinksResponse(
      loginId,
      resolve,
      reject,
      () => {},
      false
    )
  )
    .then((res: any) => res?.json())
    .catch((err) => null);

  // edge case: if initial response has the field values we don't need to poll
  checkResponseAndUpdateFieldValues(initialResponseData, updateFieldValues);

  const poller = pollerClosure(client, loginId);

  const response: any = await new Promise(poller)
    .then((res: any) => res.json())
    .catch((err) => null);

  checkResponseAndUpdateFieldValues(response, updateFieldValues);
}
