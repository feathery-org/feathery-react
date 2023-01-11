import React, { useEffect } from 'react';
import { useHistory } from 'react-router-dom';
import Spinner from '../elements/components/Spinner';
import { isHrefFirebaseMagicLink } from '../integrations/firebase';
import { getStytchJwt } from '../utils/browser';
import { setUrlStepHash } from '../utils/formHelperFunctions';
import { initInfo, initState } from '../utils/init';

const useAuth = ({
  setLoaders,
  stepKey,
  setStepKey,
  getNextAuthStep,
  steps,
  integrations
}: {
  setLoaders: any;
  stepKey: any;
  setStepKey: any;
  getNextAuthStep: any;
  steps: any;
  integrations: any;
}) => {
  const history = useHistory();
  const redirectAfterLogin = initInfo().redirectAfterLogin;
  const authId = initInfo().authId;

  useEffect(() => {
    if (
      // We should set loader for new auth sessions
      window.location.search.includes('stytch_token_type') ||
      isHrefFirebaseMagicLink() ||
      // and existing ones
      getStytchJwt()
    ) {
      initState.redirectAfterLogin = true;
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

  useEffect(() => {
    console.log('stepKey, redirectAfterLogin', stepKey, redirectAfterLogin);
    if (
      authId &&
      stepKey === '' &&
      redirectAfterLogin &&
      Object.keys(steps).length &&
      Object.keys(integrations).length
    ) {
      const stepName = getNextAuthStep();
      console.log('useAuth useEffect. setting stepKey', stepName);
      setStepKey(stepName);
      setUrlStepHash(history, steps, stepName);
    }
  }, [stepKey, redirectAfterLogin, steps, integrations, authId]);
};

export default useAuth;
