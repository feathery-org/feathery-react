import { useCallback, useEffect, useState } from 'react';
import { authHookCb } from '../integrations/stytch';
import { getStytchJwt } from '../utils/browser';
import { getAuthClient } from '../utils/init';
/** These next 2 should maybe be dynamically imported, but having trouble with that */
import { useIdleTimer } from 'react-idle-timer';
import throttle from 'lodash.throttle';

const TEN_SECONDS_IN_MILLISECONDS = 1000 * 10;
const FIVE_MINUTES_IN_MILLISECONDS = 1000 * 60 * 5;

export const useAuth = ({
  onAuth = () => {},
  onLogout = () => {
    // @ts-expect-error TS(2322) FIXME: Type 'string' is not assignable to type '(string |... Remove this comment to see the full error message
    window.location = window.location.origin;
  }
}) => {
  // Need to use this flag because when doing magic link login the onChange
  // event doesn't seem to be added early enough to catch the first event which
  // is the one containing the token. subsequent events do not contain the token
  const [hasAuthed, setHasAuthed] = useState(false);
  // Use this render state to force re-evaluation of initState, since initState isn't reactive as-is
  const [render, setRender] = useState(true);
  authHookCb.cb = () => setRender((prev) => !prev);

  useEffect(() => {
    const authClient = getAuthClient();
    if (!authClient) return;

    const unsubscribe = authClient.session.onChange((newSession: any) => {
      if (hasAuthed) return;
      // This onChange is just meant to set the token on initial login. It is
      // not to cache the token. The token is retrieved directly every time it
      // is needed by the function getStytchJwt
      const newToken =
        newSession?.stytch_session?.session_jwt ?? getStytchJwt();
      if (!newToken) return;
      setHasAuthed(true);
      // cb to fetch resources
      onAuth();
    });

    return unsubscribe;
  }, [render]);

  useEffect(() => {
    // When reloading the page, with an existing session, the above onChange
    // doesn't fire, so we need to just identify if there is an existing token
    // and execute onAuth
    if (getStytchJwt()) onAuth();
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
        } else if (hasAuthed) {
          stytchClient.session.revoke().then(() => {
            setHasAuthed(false);
            onLogout();
          });
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
};
