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

  const res = await client.fetchPlaidLinkToken(kwargs);
  if (res.err) {
    handleError(res.err);
    return;
  }

  const handler = global.Plaid.create({
    token: res.token,
    onExit,
    onSuccess: async (publicToken: string, metadata: Record<string, any>) => {
      try {
        if (action.plaid_action === 'identity') {
          const res = await client.fetchPlaidVerificationStatus(
            metadata.link_session_id
          );
          const statusKey = action.plaid_identity_field_key;
          if (statusKey) {
            const newValues = { [statusKey]: res.status };
            updateFieldValues(newValues);
            client.submitCustom(newValues, { shouldFlush: true });
          }
          if (res.status !== 'success') {
            handleError('Identity verification was not successful');
            await new Promise((resolve) => setTimeout(resolve, 2000));
            return;
          }
        } else if (publicToken) {
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
