import React, { useEffect, useRef } from 'react';
import { useHistory } from 'react-router-dom';
import Spinner from '../elements/components/Spinner';
import { isHrefFirebaseMagicLink } from '../integrations/firebase';
import { getStytchJwt } from '../utils/browser';
import { setUrlStepHash } from '../utils/formHelperFunctions';
import { initInfo } from '../utils/init';

const useAuth = ({
  setLoaders,
  stepKey,
  setStepKey,
  steps,
  integrations,
  initialStep
}: {
  setLoaders: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  stepKey: string;
  setStepKey: React.Dispatch<React.SetStateAction<string>>;
  steps: any;
  integrations: null | Record<string, any>;
  initialStep: string;
}) => {
  const history = useHistory();
  // This is a flag so we only redirect to the login start step immediately
  // after auth, not during other form navigation
  const redirectAfterLoginRef = useRef<boolean>(false);
  const authId = initInfo().authId;

  // This hook detects the login process then sets the redirect flag
  // & auth loader
  useEffect(() => {
    if (
      // We should set loader for new auth sessions
      window.location.search.includes('stytch_token_type') ||
      isHrefFirebaseMagicLink() ||
      // and existing ones
      getStytchJwt()
    ) {
      redirectAfterLoginRef.current = true;
      setLoaders((loaders: any) => ({
        ...loaders,
        auth: {
          showOn: 'full_page',
          loader: (
            <div style={{ height: '10vh', width: '10vh' }}>
              <Spinner />
            </div>
          )
        }
      }));
    }
  }, []);

  // This hook sets the step key & hash once auth has been completed
  useEffect(() => {
    if (
      authId &&
      stepKey === '' &&
      redirectAfterLoginRef.current &&
      Object.keys(steps).length &&
      integrations &&
      Object.keys(integrations).length
    ) {
      const stepName = getNextAuthStep();
      setStepKey(stepName);
      setUrlStepHash(history, steps, stepName);
      redirectAfterLoginRef.current = false;
    }
  }, [stepKey, redirectAfterLoginRef.current, steps, integrations, authId]);

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
    const metadata = getMetadata(integrations);
    if (redirectAfterLoginRef.current && integrations && !metadata) {
      redirectAfterLoginRef.current = false;
      setLoaders({});
      // We also need to set the step & hash because both those actions were
      // blocked by the `if (redirectAfterLoginRef.current) return;` early
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
    const metadata = getMetadata(integrations);
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
    const userAuthed = Boolean(initInfo().authId);

    if (userAuthed && redirectAfterLoginRef.current) {
      nextStep = findStepName(metadata.login_step);
    } else if (!userAuthed && nextStepIsProtected)
      nextStep = findStepName(metadata.logout_step);

    return nextStep;
  };

  return {
    getNextAuthStep,
    // Need to return the ref rather than the value because otherwise the value
    // is stale. This prevents navigation to any other step because the code
    // sees the flag as true so it sets the next step to the login start step,
    // rather than the step the user is trying to nav to
    redirectAfterLoginRef
  };
};

const getMetadata = (integrations: null | Record<string, any>) =>
  integrations?.stytch?.metadata ?? integrations?.firebase?.metadata;

export default useAuth;
