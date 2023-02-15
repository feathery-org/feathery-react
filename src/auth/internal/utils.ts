import { authState } from '../LoginProvider';
import { emailLogin as emailLoginFirebase } from '../../integrations/firebase';
import { emailLogin as emailLoginStytch } from '../../integrations/stytch';
import Client from '../../utils/client';

export function inferEmailLoginFromURL(featheryClient: Client) {
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (isAuthStytch() || (type && token))
    return emailLoginStytch(featheryClient);
  else return emailLoginFirebase(featheryClient);
}

export async function inferAuthLogout() {
  if (!authState.client) return;

  if (isAuthStytch()) {
    await authState.client.session.revoke();
  } else if (global.firebase) {
    await authState.client.auth().signOut();
  }

  authState.onLogout();
  authState.authPhoneNumber = '';
  authState.authEmail = '';
  authState.setAuthId('');
}

export function isAuthStytch() {
  if (!authState.client) return;
  return Object.getOwnPropertySymbols(authState.client)
    .map((symbol) => symbol.toString())
    .includes('Symbol(stytch__internal)');
}

export function getAuthIntegrationMetadata(
  integrations: null | Record<string, any>
): undefined | any {
  return integrations?.stytch?.metadata ?? integrations?.firebase?.metadata;
}

/**
 * Determines whether form should be considered completed or not. Completed
 * should be false if it is a 'terminal step' in the middle of a login flow with
 * steps configured for after login
 * @param authIntegration
 * @param stepId terminal step ID
 * @returns {boolean} true if there are auth gated steps after this one
 */
export function isTerminalStepAuth(
  authIntegration: any,
  stepId: string
): boolean {
  return (
    authState.sentAuth &&
    authIntegration?.auth_gate_steps.length &&
    !authIntegration?.auth_gate_steps.includes(stepId)
  );
}
