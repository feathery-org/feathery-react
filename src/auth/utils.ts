import { authState } from './LoginProvider';
import { defaultClient } from '../utils/init';
import { emailLogin as emailLoginFirebase } from '../integrations/firebase';
import { emailLogin as emailLoginStytch } from '../integrations/stytch';
import Client from '../utils/client';

export function setAuthClient(client: any): void {
  authState.authClient = client;
  // Attempt login after setting auth client, in case the auth client wasn't set
  // when auth was already attempted after initializing the integrations
  inferEmailLoginFromURL(defaultClient);
}

export function getAuthClient(): any {
  return authState.authClient;
}

export function inferEmailLoginFromURL(featheryClient: Client) {
  const queryParams = new URLSearchParams(window.location.search);
  const type = queryParams.get('stytch_token_type');
  const token = queryParams.get('token');
  if (isAuthStytch() || (type && token))
    return emailLoginStytch(featheryClient);
  else return emailLoginFirebase(featheryClient);
}

export function inferAuthLogout() {
  let logout;
  if (isAuthStytch()) {
    logout = () => getAuthClient().session.revoke();
  } else if (global.firebase) {
    logout = () => global.firebase.auth().signOut();
  }

  // logout may not have a value in certain cases, i.e. stytch is already logged out so there is no jwt
  if (!logout) return;

  logout().then(() => {
    authState.onLogout();
    authState.authPhoneNumber = '';
    authState.authEmail = '';
    authState.setAuthId('');
  });
}

export function isAuthStytch() {
  const authClient = getAuthClient();
  if (!authClient) return;
  const isAuthClientStytch = Object.getOwnPropertySymbols(authClient)
    .map((symbol) => symbol.toString())
    .includes('Symbol(stytch__internal)');
  // Still check global.Stytch for back compat, if customer is using old package.
  // TODO: remove the global.Stytch part of this || once the new package has been out for longer
  return global.Stytch || isAuthClientStytch;
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
