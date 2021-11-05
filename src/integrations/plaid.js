import { dynamicImport } from './utils';

export function installPlaid(isPlaidActive) {
  if (!isPlaidActive) return Promise.resolve();
  else {
    return dynamicImport(
      'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
    );
  }
}

export async function openPlaidLink(client, onSuccess) {
  const linkToken = (await client.fetchPlaidLinkToken()).link_token;
  // eslint-disable-next-line no-undef
  const handler = Plaid.create({
    token: linkToken,
    onSuccess: async (publicToken) => {
      await client.submitPlaidUserData(publicToken);
      await onSuccess();
      handler.exit();
      handler.destroy();
    }
  });
  handler.open();
}
