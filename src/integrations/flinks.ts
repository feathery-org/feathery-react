import { featheryWindow } from '../utils/browser';
import IntegrationClient from '../utils/featheryClient/integrationClient';

const FLINKS_TIMEOUT_MS = 60 * 1000;
const FLINKS_REQUEST_RETRY_TIME_MS = 5 * 1000;

export async function openFlinksConnect(
  client: any,
  onSuccess: any,
  flinksConfig: any,
  updateFieldValues: any
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
        .triggerFlinksLoginId(loginId)
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
  if (initialResponseData?.field_values) {
    const fieldValues = initialResponseData.field_values;
    updateFieldValues(fieldValues);
    return;
  }

  let pollInterval: NodeJS.Timeout;
  let intervalCleared = false;

  const response: any = await new Promise(function (resolve, reject) {
    let innerResponse: any;

    const clearPollInterval = () => {
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
  }).catch((err) => {
    return null;
  });

  if (!response) {
    return;
  }

  const responseData = await response?.json();

  if (!responseData) {
    return;
  }

  if (responseData.field_values) {
    const fieldValues = responseData.field_values;
    updateFieldValues(fieldValues);
  }
}
