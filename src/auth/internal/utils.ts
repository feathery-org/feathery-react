import { LINK_TOKEN_PARAM } from '../../utils/accessLink';
import { featheryWindow } from '../../utils/browser';
import { authState } from '../LoginForm';

export function isAuthStytch() {
  if (authState.client) {
    return Object.getOwnPropertySymbols(authState.client)
      .map((symbol) => symbol.toString())
      .includes('Symbol(stytch__internal_b2c)');
  }
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
    authIntegration?.auth_gate_steps?.length &&
    !authIntegration?.auth_gate_steps.includes(stepId)
  );
}

export function hasAuthGatedSteps(integrations: any): boolean {
  const authIntegration = getAuthIntegrationMetadata(integrations);
  if (!authIntegration) return false;
  // Form should be considered complete if there is no login step or
  // protected steps. That means there are no onboarding questions.
  const isOnboarding =
    authIntegration.auth_gate_steps.length === 0 &&
    authIntegration.login_step === '' &&
    authIntegration.logout_step !== '';

  return !isOnboarding;
}

export function getRedirectUrl() {
  const { origin, pathname, hash, search } = featheryWindow().location;
  const queryParams = new URLSearchParams(search);

  // If no _slug param, extract slug from /to/<slug> path
  if (!queryParams.has('_slug')) {
    const toMatch = pathname.match(/\/to\/([^/]+)/);
    if (toMatch) {
      queryParams.set('_slug', toMatch[1]);
    }
  }

  // The access link token has to survive the login round trip, or the form
  // comes back without the credential that opens it. So does its language.
  const keptParams = ['_slug', '_locale', LINK_TOKEN_PARAM];
  queryParams.forEach((value, key) => {
    if (!keptParams.includes(key)) queryParams.delete(key);
  });

  // Strip the /to/<slug> segment
  const cleanPathname = pathname.replace(/\/to\/[^/]+/, '');
  const queryString =
    queryParams.has('_slug') || queryParams.has(LINK_TOKEN_PARAM)
      ? `?${queryParams}`
      : '';
  return `${origin}${cleanPathname}${queryString}${hash}`;
}
