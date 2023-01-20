import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form } from '../..';
import { Props as FormProps } from '../../Form';
import { getStytchJwt } from '../../utils/browser';
import { getAuthClient, initInfo, initState } from '../../utils/init';
import { authHookCb } from '../../integrations/stytch';
import Client from '../../utils/client';
import { isAuthStytch } from '../../integrations/utils';
import Spinner from './Spinner';
import { isHrefFirebaseMagicLink } from '../../integrations/firebase';
/** TODO: These next 2 should maybe be dynamically imported, but having trouble with that
 * combined 6.9k gzipped, so OK for now
 */
import { useIdleTimer } from 'react-idle-timer';
import throttle from 'lodash.throttle';

const TEN_SECONDS_IN_MILLISECONDS = 1000 * 10;
const FIVE_MINUTES_IN_MILLISECONDS = 1000 * 60 * 5;

export const authState = {
  // This is a flag so we only redirect to the login start step immediately
  // after auth, not during other form navigation
  redirectAfterLogin: false,
  sentAuth: false,
  clearLoader: () => {},
  onLogin: () => {},
  onLogout: () => {}
};

const FeatheryAuthGate = ({
  authId: authIdProp,
  formProps,
  whitelistPath,
  fullPageLogin,
  onLogin = () => {},
  onLogout = () => {},
  children
}: {
  authId?: string;
  formProps: FormProps;
  whitelistPath?: string;
  fullPageLogin?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
  children: JSX.Element;
}) => {
  const formCompleted = initInfo().sessions[formProps.formName]?.form_completed;

  // Need to use this flag because when doing magic link login the onChange
  // event doesn't seem to be added early enough to catch the first event which
  // is the one containing the token. subsequent events do not contain the token
  const hasAuthedRef = useRef(false);
  // Use this render state to force re-evaluation of initState, since initState isn't reactive as-is
  const [render, setRender] = useState(true);
  const [showLoader, setShowLoader] = useState(false);
  authHookCb.cb = () => setRender((prev) => !prev);

  const logoutActions = () => {
    hasAuthedRef.current = false;
    initState.authId = undefined;
    onLogout();
  };

  useEffect(() => {
    if (
      window.location.hostname !== 'localhost' &&
      // We should set loader for new auth sessions
      (window.location.search.includes('stytch_token_type') ||
        isHrefFirebaseMagicLink() ||
        // and existing ones
        getStytchJwt())
    ) {
      authState.redirectAfterLogin = true;
      setShowLoader(true);
    }

    const { location, history } = window;
    if (whitelistPath && location.pathname !== whitelistPath) {
      // If user is not at the URL whitelisted for auth, take them there for login
      history.replaceState(null, '', whitelistPath);
    }

    authState.clearLoader = () => setShowLoader(false);
    // Register onLogin cb so it can be called by Client.submitAuthInfo
    authState.onLogin = onLogin;
    authState.onLogout = onLogout;

    // If user passes authId as a prop, we need to submit it
    if (authIdProp) {
      const defaultClient = new Client();
      defaultClient.submitAuthInfo({
        authId: authIdProp
      });
    }
  }, []);

  useEffect(() => {
    if (!isAuthStytch()) return;

    const authClient = getAuthClient();

    const unsubscribe = authClient.session.onChange((newSession: any) => {
      if (hasAuthedRef.current && newSession === null) {
      } else if (newSession?.stytch_session?.session_jwt ?? getStytchJwt())
        hasAuthedRef.current = true;
    });

    return unsubscribe;
  }, [render]);

  const onActive = useCallback(
    throttle(
      () => {
        const stytchClient = getAuthClient();
        if (!stytchClient) return;

        const session = stytchClient.session.getSync();

        if (session) {
          stytchClient.session.authenticate({
            session_duration_minutes: 1440
          });
        } else if (hasAuthedRef.current) {
          stytchClient.session.revoke().then(logoutActions);
        }
      },
      FIVE_MINUTES_IN_MILLISECONDS,
      { leading: true, trailing: false }
    ),
    []
  );

  useIdleTimer({
    // Need to use lodash throttle rather than IdleTimer throttle because the
    // IdleTimer throttle resets after the idle timeout. So, after 10 seconds of
    // no activity the user moves the mouse and onActive fires as expected. Then
    // if the idle timeout passes again and the user moves the mouse again,
    // onActive will fire a second time, only 10 seconds after the first time,
    // despite the 5 minute throttle. We need a low timeout to quickly detect
    // if the user session has expired upon returning to feathery.
    onActive,
    timeout: TEN_SECONDS_IN_MILLISECONDS
  });

  const form = (
    <>
      {showLoader && (
        <div
          style={{
            // TODO: what should the background color be?
            backgroundColor: '#FFF',
            // backgroundColor: `#${activeStep?.default_background_color ?? 'FFF'}`,
            position: 'fixed',
            height: '100vh',
            width: '100vw',
            zIndex: 50,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          <div style={{ height: '10vh', width: '10vh' }}>
            <Spinner />
          </div>
        </div>
      )}
      <Form {...formProps} />
    </>
  );
  if (!initInfo().authId || !formCompleted) {
    return !fullPageLogin ? (
      form
    ) : (
      <div style={{ height: '100vh' }}>{form}</div>
    );
  } else return children;
};

export default FeatheryAuthGate;
