import { getAuthIntegrationMetadata } from './internal/utils';

export const getLoginStep = (steps: any, integrations: any) => {
  const authIntegration = getAuthIntegrationMetadata(integrations);
  return Object.values(steps).find(
    (step: any) => step.id === authIntegration.login_step
  );
};
