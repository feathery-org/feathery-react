import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup
} from '@testing-library/react';
import { JSForm } from '..';

type ClickActionElement = {
  id: string;
  properties: Record<string, any>;
  repeat?: number;
};

// Router mocks
jest.mock('../../hooks/router', () => {
  return {
    RouterProvider: ({ children }: any) => <>{children}</>,
    useNavigate: () => jest.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '' })
  };
});

// React-Bootstrap Form mock (forwardRef to accept ref without warnings)
jest.mock('react-bootstrap/Form', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  const FormMock = React.forwardRef(function FormMock(props: any, ref: any) {
    // Avoid jsdom HTMLFormElement.prototype.submit by ensuring no implicit submit
    return <form ref={ref} {...props} />;
  });
  return {
    __esModule: true,
    default: FormMock
  };
});

// lodash.debounce mock: run immediately and expose cancel()
jest.mock('lodash.debounce', () => {
  return (fn: any) => {
    const wrapped: any = (...args: any[]) => fn(...args);
    wrapped.cancel = jest.fn();
    return wrapped;
  };
});

// Hydration utilities
jest.mock('../../utils/hydration', () => ({
  calculateStepCSS: () => ({ backgroundColor: 'transparent' }),
  calculateGlobalCSS: () => ({ getTarget: () => ({}) })
}));

// Array utils
jest.mock('../../utils/array', () => ({
  isEmptyArray: (v: any) => Array.isArray(v) && v.length === 0,
  justInsert: (arr: any[], val: any, idx: number) => {
    const c = arr.slice();
    c[idx] = val;
    return c;
  },
  justRemove: (arr: any[], idx: number) =>
    arr.filter((_: any, i: number) => i !== idx),
  toList: (v: any) =>
    Array.isArray(v)
      ? v
      : String(v)
          .split(',')
          .map((s) => s.trim())
}));

// Repeat utils
jest.mock('../../utils/repeat', () => ({
  getContainerById: () => undefined,
  getFieldsInRepeat: () => [],
  getRepeatedContainer: () => undefined
}));

// Hide and repeats
jest.mock('../../utils/hideAndRepeats', () => ({
  getHideIfReferences: () => new Set(),
  getPositionKey: () => 'k',
  getVisiblePositions: () => ({})
}));

// Validation
jest.mock('../../utils/validation', () => ({
  validateElements: () => ({ invalid: false, inlineErrors: {} }),
  validators: { phone: () => true, email: () => true }
}));

// Init and globals
jest.mock('../../utils/init', () => {
  const initState = {
    isTestEnv: true,
    language: 'en',
    formSessions: {},
    renderCallbacks: {},
    redirectCallbacks: {},
    remountCallbacks: {},
    defaultErrors: {}
  };
  return {
    defaultClient: { flushCustomFields: jest.fn() },
    FieldValues: {} as any,
    fieldValues: {} as any,
    initState,
    updateUserId: jest.fn()
  };
});

// Form helper functions
jest.mock('../../utils/formHelperFunctions', () => ({
  calculateGlobalCSS: () => ({ getTarget: () => ({}) }),
  calculateStepCSS: () => ({}),
  castHiddenVal: (_: any, v: any) => v,
  castServarVal: (_: any, v: any) => v,
  changeStep: (_n: any, _o: any, _s: any, setStepKey: any) => {
    // Simulate successful step change
    setStepKey(_n);
    return true;
  },
  clearBrowserErrors: () => {},
  FieldOptions: {},
  FieldProperties: {},
  FieldStyles: {},
  formatStepFields: () => ({}),
  getAllElements: () => [],
  getAllFields: () => ({}),
  getDefaultFieldValue: () => '',
  getDefaultFormFieldValue: () => '',
  getFieldValue: () => ({ value: '', valueList: undefined }),
  getInitialStep: ({ initialStepId }: any) => initialStepId || 'step-1',
  getNewStepUrl: (k: string) => `/#${k}`,
  getOrigin: () => ({ key: 'origin' }),
  getPrevStepKey: () => '',
  getUrlHash: () => '',
  httpHelpers: () => ({}),
  isElementInViewport: () => true,
  isStepTerminal: () => false,
  isValidFieldIdentifier: () => true,
  lookUpTrigger: () => ({}),
  mapFormSettingsResponse: () => ({}),
  nextStepKey: () => undefined,
  prioritizeActions: (a: any) => a,
  recurseProgressDepth: () => [0, 1],
  registerRenderCallback: () => {},
  rerenderAllForms: () => {},
  saveInitialValuesAndUrlParams: () => {},
  setFormElementError: () => {},
  setUrlStepHash: () => {},
  updateCustomCSS: () => {},
  updateCustomHead: () => {},
  updateStepFieldOptions: () => {},
  updateStepFieldProperties: () => {},
  updateStepFieldStyles: () => {}
}));

// Grid mock: no out-of-scope captures, only uses props
jest.mock('../grid', () => {
  const GridMock = ({ form }: any) => {
    return (
      <button
        data-testid='btn'
        type='button' // <-- prevent implicit form submit
        onClick={() =>
          form.buttonOnClick({
            id: 'b1',
            properties: { actions: [], submit: false },
            repeat: 0
          } as ClickActionElement)
        }
      >
        trigger
      </button>
    );
  };
  return { __esModule: true, default: GridMock };
});

jest.mock('../components/DevNavBar', () => () => null);
jest.mock('../../elements/components/Watermark', () => () => null);
jest.mock('../../elements/components/Lottie', () => () => null);
jest.mock('../../elements/components/QuikFormViewer', () => () => null);
jest.mock('../../elements/components/Spinner', () => () => null);

// Integrations and utils
jest.mock('../../integrations/firebase', () => ({
  useFirebaseRecaptcha: () => {}
}));
jest.mock('../../integrations/plaid', () => ({ openPlaidLink: jest.fn() }));
jest.mock('../../integrations/stripe', () => ({
  addToCart: jest.fn(),
  checkForPaymentCheckoutCompletion: jest.fn(),
  getCart: jest.fn(() => ({})),
  getLiveOrTestProduct: jest.fn(),
  getSimplifiedProducts: jest.fn(() => ({})),
  isProductInPurchaseSelections: jest.fn(() => false),
  purchaseCart: jest.fn(),
  removeFromCart: jest.fn(),
  setupPaymentMethod: jest.fn(),
  usePayments: jest.fn(() => [() => null, jest.fn()])
}));
jest.mock('../../integrations/persona', () => ({ triggerPersona: jest.fn() }));
jest.mock('../../integrations/alloy', () => ({ verifyAlloyId: jest.fn() }));
jest.mock('../../integrations/flinks', () => ({
  useFlinksConnect: jest.fn(() => ({
    openFlinksConnect: jest.fn(),
    flinksFrame: null
  }))
}));

jest.mock('../../utils/browser', () => ({
  downloadAllFileUrls: jest.fn(),
  featheryWindow: () => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    scrollTo: jest.fn(),
    location: { href: '', pathname: '/', search: '' }
  }),
  openTab: jest.fn(),
  runningInClient: () => true
}));

jest.mock('../../elements/styles', () => ({
  DEFAULT_MOBILE_BREAKPOINT: 480,
  getViewport: () => ({})
}));

jest.mock('../../utils/formContext', () => ({ getFormContext: () => ({}) }));
jest.mock('../../utils/sensitiveActions', () => ({
  getPrivateActions: () => ({})
}));

jest.mock('uuid', () => ({ v4: () => 'uuid-1' }));

// internalState and setter
jest.mock('../../utils/internalState', () => ({
  __esModule: true,
  default: {},
  setFormInternalState: jest.fn()
}));

// Auth flow
jest.mock('../../auth/internal/useFormAuth', () => ({
  __esModule: true,
  default: () => () => ''
}));

jest.mock('../../auth/LoginForm', () => ({
  authState: { authId: null, redirectAfterLogin: false, hasRedirected: false }
}));
jest.mock('../../auth/internal/utils', () => ({
  getAuthIntegrationMetadata: () => ({}),
  isTerminalStepAuth: () => false
}));

jest.mock('../../auth/internal/AuthIntegrationInterface', () => ({
  __esModule: true,
  default: {
    sendSms: jest.fn(),
    verifySMSOTP: jest.fn(),
    sendMagicLink: jest.fn(),
    oauthRedirect: jest.fn(),
    inferAuthLogout: jest.fn()
  }
}));

// useLoader with internal spies exposed
jest.mock('../../hooks/useLoader', () => {
  const clearLoaders = jest.fn();
  const setLoaders = jest.fn();
  return {
    __esModule: true,
    default: () => ({
      clearLoaders,
      stepLoader: null,
      buttonLoaders: {},
      setLoaders
    }),
    _spies: { clearLoaders, setLoaders }
  };
});

// Recaptcha
jest.mock('../../integrations/recaptcha', () => ({
  installRecaptcha: jest.fn(),
  verifyRecaptcha: jest.fn().mockResolvedValue(false)
}));

// Offline handler
jest.mock('../../utils/offlineRequestHandler', () => ({
  useOfflineRequestHandler: () => {}
}));

// Document util
jest.mock('../../utils/document', () => ({
  getSignUrl: () => 'https://example.com/sign'
}));

// Poll hook
jest.mock('../../hooks/usePollFuserData', () => ({
  __esModule: true,
  default: () => {}
}));

// useNextActionState mock with internal spies exported for assertions
jest.mock('../hooks', () => {
  const nextActionStateRef = {
    current: {
      isGettingNewStep: false,
      isNextButtonAction: false,
      latestClickedButton: null as any,
      timerIdNextActionFlag: undefined as any,
      timerIdGettingNewStep: undefined as any
    }
  };
  const setNextButtonActionFlag = jest.fn((flag: boolean) => {
    nextActionStateRef.current.isNextButtonAction = !!flag;
  });
  const clearNextActionTimer = jest.fn();
  const setGettingNewStepFlag = jest.fn((flag: boolean) => {
    nextActionStateRef.current.isGettingNewStep = !!flag;
  });
  const clearGettingNewStepTimer = jest.fn();
  const setNextButtonLoading = jest.fn();

  return {
    __esModule: true,
    useNextActionState: () => ({
      nextActionStateRef,
      setNextButtonActionFlag,
      clearNextActionTimer,
      setGettingNewStepFlag,
      clearGettingNewStepTimer,
      setNextButtonLoading
    }),
    _spies: {
      nextActionStateRef,
      setNextButtonActionFlag,
      clearNextActionTimer,
      setGettingNewStepFlag,
      clearGettingNewStepTimer,
      setNextButtonLoading
    }
  };
});

// FeatheryClient mock with a REAL step so activeStep renders and Grid appears
jest.mock('../../utils/featheryClient', () => {
  class MockClient {
    // Return one step so getNewStep can set activeStep and render Grid
    fetchForm = async () => ({
      steps: [
        {
          key: 'step-1',
          id: 's1',
          servar_fields: [],
          buttons: [],
          next_conditions: []
        }
      ],
      form_name: 'Test Form',
      completion_behavior: '',
      formOff: false,
      logic_rules: [],
      track_hashes: false
    });

    fetchSession = async () => [
      {
        current_step_key: 'step-1',
        collaborator: {},
        integrations: null,
        back_nav_map: {},
        servars: [],
        hidden_fields: {},
        production: false,
        track_location: false
      },
      {}
    ];

    submitStep = jest.fn();
    registerEvent = jest.fn().mockResolvedValue(undefined);
    runAIExtraction = jest.fn();
    flushCustomFields = jest.fn();
    offlineRequestHandler = { dbHasRequest: async () => false };
  }

  return { __esModule: true, default: MockClient };
});

// ReactPortal passthrough
jest.mock('../components/ReactPortal', () => ({ children }: any) => (
  <>{children}</>
));

// Access spies from mocked hooks
const HooksMod = jest.requireMock('../hooks');

afterEach(() => {
  jest.clearAllMocks();
  cleanup();

  // Reset flags on the shared ref exposed by the hooks mock
  HooksMod._spies.nextActionStateRef.current.isGettingNewStep = false;
  HooksMod._spies.nextActionStateRef.current.isNextButtonAction = false;
  HooksMod._spies.nextActionStateRef.current.latestClickedButton = null;
});

/// /////////////////////////////////////////////////////////////////////
//  Form Tests
/// /////////////////////////////////////////////////////////////////////
describe('ReactForm next-action flows', () => {
  it('buttonOnClick returns early when async flags are raised', async () => {
    render(<JSForm formId='f1' _internalId='iid-1' />);

    // Wait until the Grid button appears to ensure effects are flushed (acts)
    const btn = await screen.findByTestId('btn');

    // Simulate async work already in progress
    HooksMod._spies.nextActionStateRef.current.isGettingNewStep = true;
    HooksMod._spies.nextActionStateRef.current.isNextButtonAction = true;

    // Click the stubbed button that triggers form.buttonOnClick
    fireEvent.click(btn);

    // Should not toggle flags nor store latestClickedButton
    expect(HooksMod._spies.setNextButtonActionFlag).not.toHaveBeenCalled();
    expect(
      HooksMod._spies.nextActionStateRef.current.latestClickedButton
    ).toBeNull();
  });

  it('buttonOnClick toggles flags and sets latestClickedButton on normal flow', async () => {
    render(<JSForm formId='f1' _internalId='iid-2' />);

    // Wait until the Grid button appears to ensure effects are flushed (acts)
    const btn = await screen.findByTestId('btn');

    // Pre-condition
    expect(HooksMod._spies.nextActionStateRef.current.isNextButtonAction).toBe(
      false
    );

    fireEvent.click(btn);

    // Wait until the "false" toggle is observed (async completion)
    await waitFor(() =>
      expect(HooksMod._spies.setNextButtonActionFlag).toHaveBeenLastCalledWith(
        false
      )
    );

    // It should set true at start and false at end (order-aware)
    const calls = HooksMod._spies.setNextButtonActionFlag.mock.calls.map(
      (args: any[]) => args[0]
    );
    expect(calls[0]).toBe(true);
    expect(calls[calls.length - 1]).toBe(false);

    expect(HooksMod._spies.nextActionStateRef.current.isNextButtonAction).toBe(
      false
    );

    // Assert latestClickedButton contents without non-null assertion
    const clicked = HooksMod._spies.nextActionStateRef.current
      .latestClickedButton as ClickActionElement | null;
    expect(clicked).toBeTruthy();
    if (clicked) {
      expect(clicked.id).toBe('b1');
    }
  });

  it('runGetNewStep effect toggles setGettingNewStepFlag and setNextButtonLoading', async () => {
    render(<JSForm formId='f1' _internalId='iid-3' />);

    // Wait for initial mount to stabilize (ensures act-wrapped updates)
    await screen.findByTestId('btn');

    // Flags should be turned on at the beginning of the effect
    await waitFor(() => {
      expect(HooksMod._spies.setGettingNewStepFlag).toHaveBeenCalledWith(true);
      expect(HooksMod._spies.setNextButtonLoading).toHaveBeenCalledWith(true);
    });

    // And turned off in the finally block
    await waitFor(() => {
      expect(HooksMod._spies.setGettingNewStepFlag).toHaveBeenCalledWith(false);
      expect(HooksMod._spies.setNextButtonLoading).toHaveBeenCalledWith(false);
    });
  });

  it('clearNextActionTimer is called on unmount', async () => {
    const { unmount } = render(<JSForm formId='f1' _internalId='iid-4' />);

    // Wait for button to ensure the effect chain has run (avoids act warning)
    await screen.findByTestId('btn');

    unmount();
    expect(HooksMod._spies.clearNextActionTimer).toHaveBeenCalled();
  });
});
