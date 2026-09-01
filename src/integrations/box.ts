const DEFAULT_ERROR =
  'We could not send your files to Box. Make sure your Box account is connected and a folder is selected, then try again.';

export async function sendBoxFiles(
  client: any,
  setElementError: any,
  fields: {
    field_id: string;
    name_field_id?: string;
    name_field_type?: string;
  }[]
) {
  const res = await client.boxSendFiles(fields);
  // A network failure leaves res.error === '' (integrationClient._fetch
  // returns undefined), which would otherwise show a blank error message.
  if (!res.ok) setElementError(res.error || DEFAULT_ERROR);
  return res.ok;
}
