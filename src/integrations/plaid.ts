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
  action: any,
  handleError: any
) {
  await plaidPromise;

  let kwargs;
  if (action.plaid_action === 'identity') {
    kwargs = {
      identity_template_id: action.template_id,
      email_field: action.email_field
    };
  } else {
    kwargs = { liabilities: action.include_liabilities ? 'true' : 'false' };
  }

  const linkToken = (await client.fetchPlaidLinkToken(kwargs)).link_token;
  const handler = global.Plaid.create({
    token: linkToken,
    onExit,
    onSuccess: async (publicToken: string, metadata: Record<string, any>) => {
      try {
        if (action.plaid_action === 'identity') {
          const res = client.fetchPlaidVerificationStatus(
            metadata.link_session_id
          );
          const statusKey = action.plaid_identity_field_key;
          if (statusKey) {
            updateFieldValues({ [statusKey]: (await res).status });
          }
        } else {
          const res = client.submitPlaidUserData(publicToken);
          if (action.wait_for_completion ?? true) {
            const fieldVals = await res;
            updateFieldValues(fieldVals);
          }
        }

        await onSuccess();
      } catch (e) {
        handleError();
      } finally {
        handler.exit();
        handler.destroy();
      }
    }
  });
  handler.open();
}
