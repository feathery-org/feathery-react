export async function createSchwabContact(client: any, setElementError: any) {
  const res = await client.schwabCreateContact();
  if (!res.ok) setElementError(res.error);
  else {
    location.href =
      'https://si2.schwabinstitutional.com/SI2/Home/Utilities/AccountManagement.aspx';
  }
}
