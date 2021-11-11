import { dynamicImport } from './utils';

export function installPlaid(isPlaidActive) {
  if (!isPlaidActive) return Promise.resolve();
  else {
    return dynamicImport(
      'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
    );
  }
}

export async function openPlaidLink(client, onSuccess, updateFieldValues) {
  const linkToken = (await client.fetchPlaidLinkToken()).link_token;
  // eslint-disable-next-line no-undef
  const handler = Plaid.create({
    token: linkToken,
    onSuccess: async (publicToken) => {
      const fieldVals = await client.submitPlaidUserData(publicToken);
      updateFieldValues(fieldVals);
      await onSuccess();
      handler.exit();
      handler.destroy();
    }
  });
  handler.open();
}

export function getPlaidFieldValues(plaidConfig, fieldValues) {
  // eslint-disable-next-line camelcase
  const keys = plaidConfig?.metadata?.plaid_field_map || [];
  return Object.values(keys).reduce((result, key) => {
    result[key] = fieldValues[key];
    return result;
  }, {});
}
