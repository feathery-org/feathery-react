import IntegrationClient from '../../utils/featheryClient/integrationClient';

const FLINKS_MAX_POLL_RETRIES = 65;
const FLINKS_REQUEST_RETRY_DELAY_MS = 5 * 1000;

export async function getIframeAuthorizationToken(client: IntegrationClient) {
  const authorizeIframeRes = await client.triggerFlinksIframeAuthorization();
  if (!authorizeIframeRes) return { err: 'Unable to authorize Flinks iframe' };
  const authorizeIframeData = await authorizeIframeRes.json();
  if (authorizeIframeRes.status === 200) {
    return { token: authorizeIframeData.token };
  }
  return { err: authorizeIframeData.message };
}

export async function setupFlinks(
  client: IntegrationClient,
  loginId: string,
  accountId: string,
  token: string
) {
  const toReturn = { err: '', fieldValues: {} };
  const setError = () => {
    toReturn.err = 'Unable to set up Flinks';
    return toReturn;
  };

  let res = await client.triggerFlinksLoginId(accountId, token, loginId);
  if (!res) return setError();

  let tries = 0;
  while (res.status === 202) {
    tries++;
    if (tries === FLINKS_MAX_POLL_RETRIES) return setError();

    await new Promise((resolve) =>
      setTimeout(resolve, FLINKS_REQUEST_RETRY_DELAY_MS)
    );
    res = await client.triggerFlinksLoginId(accountId, token);

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
