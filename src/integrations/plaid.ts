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
  onExit: any,
  updateFieldValues: any,
  includeLiabilities = false,
  waitForCompletion = true,
  handleError: any
) {
  await plaidPromise;

  const linkToken = (await client.fetchPlaidLinkToken(includeLiabilities))
    .link_token;
  const handler = global.Plaid.create({
    token: linkToken,
    onExit,
    onSuccess: async (publicToken: any) => {
      try {
        const res = client.submitPlaidUserData(publicToken);
        if (waitForCompletion) {
          const fieldVals = await res;
          updateFieldValues(fieldVals);
        }
      } catch (e) {
        handleError();
        handler.exit();
        handler.destroy();
        return;
      }
      await onSuccess();
      handler.exit();
      handler.destroy();
    }
  });
  handler.open();
}
