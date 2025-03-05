export async function createSchwabContact(client: any, setElementError: any) {
  const res = await client.schwabCreateContact();
  if (!res.ok) setElementError(res.error);
  else {
    location.href = 'https://advisorservices.schwab.com';
  }
}
