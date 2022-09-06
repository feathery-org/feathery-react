import { dynamicImport } from './utils';

let plaidPromise: any = null;

export function installPlaid(isPlaidActive: any) {
  if (plaidPromise) return plaidPromise;
  else if (!isPlaidActive) return Promise.resolve();
  else {
    plaidPromise = dynamicImport(
      'https://cdn.plaid.com/link/v2/stable/link-initialize.js'
    );
    return plaidPromise;
  }
}

export async function openPlaidLink(
  client: any,
  onSuccess: any,
  updateFieldValues: any,
  setLoader: any,
  clearLoader: any
) {
  // No actions if Plaid hasn't been loaded yet
  if (!global.Plaid) return;

  const linkToken = (await client.fetchPlaidLinkToken()).link_token;
  const handler = global.Plaid.create({
    token: linkToken,
    onSuccess: async (publicToken: any) => {
      setLoader();
      const fieldVals = await client.submitPlaidUserData(publicToken);
      updateFieldValues(fieldVals);
      await onSuccess();
      clearLoader();
      handler.exit();
      handler.destroy();
    }
  });
  handler.open();
}

export function getPlaidFieldValues(plaidConfig: any, fieldValues: any) {
  // eslint-disable-next-line camelcase
  const keys = plaidConfig?.metadata?.plaid_field_map || [];
  return Object.values(keys).reduce((result, key) => {
    // @ts-expect-error TS(2538): Type 'unknown' cannot be used as an index type.
    (result as any)[key] = fieldValues[key];
    return result;
  }, {});
}
