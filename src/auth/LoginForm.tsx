import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react';
import { JSForm, Props as FormProps } from '../Form';
import { defaultClient, initInfo } from '../utils/init';
import { v4 as uuidv4 } from 'uuid';
import {
  registerRenderCallback,
  rerenderAllForms
} from '../utils/formHelperFunctions';
import Auth from './internal/AuthIntegrationInterface';
import { clearStytchDomainCookie } from '../integrations/stytch';
/** TODO: These next 2 should maybe be dynamically imported, but having trouble with that
 * combined 6.9k gzipped, so OK for now
 */
import { useIdleTimer } from 'react-idle-timer';
import throttle from 'lodash.throttle';
import LoginError from './LoginError';
import { featheryWindow } from '../utils/browser';

const TEN_SECONDS_IN_MILLISECONDS = 1000 * 10;
const FIVE_MINUTES_IN_MILLISECONDS = 1000 * 60 * 5;

export const AuthContext = createContext<any>(null);

export const authState = {
  client: null as any,
  authId: '',
  authType: '',
  _featheryHosted: false,
  // This is a flag so we only redirect to the login start step immediately
  // after auth, not during other form navigation
  redirectAfterLogin: false,
  sentAuth: false,
  setAuthId: (newId: string) => {
    authState.authId = newId;
  },
  setClient: (newClient: any) => {
    authState.client = newClient;
  },
  onLogin: () => {},
  onLogout: () => {},
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  showError: (msg?: string) => {}
};

const LoginForm = ({
  authId: authIdProp,
  formProps,
  loginPath,
  onLogin = () => {},
  onLogout = () => {},
  onClientReady = () => {},
  _featheryHosted = false,
  children
}: {
  authId?: string;
  formProps: FormProps;
  loginPath?: string;
  onLogin?: () => void;
  onLogout?: () => void;
  onClientReady?: (authClient: any) => void;
  _featheryHosted?: boolean;
  children?: JSX.Element;
}) => {
  const [_internalId] = useState(uuidv4());
  const formCompleted =
    initInfo().formSessions[formProps.formName]?.form_completed ?? false;

  // Need to use this flag because when doing magic link login the onChange
  // event doesn't seem to be added early enough to catch the first event which
  // is the one containing the token. subsequent events do not contain the token
  const hasAuthedRef = useRef(false);
  // Use this render state to force re-evaluation of authId, since authState isn't reactive as-is
  const [, setRender] = useState({ v: 1 });
  const [showLoader, setShowLoader] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('Your magic link expired.');

  useEffect(() => {
    if (
      // We should set loader for new auth sessions
      Auth.isHrefMagicLink() ||
      // and existing ones
      Auth.isThereAnExistingSession()
    ) {
      authState.redirectAfterLogin = true;
      setShowLoader(true);
    }

    const { location, history } = featheryWindow();
    // only need to redirect to login path for new logins
    if (
      !Auth.isThereAnExistingSession() &&
      loginPath &&
      location.pathname !== loginPath
    ) {
      // If user is not at the URL whitelisted for auth, take them there for login
      history.replaceState(null, '', loginPath + location.search);
    }

    authState._featheryHosted = _featheryHosted;

    authState.showError = (msg?: string) => {
      if (msg) setErrorMessage(msg);
      setLoginError(true);
    };
    // Register onLogin cb so it can be called by Client.submitAuthInfo
    authState.onLogin = async () => {
      await onLogin();
      setShowLoader(false);
    };
    authState.onLogout = onLogout;
    authState.setAuthId = (newId: string) => {
      if (newId === '') {
        // [Hosted Login] Cleanup if user is logged out. Necessary if user was
        // logged out on another domain, but appropriate logic to run in any
        // case.
        authState.redirectAfterLogin = false;
        setShowLoader(false);
        clearStytchDomainCookie();
      }

      authState.authId = newId;
      hasAuthedRef.current = newId !== '';
      // Execute render callbacks after setting authId, so that form navigation can be evaluated again
      rerenderAllForms();
    };
    authState.setClient = (newClient: any) => {
      authState.client = newClient;
      Auth.initializeAuthClientListeners();
      onClientReady(newClient);
    };

    registerRenderCallback(_internalId, 'loginForm', () => {
      setRender((render) => ({ ...render }));
    });
  }, []);

  useEffect(() => {
    // If user passes authId as a prop, we need to submit it
    if (authIdProp) {
      defaultClient.submitAuthInfo({
        authId: authIdProp
      });
    }
  }, [authIdProp]);

  const onActive = useCallback(
    throttle(
      () =>
        Auth.idleTimerAction(hasAuthedRef.current, () => {
          hasAuthedRef.current = false;
          authState.setAuthId('');
          onLogout();
        }),
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

  if (
    authState.authId &&
    formCompleted &&
    initInfo().redirectCallbacks[_internalId]
  ) {
    // If logged in and have finished onboarding questions for an apex form, then we need to redirect back to application
    initInfo().redirectCallbacks[_internalId]();
    return null;
  } else if (!authState.authId || !formCompleted || !children) {
    // If not logged in, the form isn't complete, or there is nothing to show otherwise, show the login form
    return (
      // Since we want to auth gate we should make the login form take up the entire page
      <div style={{ height: '100vh', width: '100vw' }}>
        {loginError ? (
          <LoginError message={errorMessage} />
        ) : (
          <JSForm
            {...formProps}
            _internalId={_internalId}
            _isAuthLoading={showLoader}
          />
        )}
      </div>
    );
  } else {
    // Safe to pass authState.client, rather than a React state reference,
    // because the children are only rendered if the user is logged in,
    // which requires the auth client to be set. And we do not support
    // changing the client midway through runtime
    return (
      <AuthContext.Provider value={authState.client}>
        {children}
      </AuthContext.Provider>
    );
  }
};

export default LoginForm;
