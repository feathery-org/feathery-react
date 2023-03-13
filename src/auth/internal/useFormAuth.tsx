import React, { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import { authState } from '../LoginForm';
import { setUrlStepHash } from '../../utils/formHelperFunctions';
import { getAuthIntegrationMetadata } from './utils';

const useFormAuth = ({
  initialStep,
  integrations,
  setStepKey,
  steps
}: {
  initialStep: string;
  integrations: null | Record<string, any>;
  setStepKey: React.Dispatch<React.SetStateAction<string>>;
  steps: any;
}) => {
  const history = useHistory();

  // This hook sets the step key & hash once auth has been completed
  useEffect(() => {
    if (
      authState.authId &&
      authState.redirectAfterLogin &&
      Object.keys(steps).length &&
      integrations &&
      Object.keys(integrations).length
    ) {
      const stepName = getNextAuthStep();
      setStepKey(stepName);
      setUrlStepHash(history, steps, stepName);
      authState.redirectAfterLogin = false;
    }
  }, [authState.redirectAfterLogin, steps, integrations, authState.authId]);

  // This hook is needed to prevent a bug on localhost. Cookies can't be
  // distinguished by port and stytch uses cookie to expose JWT. So, if one is
  // logged into the dashboard locally and tries to load a form with local
  // hosted forms, the form sees the JWT for dashboard and will set the full
  // page loader. Unfortunately, integration info is not available at that time
  // so we can't prevent the loader from being set for this edge case. Instead
  // we need to wait until integrations have been loaded and clear the loader if
  // there are no auth integrations.
  useEffect(() => {
    // We can't just check to see if there is no stytch because that would
    // improperly clear the loaders when stytch isn't configured but firebase is
    const metadata = getAuthIntegrationMetadata(integrations);
    if (authState.redirectAfterLogin && integrations && !metadata) {
      authState.redirectAfterLogin = false;
      // We also need to set the step & hash because both those actions were
      // blocked by the `if (authState.redirectAfterLogin) return;` early
      // return in Form's fetchSession.then fn call
      setStepKey(initialStep);
      setUrlStepHash(history, steps, initialStep);
    }
  }, [integrations]);

  /**
   * @param nextStepCandidate This param is needed for getNewStep fn in <Form
   * />. The fn is getting a new step, but it is possible that the user is
   * trying to navigate to a step that is protected while they are logged out
   *
   * @returns The step name to navigate to for auth purposes. Or '' if there is
   * no transition to make
   */
  const getNextAuthStep = (nextStepCandidate?: any): string => {
    const metadata = getAuthIntegrationMetadata(integrations);
    const authSteps = metadata?.auth_gate_steps ?? [];
    const nextStepIsProtected = nextStepCandidate
      ? authSteps.includes(nextStepCandidate.id)
      : false;

    if (!authSteps.length) {
      return '';
    }

    const findStepName = (stepId: string): string => {
      const step: undefined | { key: string } = Object.values(steps).find(
        (step: any) => step.id === stepId
      ) as undefined | { key: string };
      return step?.key ?? '';
    };
    let nextStep = '';
    const userAuthed = Boolean(authState.authId);

    if (userAuthed && authState.redirectAfterLogin)
      nextStep = findStepName(metadata.login_step);
    else if (!userAuthed && nextStepIsProtected)
      nextStep = findStepName(metadata.logout_step);

    return nextStep;
  };

  return getNextAuthStep;
};

export default useFormAuth;
