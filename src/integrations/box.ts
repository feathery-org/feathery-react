const DEFAULT_ERROR =
  'We could not send your files to Box. Make sure your Box account is connected and a folder is selected, then try again.';

export async function sendBoxFiles(
  client: any,
  setElementError: any,
  fieldId?: string
) {
  const res = await client.boxSendFiles(fieldId);
  // A network failure leaves res.error === '' (integrationClient._fetch
  // returns undefined), which would otherwise show a blank error message.
  if (!res.ok) setElementError(res.error || DEFAULT_ERROR);
  return res.ok;
}
