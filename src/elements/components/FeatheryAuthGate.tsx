import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Form } from '../..';
import { Props as FormProps } from '../../Form';
import { getStytchJwt } from '../../utils/browser';
import { getAuthClient, initInfo, initState } from '../../utils/init';
import { authHookCb } from '../../integrations/stytch';
/** TODO: These next 2 should maybe be dynamically imported, but having trouble with that
 * combined 6.9k gzipped, so OK for now
 */
import { useIdleTimer } from 'react-idle-timer';
import throttle from 'lodash.throttle';

const TEN_SECONDS_IN_MILLISECONDS = 1000 * 10;
const FIVE_MINUTES_IN_MILLISECONDS = 1000 * 60 * 5;

// NEED to look to see if form is completed. show onboarding if not
// ned to store when sending the magic link. look to not set complete if flag is set, current step isn't auth gated and the form has auth gated steps

// need to highlight both ways in the docs for this. onboarding form is part of
// the form, and it is a new form sent in children where hide if complete is
// checked on feathery dashboard and it doesn't get shown again

const FeatheryAuthGate = ({
  // authId,
  formProps,
  // provide internal loading logic? not sure because this loading state
  // is really meant to show a loader after auth is complete but the host app
  // needs to fetch resources (i.e. fetchResources() in our App.tsx)
  whitelistPath,
  fullPageLogin,
  onLogin = () => {},
  onLogout = () => {},
  children
}: {
  // authId?:string;
  formProps: FormProps;
  whitelistPath?: string;
  fullPageLogin?: boolean;
  onLogin?: () => void;
  onLogout?: () => void;
  children: JSX.Element;
}) => {
  const authId = initInfo().authId;

  // Need to use this flag because when doing magic link login the onChange
  // event doesn't seem to be added early enough to catch the first event which
  // is the one containing the token. subsequent events do not contain the token
  const hasAuthedRef = useRef(false);
  // Use this render state to force re-evaluation of initState, since initState isn't reactive as-is
  const [render, setRender] = useState(true);
  authHookCb.cb = () => setRender((prev) => !prev);

  const logoutActions = () => {
    hasAuthedRef.current = false;
    initState.authId = undefined;
    onLogout();
  };

  useEffect(() => {
    const authClient = getAuthClient();
    if (!authClient) return;

    const unsubscribe = authClient.session.onChange((newSession: any) => {
      if (hasAuthedRef.current) {
        if (newSession === null) logoutActions();
        return;
      }
      // This onChange is just meant to set the token on initial login. It is
      // not to cache the token. The token is retrieved directly every time it
      // is needed by the function getStytchJwt
      const newToken =
        newSession?.stytch_session?.session_jwt ?? getStytchJwt();
      if (!newToken) return;
      hasAuthedRef.current = true;
      // cb to fetch resources
      onLogin();
    });

    return unsubscribe;
  }, [render]);

  useEffect(() => {
    // When reloading the page, with an existing session, the above onChange
    // doesn't fire, so we need to just identify if there is an existing token
    // and execute onAuth
    if (getStytchJwt()) onLogin();
  }, []);

  useEffect(() => {
    const { location, history } = window;
    if (whitelistPath && location.pathname !== whitelistPath) {
      // If user is not at the URL whitelisted for auth, take them there for login
      history.replaceState(null, '', whitelistPath);
    }
  }, []);

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

  const form = <Form {...formProps} />;
  if (!authId) {
    return !fullPageLogin ? (
      form
    ) : (
      <div style={{ height: '100vh' }}>{form}</div>
    );
  } else return children;
};

export default FeatheryAuthGate;
