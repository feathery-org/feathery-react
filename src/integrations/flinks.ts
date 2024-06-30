import { featheryWindow } from '../utils/browser';

export async function openFlinksConnect(
  client: any,
  onSuccess: any,
  flinksConfig: any
) {
  const childWindow = featheryWindow().open(
    '',
    'Flinks Connect',
    'width=600,height=400'
  );

  const instance = flinksConfig.metadata.instance;
  let flinksUrl = `https://${instance}-iframe.private.fin.ag/v2/`;

  if (flinksConfig.metadata.environment === 'sandbox')
    flinksUrl += '?demo=true';

  featheryWindow().addEventListener('message', async (e: any) => {
    console.log(e.data);
    if (e.data.step === 'REDIRECT') {
      const loginId = new URLSearchParams(e.data.url).get('loginId');
      client.triggerFlinksLoginId.bind(client);
      return onSuccess();
    }
  });

  childWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Child Window</title>
      </head>
      <body>
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
