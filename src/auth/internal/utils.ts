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
  const currentParams = new URLSearchParams(search);

  // Build the redirect query from scratch rather than deleting out of the
  // current one: deleting while iterating skips every other param.
  const redirectParams = new URLSearchParams();

  // If no _slug param, extract slug from /to/<slug> path
  const slug =
    currentParams.get('_slug') ?? pathname.match(/\/to\/([^/]+)/)?.[1];
  if (slug) redirectParams.set('_slug', slug);

  // Kept for the same reason the user-id rewrite keeps it: the form has to come
  // back from the auth provider in the language it was opened in
  const locale = currentParams.get('_locale');
  if (locale) redirectParams.set('_locale', locale);

  // The access link token has to survive the login round trip, or the form
  // comes back from the auth provider without the credential that opens it
  const linkToken = currentParams.get(LINK_TOKEN_PARAM);
  if (linkToken) redirectParams.set(LINK_TOKEN_PARAM, linkToken);

  // Strip the /to/<slug> segment
  const cleanPathname = pathname.replace(/\/to\/[^/]+/, '');
  const queryString = redirectParams.toString() ? `?${redirectParams}` : '';
  return `${origin}${cleanPathname}${queryString}${hash}`;
}
