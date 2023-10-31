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
  action: any
) {
  await plaidPromise;

  const linkToken = (
    await client.fetchPlaidLinkToken(
      action.include_liabilities,
      action.update_flow
    )
  ).link_token;
  const handler = global.Plaid.create({
    token: linkToken,
    onSuccess: async (publicToken: any) => {
      const fieldVals = await client.submitPlaidUserData(publicToken);
      updateFieldValues(fieldVals);
      await onSuccess();
      handler.exit();
      handler.destroy();
    }
  });
  handler.open();
}
