import { authState } from '../LoginForm';

export function isAuthStytch() {
  if (authState.client) {
    return Object.getOwnPropertySymbols(authState.client)
      .map((symbol) => symbol.toString())
      .includes('Symbol(stytch__internal)');
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

export function areThereOnboardingQuestions(integrations: any): boolean {
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

// TODO: need to set local formCompleted so that the flag is set when verifying sms code
export function sendCompletedEventIfNoOnboarding(
  integrations: any,
  stepKey: string,
  client: any,
  authAction: () => void
) {
  const onboardingExists = areThereOnboardingQuestions(integrations);
  if (!onboardingExists) {
    const eventData: Record<string, any> = {
      step_key: stepKey,
      event: 'complete'
    };
    client.registerEvent(eventData).then(authAction);
  } else {
    authAction();
  }
}

export function getRedirectUrl() {
  const { origin, pathname, hash } = window.location;
  const queryParams = new URLSearchParams(window.location.search);
  queryParams.forEach((value, key) => {
    if (!['feathery_1', 'feathery_2', '_slug'].includes(key))
      queryParams.delete(key);
  });
  const queryString =
    queryParams.has('feathery_1') || queryParams.has('_slug')
      ? `?${queryParams}`
      : '';
  return `${origin}${pathname}${queryString}${hash}`;
}
