import { featheryWindow } from '../utils/browser';
import { API_URL } from '../utils/featheryClient';
import { checkResponseSuccess } from '../utils/featheryClient/integrationClient';
import { initInfo } from '../utils/init';
import { encodeGetParams } from '../utils/primitives';

const FLINKS_TIMEOUT_MS = 40 * 1000;
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
        .then((response: any) => {
          setupFlinks(
            updateFieldValues,
            loginId as string,
            client.getFormKey(),
            response?.request_id
          );
        })
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

async function _fetch(url: any, options?: any, parseResponse = true) {
  const { sdkKey } = initInfo();
  options = options ?? {};
  const { headers, ...otherOptions } = options ?? {};
  options = {
    cache: 'no-store',
    // Write requests must succeed so data is tracked
    keepalive: ['POST', 'PATCH', 'PUT'].includes(options.method),
    headers: {
      Authorization: 'Token ' + sdkKey,
      ...headers
    },
    ...otherOptions
  };
  return fetch(url, options)
    .then(async (response) => {
      if (parseResponse) await checkResponseSuccess(response);
      return response;
    })
    .catch((e) => {
      return null;
    });
}

async function setupFlinks(
  updateFieldValues: any,
  loginId: string,
  formKey: string,
  requestId: string
) {
  const { userId } = initInfo();

  const paramsObj: any = {
    form_key: formKey,
    fuser_key: userId,
    login_id: loginId
  };

  if (requestId) {
    paramsObj.request_id = requestId;
  }

  const params = encodeGetParams(paramsObj);

  const url = `${API_URL}flinks/login-id/?${params}`;

  let response: any = await _fetch(url).catch((e) => {
    return null;
  });

  let pollInterval: NodeJS.Timeout;
  let intervalCleared = false;

  response = await new Promise((resolve, reject) => {
    let innerResponse: any;

    setTimeout(async () => {
      if (!intervalCleared) {
        clearInterval(pollInterval);
        intervalCleared = true;
        resolve(innerResponse);
      }
    }, FLINKS_TIMEOUT_MS);

    pollInterval = setInterval(async () => {
      innerResponse = await _fetch(url).catch((e) => {
        return null;
      });

      if (innerResponse && innerResponse.status === 202) {
        // return and simply retry the fetch
        return;
      }

      if (innerResponse && (innerResponse as any).status === 200) {
        clearInterval(pollInterval);
        intervalCleared = true;
        resolve(innerResponse);
      } else if (innerResponse && (innerResponse as any).status > 400) {
        clearInterval(pollInterval);
        intervalCleared = true;
        reject(innerResponse);
      }
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
