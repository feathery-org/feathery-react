import { RouterProvider, useLocation, useNavigate } from '../hooks/router';
import React, {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import BootstrapForm from 'react-bootstrap/Form';
import debounce from 'lodash.debounce';

import { calculateGlobalCSS, calculateStepCSS } from '../utils/hydration';
import {
  castHiddenVal,
  castServarVal,
  changeStep,
  clearBrowserErrors,
  FieldOptions,
  FieldProperties,
  FieldStyles,
  formatStepFields,
  getAllElements,
  getAllFields,
  getDefaultFieldValue,
  getDefaultFormFieldValue,
  getFieldValue,
  getInitialStep,
  getNewStepUrl,
  getOrigin,
  getPrevStepKey,
  getUrlHash,
  httpHelpers,
  isElementInViewport,
  isStepTerminal,
  isValidFieldIdentifier,
  lookUpTrigger,
  mapFormSettingsResponse,
  nextStepKey,
  prioritizeActions,
  recurseProgressDepth,
  registerRenderCallback,
  rerenderAllForms,
  saveInitialValuesAndUrlParams,
  setFormElementError,
  setUrlStepHash,
  updateCustomCSS,
  updateCustomHead,
  updateStepFieldOptions,
  updateStepFieldProperties,
  updateStepFieldStyles
} from '../utils/formHelperFunctions';
import {
  getContainerById,
  getFieldsInRepeat,
  getRepeatedContainer
} from '../utils/repeat';
import {
  getHideIfReferences,
  getPositionKey,
  getVisiblePositions
} from '../utils/hideAndRepeats';
import { validateElements, validators } from '../utils/validation';
import {
  defaultClient,
  FieldValues,
  fieldValues,
  initState,
  updateUserId
} from '../utils/init';
import { isEmptyArray, justInsert, justRemove, toList } from '../utils/array';
import FeatheryClient from '../utils/featheryClient';
import { useFirebaseRecaptcha } from '../integrations/firebase';
import { openPlaidLink } from '../integrations/plaid';
import {
  addToCart,
  checkForPaymentCheckoutCompletion,
  getCart,
  getLiveOrTestProduct,
  getSimplifiedProducts,
  isProductInPurchaseSelections,
  purchaseCart,
  removeFromCart,
  setupPaymentMethod,
  usePayments
} from '../integrations/stripe';
import { ActionData, trackEvent } from '../integrations/utils';
import DevNavBar from './components/DevNavBar';
import FeatherySpinner from '../elements/components/Spinner';
import CallbackQueue from '../utils/callbackQueue';
import {
  downloadAllFileUrls,
  featheryWindow,
  openTab,
  runningInClient
} from '../utils/browser';
import FormOff, {
  CLOSED,
  COLLAB_COMPLETED,
  COLLAB_DIRECT_DISABLED,
  FILLED_OUT,
  NO_BUSINESS_EMAIL
} from '../elements/components/FormOff';
import Lottie from '../elements/components/Lottie';
import Watermark from '../elements/components/Watermark';
import Grid from './grid';
import { DEFAULT_MOBILE_BREAKPOINT, getViewport } from '../elements/styles';
import {
  ContextOnAction,
  ContextOnChange,
  ContextOnError,
  ContextOnSubmit,
  ContextOnView,
  ElementProps,
  FormContext,
  PopupOptions,
  Subgrid,
  Trigger
} from '../types/Form';
import usePrevious from '../hooks/usePrevious';
import ReactPortal from './components/ReactPortal';
import { replaceTextVariables } from '../elements/components/TextNodes';
import { getFormContext } from '../utils/formContext';
import { getPrivateActions } from '../utils/sensitiveActions';
import { v4 as uuidv4 } from 'uuid';
import internalState, {
  ExtractionActionOptions,
  setFormInternalState
} from '../utils/internalState';
import useFormAuth from '../auth/internal/useFormAuth';
import {
  ACTION_ADD_REPEATED_ROW,
  ACTION_AI_EXTRACTION,
  ACTION_ALLOY_VERIFY_ID,
  ACTION_BACK,
  ACTION_GENERATE_ENVELOPES,
  ACTION_GENERATE_QUIK_DOCUMENTS,
  ACTION_INVITE_COLLABORATOR,
  ACTION_LOGOUT,
  ACTION_NEW_SUBMISSION,
  ACTION_NEXT,
  ACTION_OAUTH_LOGIN,
  ACTION_PURCHASE_PRODUCTS,
  ACTION_REMOVE_PRODUCT_FROM_PURCHASE,
  ACTION_REMOVE_REPEATED_ROW,
  ACTION_REWIND_COLLABORATION,
  ACTION_SCHWAB_CREATE_CONTACT,
  ACTION_SELECT_PRODUCT_TO_PURCHASE,
  ACTION_SEND_EMAIL_CODE,
  ACTION_SEND_MAGIC_LINK,
  ACTION_SEND_SMS_CODE,
  ACTION_SEND_SMS_MESSAGE,
  ACTION_STORE_FIELD,
  ACTION_TELESIGN_PHONE_TYPE,
  ACTION_TELESIGN_SILENT_VERIFICATION,
  ACTION_TELESIGN_SMS_OTP,
  ACTION_TELESIGN_VERIFY_OTP,
  ACTION_TELESIGN_VOICE_OTP,
  ACTION_TRIGGER_ARGYLE,
  ACTION_TRIGGER_FLINKS,
  ACTION_TRIGGER_PERSONA,
  ACTION_TRIGGER_PLAID,
  ACTION_URL,
  ACTION_VERIFY_COLLABORATOR,
  ACTION_VERIFY_EMAIL,
  ACTION_VERIFY_SMS,
  canRunAction,
  hasFlowActions,
  isRunnableStepEventRule,
  REQUIRED_FLOW_ACTIONS
} from '../utils/elementActions';
import { openArgyleLink } from '../integrations/argyle';
import { authState } from '../auth/LoginForm';
import {
  getAuthIntegrationMetadata,
  isTerminalStepAuth
} from '../auth/internal/utils';
import Field from '../utils/entities/Field';
import Auth from '../auth/internal/AuthIntegrationInterface';
import { CloseIcon } from '../elements/components/icons';
import useLoader, { InitialLoader } from '../hooks/useLoader';
import { installRecaptcha, verifyRecaptcha } from '../integrations/recaptcha';
import { fieldAllowedFromList } from './grid/Element/utils/utils';
import { triggerPersona } from '../integrations/persona';
import Collaborator from '../utils/entities/Collaborator';
import { useOfflineRequestHandler } from '../utils/offlineRequestHandler';
import {
  removeCustomErrorHandler,
  setCustomErrorHandler
} from '../utils/error';
import { verifyAlloyId } from '../integrations/alloy';
import { useFlinksConnect } from '../integrations/flinks';
import { isNum } from '../utils/primitives';
import { getSignUrl } from '../utils/document';
import QuikFormViewer from '../elements/components/QuikFormViewer';
import { createSchwabContact } from '../integrations/schwab';
import { getLoginStep } from '../auth/utils';
import usePollFuserData from '../hooks/usePollFuserData';

export * from './grid/StyledContainer';
export type { StyledContainerProps } from './grid/StyledContainer';

export interface Props {
  formId: string;
  /**
   * @deprecated use formId instead
   */
  formName?: string; // TODO: remove support for formName (deprecated)
  onChange?: null | ((context: ContextOnChange) => Promise<any> | void);
  onLoad?: null | ((context: FormContext) => Promise<any> | void);
  onFormComplete?: null | ((context: FormContext) => Promise<any> | void);
  onSubmit?: null | ((context: ContextOnSubmit) => Promise<any> | void);
  onError?: null | ((context: ContextOnError) => Promise<any> | void);
  onView?: null | ((context: ContextOnView) => Promise<any> | void);
  onAction?: null | ((context: ContextOnAction) => Promise<any> | void);
  onViewElements?: string[];
  saveUrlParams?: boolean;
  initialValues?: FieldValues;
  initialStepId?: string;
  hideTestUI?: boolean;
  language?: string;
  initialLoader?: InitialLoader;
  popupOptions?: PopupOptions;
  elementProps?: ElementProps;
  contextRef?: React.MutableRefObject<null | FormContext>;
  formProps?: Record<string, any>;
  customComponents?: Record<string, any>;
  style?: { [cssProperty: string]: string };
  className?: string;
  children?: ReactNode;
  _draft?: boolean;
  readOnly?: boolean;
  hashNavigation?: boolean;
}

interface InternalProps {
  _internalId: string; // Used to uniquely identify forms when the same form is rendered multiple times
  _isAuthLoading?: boolean; // Flag to show the loader for auth purposes
  _bypassCDN?: boolean; // Fetch form directly from API if true
  _pollFuserData?: boolean; // Poll for updated fuser data on BE. Used by audio AI.
}

export interface ClickActionElement {
  id: string;
  properties: { [key: string]: any };
  repeat?: any;
}

export interface LogicRule {
  id: string;
  name: string;
  trigger_event: string;
  steps: string[];
  elements: string[];
  code: string;
  enabled: boolean;
  valid: boolean;
}

const AsyncFunction = async function () {}.constructor;

function Form({
  _internalId,
  _isAuthLoading = false,
  _bypassCDN = false,
  _draft = false,
  _pollFuserData = false,
  formName: formNameProp,
  formId, // The 'live' env slug
  onChange = null,
  onLoad = null,
  onFormComplete = null,
  onSubmit = null,
  onError = null,
  onView = null,
  onAction = null,
  onViewElements = [],
  saveUrlParams = false,
  hideTestUI = false,
  initialValues = {},
  initialStepId = '',
  language,
  initialLoader,
  popupOptions,
  elementProps = {},
  contextRef,
  formProps = {},
  customComponents = {},
  style = {},
  className = '',
  children,
  readOnly = false,
  hashNavigation
}: InternalProps & Props) {
  const [formName, setFormName] = useState(formNameProp || ''); // TODO: remove support for formName (deprecated)
  const formKey = formId || formName; // prioritize formID but fall back to name
  const clientRef = useRef<any>(undefined);
  const client = clientRef.current;
  const navigate = useNavigate();
  const location = useLocation();
  const session = initState.formSessions[formKey];

  const [autoValidate, setAutoValidate] = useState(false);

  const [steps, setSteps] = useState<Record<string, any>>({});
  const [activeStep, setActiveStep] = useState<any>(null);
  const [stepKey, setStepKey] = useState('');
  const [shouldScrollToTop, setShouldScrollToTop] = useState(false);
  const [finished, setFinished] = useState(false);
  const [userProgress, setUserProgress] = useState(null);
  const [curDepth, setCurDepth] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  // No state since off reason is set in two locations almost simultaneously
  const formOffReason = useRef('');
  const [formSettings, setFormSettings] = useState({
    readOnly,
    errorType: 'html5',
    autocomplete: 'on',
    autofocus: true,
    showBrand: false,
    brandPosition: undefined,
    autoscroll: 'top_of_form',
    rightToLeft: false,
    allowEdits: true,
    saveUrlParams: false,
    saveHideIfFields: false,
    clearHideIfFields: false,
    completionBehavior: '',
    globalStyles: {},
    mobileBreakpoint: DEFAULT_MOBILE_BREAKPOINT
  });
  const trackHashes = useRef(false);
  const curLanguage = useRef<undefined | string>(undefined);

  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [hiddenFields, setHiddenFields] = useState<Record<string, string>>({});

  // Array of 2 elements. First is field whitelist, second is field blacklist
  const [allowLists, setAllowLists] = useState<any[]>([null, null]);

  const [connectorFields, setConnectorFields] = useState<any>();
  const [logicRules, setLogicRules] = useState<LogicRule[]>([]);
  const [inlineErrors, setInlineErrors] = useState<
    Record<string, { message: string; index: number }>
  >({});
  const [, setRepeatChanged] = useState(false);

  const [integrations, setIntegrations] = useState<null | Record<string, any>>(
    null
  );
  const flowCompleted = useRef(false);
  const [requiredStepAction, setRequiredStepAction] = useState<
    keyof typeof REQUIRED_FLOW_ACTIONS | ''
  >('');

  const [viewport, setViewport] = useState(() =>
    getViewport(formSettings.mobileBreakpoint)
  );

  const prevAuthId = usePrevious(authState.authId);
  const prevStepKey = usePrevious(stepKey);

  // Set to trigger conditional renders on field value updates, no need to use the value itself
  const [render, setRender] = useState({ v: 1 });

  const [showQuikFormViewer, setShowQuikFormViewer] = useState(false);
  const [quikHTMLPayload, setQuikHTMLPayload] = useState('');
  const { openFlinksConnect, flinksFrame } = useFlinksConnect();

  // When the active step changes, recalculate the dimensions of the new step
  const stepCSS = useMemo(() => calculateStepCSS(activeStep), [activeStep]);
  const globalCSS = useMemo(
    () => calculateGlobalCSS(formSettings.globalStyles),
    [formSettings.globalStyles]
  );

  useFirebaseRecaptcha(activeStep);
  const getNextAuthStep = useFormAuth({
    initialStep: getInitialStep({ initialStepId, steps }),
    integrations,
    setStepKey,
    steps,
    client,
    _internalId
  });

  const [backNavMap, setBackNavMap] = useState<Record<string, string>>({});
  const updateBackNavMap = (newNavs: Record<string, string>) =>
    newNavs && setBackNavMap({ ...backNavMap, ...newNavs });

  const formRef = useRef<any>(null);

  const { clearLoaders, stepLoader, buttonLoaders, setLoaders } = useLoader({
    initialLoader,
    _isAuthLoading,
    loaderBackgroundColor: stepCSS?.backgroundColor,
    formRef
  });

  // Tracks element to focus
  const focusRef = useRef<any>(undefined);
  // Tracks the execution of user-provided callback functions
  const callbackRef = useRef<any>(new CallbackQueue(null, setLoaders));
  // Tracks if the form has redirected
  const hasRedirected = useRef<boolean>(false);
  const elementClicks = useRef<any>({}).current;

  useEffect(() => {
    // TODO: remove support for formName (deprecated)
    if (formNameProp) {
      console.warn(
        'The `formName` parameter is deprecated and support will be removed in a future library version. Please use `formId` instead.'
      );
    }
  }, [formNameProp]);

  // All mount and unmount logic should live here
  useEffect(() => {
    registerRenderCallback(_internalId, 'form', () => {
      setRender((render) => ({ ...render }));
    });
    if (
      contextRef &&
      Object.prototype.hasOwnProperty.call(contextRef, 'current')
    )
      contextRef.current = getFormContext(_internalId);

    return () => {
      delete initState.renderCallbacks[_internalId];
      delete initState.redirectCallbacks[_internalId];
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setViewport(getViewport(formSettings.mobileBreakpoint));
    };
    featheryWindow().addEventListener('resize', handleResize);
    return () => featheryWindow().removeEventListener('resize', handleResize);
  }, [formSettings]);

  useEffect(() => {
    const oldLanguage = curLanguage.current;
    curLanguage.current = language;

    if (oldLanguage && oldLanguage !== language) {
      // if language changes, need to remount form to refetch data
      initState.remountCallbacks[_internalId]();
    }
  }, [language]);

  // Logic to run every time step changes
  useEffect(() => {
    if (!activeStep) return;

    setAutoValidate(false); // Each step to initially not auto validate

    // Don't autofocus if it will scroll page
    if (
      formSettings.autofocus &&
      focusRef.current?.focus &&
      isElementInViewport(focusRef.current)
    ) {
      focusRef.current.focus({ preventScroll: true });
      focusRef.current = 'already focused';
    }

    let requiredStepAction: any = '';
    activeStep.buttons.forEach((b: any) =>
      (b.properties.actions ?? []).forEach((action: any) => {
        if (action.type in REQUIRED_FLOW_ACTIONS) {
          requiredStepAction = action.type;
        }
      })
    );
    setRequiredStepAction(requiredStepAction);
  }, [activeStep?.id]);

  // viewElements state
  const [viewElements, setViewElements] = useState<string[]>([]);
  useEffect(() => {
    setViewElements(onViewElements);
  }, [onViewElements.length]);

  // Figure out which fields are used in hide rules so that observed changes can be used
  // to trigger rerenders
  const hideIfFieldReferences = useMemo(() => {
    if (activeStep) return getHideIfReferences(getAllElements(activeStep));
    return new Set<string>();
  }, [activeStep?.id]);

  useEffect(() => {
    const autoscroll = formSettings.autoscroll;
    if (shouldScrollToTop && autoscroll !== 'none') {
      const scroll =
        autoscroll === 'top_of_form'
          ? () => formRef.current?.scrollIntoView({ behavior: 'smooth' })
          : () => featheryWindow().scrollTo({ top: 0, behavior: 'smooth' });
      try {
        // Needs to be async to scroll up in Safari sometimes
        setTimeout(scroll, 100);
      } catch (e) {
        // Some browsers may not have support for scrollTo
        console.warn(e);
      }
    }
  }, [stepKey]);

  function updateRepeatValues(
    repeatContainer: Subgrid | undefined,
    getNewVal: any
  ) {
    if (!repeatContainer) return;

    // Collect a list of all relevant repeated elements.
    const repeatedServarFields = getFieldsInRepeat(activeStep, repeatContainer);

    // Update the values by appending a default value for each field
    const updatedValues: Record<string, any> = {};
    repeatedServarFields.forEach((field: any) => {
      updatedValues[field.servar.key] = getNewVal(field);
    });

    setRepeatChanged((repeatChanged) => !repeatChanged);
    updateFieldValues(updatedValues);
  }

  function addRepeatedRow(repeatContainer: Subgrid | undefined, limit = null) {
    const getNewVal = (field: any) => {
      const val = fieldValues[field.servar.key];
      if (limit && val && Array.isArray(val) && val.length >= limit) return val;
      return [
        // @ts-expect-error TS(2461): Type 'FeatheryFieldTypes' is not an array type.
        ...val,
        getDefaultFieldValue(field)
      ];
    };
    updateRepeatValues(repeatContainer, getNewVal);
  }

  function removeRepeatedRow(
    element: any,
    repeatContainer: Subgrid | undefined
  ) {
    const index = element.repeat;
    if (isNaN(index) && !repeatContainer) return;

    const insideContainer = getRepeatedContainer(activeStep, element);
    const isInsideContainer = Boolean(insideContainer);
    const curRepeatContainer = insideContainer || repeatContainer;

    const removeServars: Record<string, null> = {};
    let curIndex = index;
    const getNewVal = (field: any) => {
      const vals = fieldValues[field.servar.key] as any[];
      curIndex = !isInsideContainer ? vals.length - 1 : index;

      removeServars[field.servar.key] = null;

      const newRepeatedValues = justRemove(vals, curIndex);
      const defaultValue = [getDefaultFieldValue(field)];
      return newRepeatedValues.length === 0 ? defaultValue : newRepeatedValues;
    };
    updateRepeatValues(curRepeatContainer, getNewVal);
    internalState[_internalId].updateFieldOptions(removeServars, curIndex);
  }

  // Debouncing the validateElements call to rate limit calls
  const debouncedValidate = useCallback(
    debounce((setInlineErrors: any) => {
      // default form validation
      visiblePositions &&
        validateElements({
          step: activeStep,
          visiblePositions,
          triggerErrors: true,
          errorType: formSettings.errorType,
          formRef,
          setInlineErrors
        });
    }, 750),
    [activeStep?.id, formRef]
  );

  // Debouncing the rerender due to changing values of referenced fields in hide if rules.
  // Need to rate limit re-renders here for performance reasons.
  const debouncedRerender = useCallback(
    debounce(() => setRender((render) => ({ ...render })), 500),
    [setRender, render]
  );

  useEffect(() => {
    return () => {
      debouncedValidate.cancel();
    };
  }, [debouncedValidate]);
  useEffect(() => {
    return () => {
      debouncedRerender.cancel();
    };
  }, [debouncedRerender]);

  const updateFieldValues = (
    newFieldValues: any,
    { rerender = true, clearErrors = true, triggerErrors = true } = {}
  ) => {
    if (clearErrors) clearBrowserErrors(formRef);
    const entries = Object.entries(newFieldValues);
    if (entries.every(([key, val]) => fieldValues[key] === val)) return false;

    const empty = entries.some(([key, val]) => !val || !fieldValues[key]);
    const hideIfDependenciesChanged = entries.some(
      ([key, val]) => fieldValues[key] !== val && hideIfFieldReferences.has(key)
    );

    const fields = internalState[_internalId]?.fields;

    const transformedFieldValues = Object.entries(newFieldValues).reduce(
      (acc, [key, value]) => {
        const field = fields?.[key];
        if (Array.isArray(value) && field && !field.isHiddenField) {
          acc[key] = value.map((item) => (item === null ? '' : item));
        } else {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, any>
    );

    Object.assign(fieldValues, transformedFieldValues);

    // Always rerender from empty state for display purposes
    // If any fields involved in a hideIf have changed, then rerender if
    // its dependencies have changed. The field that changed needs to immediately
    // rerender if specified, but hideIf rerenders can be debounced
    if (rerender || empty) setRender((render) => ({ ...render }));
    else if (hideIfDependenciesChanged) debouncedRerender();

    // Only validate on each field change if auto validate is enabled due to prev submit attempt
    if (autoValidate && triggerErrors) debouncedValidate(setInlineErrors);

    return true;
  };

  // For audio AI only right now
  const [pollFuserData, setPollFuserData] = useState(_pollFuserData);
  usePollFuserData(pollFuserData, client, updateFieldValues);

  const eventCallbackMap: Record<string, any> = {
    change: onChange,
    load: onLoad,
    form_complete: onFormComplete,
    submit: onSubmit,
    error: onError,
    view: onView,
    action: onAction
  };

  const eventHasUserLogic = (event: string) => {
    return (
      typeof eventCallbackMap[event] === 'function' ||
      (logicRules &&
        logicRules.some(
          (logicRule: LogicRule) => logicRule.trigger_event === event
        ))
    );
  };

  const handleFormComplete = async () => {
    // Send form completion message for webkit
    if (featheryWindow().webkit?.messageHandlers?.feathery?.postMessage) {
      if (initState.isTestEnv) console.log('Webkit event sent');
      featheryWindow().webkit.messageHandlers.feathery.postMessage(
        'Form completed'
      );
    }
    // Send form completion message for React Native Webview
    if (featheryWindow().ReactNativeWebView) {
      if (initState.isTestEnv) console.log('React Native Webview event sent');
      featheryWindow().ReactNativeWebView.postMessage('Form completed');
    }
    // Send form completion message for Android Webview
    if (global.FeatheryInterface) {
      if (initState.isTestEnv) console.log('Android Webview event sent');
      global.FeatheryInterface.onComplete();
    }

    const data = { ...fieldValues };
    const fieldData: Record<string, any> = {};
    if (integrations?.segment?.metadata.track_fields) fieldData.segment = data;
    if (integrations?.amplitude?.metadata.track_fields)
      fieldData.amplitude = data;
    if (integrations?.['google-tag-manager']?.metadata.track_fields)
      fieldData['google-tag-manager'] = data;
    trackEvent(integrations, 'FeatheryFormComplete', '', formName, fieldData);

    await runUserLogic('form_complete');
  };

  const runUserLogic = async (
    event: string,
    getProps: () => Record<string, any> = () => ({}),
    containerId?: string | undefined,
    toAwait?: Promise<any>,
    flush = true
  ) => {
    const props = {
      ...getFormContext(_internalId),
      ...getPrivateActions(_internalId),
      ...getProps()
    };

    let logicRan = false;
    if (typeof eventCallbackMap[event] === 'function') {
      // Don't run submit function twice
      // @ts-expect-error
      if (event !== 'submit' || props.beforeSubmit) {
        logicRan = true;
        await eventCallbackMap[event](props);
      }
    }
    // filter the logicRules that have trigger_event matching the trigger event (type_)
    if (logicRules) {
      const logicRulesForEvent = logicRules.filter(
        (logicRule: any) => logicRule.trigger_event === event
      );
      const currentStepId = (internalState[_internalId]?.currentStep ?? {}).id;
      // Run the logic rules in sequence!
      for (const logicRule of logicRulesForEvent) {
        // all disabled, invalid or empty rules are filtered out by the BE

        if (canRunAction(logicRule, currentStepId, props, containerId)) {
          logicRan = true;

          if (toAwait) await toAwait;

          // Note:
          // AsyncFunction is nice and tidy but was throwing an error when trying to use await at
          // the top level of the user code.
          // The error was: Uncaught (in promise) SyntaxError: await is only valid in async functions and the top level bodies of modules.
          // So, then tried eval instead, but had a serious issue with the webpacked published
          // lib which was just invalid. So, now wrapping the rule code
          // in an async function and calling it immediately from within an AsyncFunction.
          const asyncWrappedCode = `return (async () => { ${logicRule.code}\n })()`;

          // Do not inject field globals that are invalid js identifiers or that collide
          // with a javascript or browser reserved word. This avoids validation errors
          // should they try to use it in a rule. However, even if they do not use it
          // in a rule, the runtime injects that field and this causes an exception
          // at runtime due to the reserved word being used or invalid identifier.

          const injectableFields = Object.entries(
            internalState[_internalId]?.fields ?? {}
          )
            .filter(([key]) => isValidFieldIdentifier(key))
            .reduce((acc, [key, field]) => {
              acc[key] = field;
              return acc;
            }, {} as Record<string, Field>);
          // @ts-ignore
          const fn = new AsyncFunction(
            'feathery',
            // pass in all the fields as arguments so they are globals in the rule code
            ...Object.keys(injectableFields),
            asyncWrappedCode
          );
          try {
            await fn(
              { ...props, http: httpHelpers(client, connectorFields) },
              ...Object.values(injectableFields)
            ).catch((e: any) => {
              // catch unhandled rejections in async user code (if a promise is returned)
              // handle any errors in async code that actually returns a promise
              handleRuleError(e.message, logicRule);
            });
          } catch (e: any) {
            const errorMessage = e.reason?.message ?? e.error?.message;
            handleRuleError(errorMessage, logicRule);
          }
        }
      }
      // Change event can happen too frequently to flush every time
      if (event !== 'change' && flush) await defaultClient.flushCustomFields();
    }

    // Flush field updates to backend before form completes
    if (event === 'form_complete') await defaultClient.flushCustomFields();

    return logicRan;
  };

  // Used to warn about logic rule errors
  const handleRuleError = (errorMessage: string, logicRule: LogicRule) => {
    // log that a specific rule had an error, log it to warning console
    console.warn(
      `Error while running logic rule: ${logicRule.name}`,
      `  On Event: ${logicRule.trigger_event}`,
      `  Error Message: ${errorMessage ?? ''}`
    );
  };

  const getErrorCallback =
    (props1 = {}) =>
    (props2 = {}) =>
      runUserLogic('error', () => ({
        ...props1,
        ...props2
      }));

  // keep internalState fresh
  if (internalState[_internalId]) {
    internalState[_internalId].setInlineErrors = setInlineErrors;
    internalState[_internalId].inlineErrors = inlineErrors;
  }

  const changeFormStep = (newKey: string, oldKey: string, load: boolean) => {
    const changed = changeStep(
      newKey,
      oldKey,
      steps,
      setStepKey,
      navigate,
      client,
      trackHashes.current
    );
    if (changed) {
      const backKey = load ? backNavMap[oldKey] : oldKey;
      updateBackNavMap({ [newKey]: backKey });
    }
    return changed;
  };

  const getNewStep = async (newKey: any) => {
    let newStep = steps[newKey];
    if (!newStep) return;

    const nextStep = getNextAuthStep(newStep);
    if (
      nextStep !== '' &&
      !initState.isTestEnv &&
      changeFormStep(nextStep, newKey, true)
    )
      return;
    const nextKey = nextStepKey(newStep.next_conditions, {
      elementType: 'step',
      elementIDs: [newStep.id]
    });
    if (nextKey && changeFormStep(nextKey, newKey, true)) {
      return;
    }

    newStep = JSON.parse(JSON.stringify(newStep));

    // This could be a redirect from Stripe following a successful payment checkout
    checkForPaymentCheckoutCompletion(
      steps,
      client,
      updateFieldValues,
      integrations?.stripe
    );

    // create fields only once and seal it
    let fields = internalState[_internalId]?.fields;
    if (!fields || !Object.isSealed(fields))
      fields = Object.seal(
        getAllFields(fieldKeys, Object.keys(hiddenFields), _internalId)
      );

    setFormInternalState(
      _internalId,
      {
        language: language ?? initState.language,
        currentStep: newStep,
        previousStepName: activeStep?.key ?? '',
        visiblePositions: getVisiblePositions(newStep, _internalId),
        client,
        fields,
        products: Object.seal(
          getSimplifiedProducts(integrations?.stripe, updateFieldValues, client)
        ),
        cart: Object.seal(
          getCart(integrations?.stripe, updateFieldValues, client)
        ),
        collaborator: Object.seal(
          new Collaborator(
            session?.collaborator?.template_label ?? '',
            session?.collaborator?.template_index ?? 0,
            session?.collaborator?.allowed ?? '',
            session?.collaborator?.whitelist ?? []
          )
        ),
        trackHashes: trackHashes.current,
        formId,
        formName,
        formRef,
        formSettings,
        getErrorCallback,
        navigate,
        inlineErrors,
        setInlineErrors,
        setUserProgress,
        steps,
        setStepKey,
        updateFieldOptions: (
          newOptions: FieldOptions,
          repeatIndex?: number
        ) => {
          Object.values(steps).forEach((step) =>
            updateStepFieldOptions(step, newOptions, repeatIndex)
          );
          setSteps(JSON.parse(JSON.stringify(steps)));
          updateStepFieldOptions(newStep, newOptions, repeatIndex);
          setActiveStep(JSON.parse(JSON.stringify(newStep)));
        },
        updateFieldStyles: (fieldKey: string, newStyles: FieldStyles) => {
          Object.values(steps).forEach((step) =>
            updateStepFieldStyles(step, fieldKey, newStyles)
          );
          setSteps(JSON.parse(JSON.stringify(steps)));

          updateStepFieldStyles(newStep, fieldKey, newStyles);
          setActiveStep(JSON.parse(JSON.stringify(newStep)));
        },
        updateFieldProperties: (
          fieldKey: string,
          newProperties: FieldProperties,
          onServar = false
        ) => {
          Object.values(steps).forEach((step) =>
            updateStepFieldProperties(step, fieldKey, newProperties, onServar)
          );
          setSteps(JSON.parse(JSON.stringify(steps)));

          updateStepFieldProperties(newStep, fieldKey, newProperties, onServar);
          setActiveStep(JSON.parse(JSON.stringify(newStep)));
        },
        setFieldErrors: (
          errors: Record<string, string | { index: number; message: string }>
        ) => {
          Object.entries(errors).forEach(([fieldKey, error]) => {
            const { inlineErrors, setInlineErrors } =
              internalState[_internalId];
            let index = null;
            let message = error;
            // If the user provided an object for an error then use the specified index and message
            // This allows users to specify an error on an element in a repeated row
            if (typeof error === 'object') {
              index = error.index;
              message = error.message;
            }
            setFormElementError({
              formRef,
              fieldKey,
              message,
              index,
              servarType: fields[fieldKey]?.type,
              errorType: formSettings.errorType,
              inlineErrors,
              setInlineErrors,
              triggerErrors: true
            });
          });
        },
        setCalendlyUrl: (url: string) => {
          if (integrations?.calendly?.metadata) {
            setIntegrations((integrations) => ({
              ...integrations,
              calendly: {
                ...integrations?.calendly,
                metadata: {
                  ...integrations?.calendly.metadata,
                  api_key: url
                }
              }
            }));
          }
        },
        runAIExtraction: async (
          extractionId: string,
          options: ExtractionActionOptions | boolean,
          // deprecated, pages should be in options
          pages?: number[]
        ) => {
          if (!extractionId) {
            console.error('No extraction ID was passed');
            return;
          }

          const data = await client.runAIExtraction({
            extractionId,
            options,
            pages,
            setPollFuserData
          });
          if (data.status === 'error') {
            throw new Error(data.message);
          }
          const vals = data.data ?? {};
          updateFieldValues(vals);
          return data;
        }
      },
      // Avoid all these other obj props going through Object.assign which is not necessary.
      // It turns out that not doing so caused breakage on steps after the first step.
      // But for only fields it is fine and necessary.
      ['fields']
    );

    await runUserLogic('load');

    if (trackHashes.current) {
      const newHash = getUrlHash();
      // This indicates user programmatically changed the step via the onLoad function
      // So loading of the old step must short circuit
      if (newHash && newStep.key !== newHash) return;
    }

    clearLoaders();
    const [curDepth, maxDepth] = recurseProgressDepth(steps, newKey);
    setCurDepth(curDepth);
    setMaxDepth(maxDepth);

    trackEvent(integrations, 'FeatheryStepLoad', newKey, formName);

    callbackRef.current = new CallbackQueue(newStep, setLoaders);
    focusRef.current = null;
    // Hydrate field descriptions
    newStep.servar_fields.forEach((field: any) => {
      const servar = field.servar;
      servar.name = replaceTextVariables(servar.name, field.repeat);
      const disabled = !fieldAllowedFromList(allowLists, servar.key);
      const props = field.properties;
      props.disabled = props.disabled || disabled;
      if (servar.required && props.disabled) servar.required = false;
    });
    const oldKey = activeStep?.key ?? '';
    // setActiveStep, apparently, must go after setting the callbackRef
    // because it triggers a new render, before this fn finishes execution,
    // which can cause onView to fire before the callbackRef is set
    setActiveStep(newStep);
    client.registerEvent({
      step_key: newStep.key,
      event: 'load',
      previous_step_key: oldKey
    });
  };

  const visiblePositions = useMemo(() => {
    if (!activeStep) return null;
    const visiblePositions = getVisiblePositions(activeStep, _internalId);

    if (formSettings.clearHideIfFields) {
      // Automatically clear form fields that are hidden
      const newFieldVals: Record<string, any> = {};
      activeStep.servar_fields.forEach((sf: any) => {
        const key = getPositionKey(sf);
        if (!visiblePositions[key][0]) {
          const newVal = getDefaultFormFieldValue(sf);
          if (
            JSON.stringify(newVal) !== JSON.stringify(getFieldValue(sf).value)
          ) {
            newFieldVals[sf.servar.key] = newVal;
          }
        }
      });
      if (Object.keys(newFieldVals).length) {
        updateFieldValues(newFieldVals);
        client.submitCustom(newFieldVals);
      }
    }

    return visiblePositions;
  }, [activeStep, render, formSettings]);

  useEffect(() => {
    if (clientRef.current) return;

    clientRef.current = new FeatheryClient(
      formKey,
      hasRedirected,
      _draft,
      _bypassCDN
    );
    const newClient = clientRef.current;
    let saveUrlParamsFormSetting = false;
    // render form without values first for speed
    const formPromise = newClient
      .fetchForm(initialValues, language)
      .then(async (data: any) => {
        setCustomErrorHandler();
        updateCustomCSS(data.custom_css ?? '');
        await updateCustomHead(data.custom_head ?? '');
        removeCustomErrorHandler();
        return data;
      })
      .then(({ steps, form_name: formNameResult, ...res }: any) => {
        // In the future formName will not be initialized with a prop value
        // so we set it using the response data
        setFormName(formNameResult);
        steps = steps.reduce((result: any, step: any) => {
          result[step.key] = step;
          return result;
        }, {});
        setSteps(steps);
        if (res.completion_behavior === 'redirect' && res.redirect_url)
          initState.redirectCallbacks[_internalId] = () => {
            featheryWindow().location.href = replaceTextVariables(
              res.redirect_url,
              0
            );
          };
        if (res.save_url_params) saveUrlParamsFormSetting = true;
        setFormSettings({ ...formSettings, ...mapFormSettingsResponse(res) });
        formOffReason.current = res.formOff ? CLOSED : formOffReason.current;
        setLogicRules(res.logic_rules);
        trackHashes.current =
          hashNavigation !== undefined ? hashNavigation : res.track_hashes;

        // Add any logic_rule.elements to viewElements so that onView called for then too.
        // Make sure there are no duplicate entries.
        if (res.logic_rules) {
          const newViewElements: string[] = [...viewElements];
          res.logic_rules.forEach((logicRule: LogicRule) => {
            if (logicRule.trigger_event === 'view') {
              logicRule.elements.forEach((elementId: any) => {
                if (!newViewElements.includes(elementId)) {
                  newViewElements.push(elementId);
                }
              });
            }
          });
          setViewElements(newViewElements);
        }

        if (res.connector_fields) {
          setConnectorFields(res.connector_fields);
        }

        if (res.production) installRecaptcha(steps);
        return steps;
      });
    // fetch values separately because this request
    // goes to Feathery origin, while the previous
    // request goes to our CDN
    newClient
      .fetchSession(formPromise, true)
      .then(([session, steps]: any) => {
        if (!session || session.collaborator?.invalid)
          formOffReason.current = CLOSED;
        else if (session.collaborator?.completed)
          formOffReason.current = COLLAB_COMPLETED;
        else if (session.collaborator?.direct_submission_disabled)
          formOffReason.current = COLLAB_DIRECT_DISABLED;
        else if (session.no_business_email)
          formOffReason.current = NO_BUSINESS_EMAIL;
        if (formOffReason.current) {
          setRender((render) => ({ ...render }));
          return;
        }

        if (!session.track_location && trackHashes.current) {
          // Clear URL hash on new session if not tracking location
          navigate(
            featheryWindow().location.pathname +
              featheryWindow().location.search,
            {
              replace: true
            }
          );
        }
        updateBackNavMap(session.back_nav_map);
        setIntegrations(session.integrations);

        setFieldKeys(session.servars);
        setHiddenFields(session.hidden_fields);
        setAllowLists([
          session.collaborator?.whitelist,
          session.collaborator?.blacklist
        ]);
        saveInitialValuesAndUrlParams({
          updateFieldValues,
          client: newClient,
          saveUrlParams: saveUrlParams || saveUrlParamsFormSetting,
          initialValues,
          steps,
          hiddenFields: session.hidden_fields
        });

        // User is authenticating. auth hook will set the initial stepKey once auth has finished
        if (authState.redirectAfterLogin || authState.hasRedirected || stepKey)
          return;

        const newKey = getInitialStep({
          initialStepId,
          steps,
          sessionCurrentStep: session.current_step_key
        });
        if (trackHashes.current) setUrlStepHash(navigate, steps, newKey);
        setStepKey(newKey);
      })
      .catch(async (error: any) => {
        console.warn(error);
        // Go to first step if origin fails
        const [data] = await formPromise;
        const newKey = (getOrigin as any)(data).key;
        if (trackHashes.current) setUrlStepHash(navigate, steps, newKey);
        else setStepKey(newKey);
      });
  }, [activeStep, setSteps, updateFieldValues]);

  useOfflineRequestHandler(client);

  useEffect(() => {
    if (!trackHashes.current) return;
    const hashKey = getUrlHash();
    if (hashKey in steps) setStepKey(hashKey);
  }, [location]);

  useEffect(() => {
    // We set render to re-evaluate auth nav rules - but should only getNewStep if either the step or authId has changed.
    // Should not fetch new step if render was set for another reason
    if (
      stepKey &&
      (prevStepKey !== stepKey || prevAuthId !== authState.authId)
    ) {
      getNewStep(stepKey);
    }
  }, [stepKey, render]);

  // Note: If index is provided, handleChange assumes the field is a repeated field
  const changeValue = (
    value: any,
    field: any,
    index = null,
    rerender = true,
    triggerErrors = true
  ) => {
    const updateValues = {};
    let repeatRowOperation;

    const servar = field.servar;
    let repeatContainer: Subgrid | undefined;
    if (servar.repeat_trigger === 'set_value') {
      const defaultValue = getDefaultFieldValue(field);
      const { value: previousValue, valueList } = getFieldValue(field);

      // Add a repeated row if the value went from unset to set
      const isPreviousValueDefaultArray =
        isEmptyArray(previousValue) && isEmptyArray(defaultValue);

      // And this is the last field in a set of repeated fields
      const isLastRepeatedField = valueList && index === valueList.length - 1;

      repeatContainer = getRepeatedContainer(activeStep, field);
      if (
        isLastRepeatedField &&
        (previousValue === defaultValue || isPreviousValueDefaultArray) &&
        value !== defaultValue
      ) {
        repeatRowOperation = 'add';
      }
    }

    if (servar.type === 'integer_field' && value !== '')
      value = parseFloat(value);
    else if (servar.type === 'file_upload' && index !== null)
      // For file_upload in repeating rows
      // If empty array, insert null. Otherwise de-reference the single file in the array
      value = isEmptyArray(value) ? null : value[0];
    else if (
      servar.type === 'checkbox' &&
      // eslint-disable-next-line camelcase
      servar.metadata?.always_checked
    )
      value = true;

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    updateValues[servar.key] =
      index === null
        ? value
        : justInsert(fieldValues[servar.key] || [], value, index, field);

    const change = updateFieldValues(updateValues, { rerender, triggerErrors });
    if (repeatRowOperation === 'add' && repeatContainer)
      addRepeatedRow(repeatContainer);
    return change;
  };

  const getNextStepKey = (metadata: any) =>
    nextStepKey(activeStep.next_conditions, metadata);

  const submitStep = async (
    metadata: any,
    repeat: number,
    hasNext: boolean
  ) => {
    const formattedFields = formatStepFields(
      activeStep,
      formSettings.saveHideIfFields ? null : visiblePositions,
      false
    );
    const trigger = lookUpTrigger(
      activeStep,
      metadata.elementIDs[0],
      metadata.elementType
    );
    trigger.repeatIndex = repeat;
    const newInlineErrors: any = {};

    if (
      activeStep.servar_fields.find(
        ({ servar: { type } }: any) => type === 'payment_method'
      )
    ) {
      const errors: any = await setupStepPaymentMethod(formattedFields);
      const { errorMessage, errorField } = errors;
      if (errorMessage && errorField) {
        await setFormElementError({
          formRef,
          errorCallback: getErrorCallback({ trigger }),
          fieldKey: errorField.servar.key,
          message: errorMessage,
          servarType: errorField.servar.type,
          errorType: formSettings.errorType,
          inlineErrors: newInlineErrors,
          setInlineErrors,
          triggerErrors: true
        });
        return;
      }
    }

    const customSubmitCode = async (beforeSubmit: boolean) => {
      let invalid = false;
      // Execute user-provided onSubmit function or submit rules if present
      if (
        await runUserLogic('submit', () => ({
          submitFields: formattedFields,
          trigger,
          beforeSubmit
        }))
      ) {
        // do validation check in case user has manually invalidated the step
        invalid = await setFormElementError({
          formRef,
          errorType: formSettings.errorType,
          // Need the latest accrued inlineErrors here.
          // This could have come potentially from multiple setFieldErrors calls.
          inlineErrors: internalState[_internalId].inlineErrors,
          setInlineErrors,
          triggerErrors: true
        });
      }
      return invalid;
    };

    let invalid = await customSubmitCode(true);
    if (invalid) return;

    const featheryFields = Object.entries(formattedFields).map(([key, val]) => {
      let newVal = val.value as any;
      newVal = Array.isArray(newVal)
        ? newVal.filter((v) => ![null, undefined].includes(v))
        : newVal;
      return { key, [val.type]: newVal };
    });

    const stepPromise = client.submitStep(featheryFields, activeStep, hasNext);

    const fieldData: Record<string, any> = {};
    if (integrations?.segment?.metadata.track_fields)
      fieldData.segment = formattedFields;
    if (integrations?.amplitude?.metadata.track_fields)
      fieldData.amplitude = formattedFields;
    if (integrations?.['google-tag-manager']?.metadata.track_fields)
      fieldData['google-tag-manager'] = Object.entries(formattedFields).reduce(
        (obj, [key, val]) => {
          obj[key] = val.value;
          return obj;
        },
        {} as Record<string, any>
      );
    trackEvent(
      integrations,
      'FeatheryStepSubmit',
      activeStep.key,
      formName,
      fieldData
    );

    const hasSubmitAfter = logicRules?.some(
      (logicRule: any) =>
        logicRule.trigger_event === 'submit' &&
        isRunnableStepEventRule(logicRule, activeStep.id) &&
        logicRule.metadata?.after_click
    );
    if (hasSubmitAfter) {
      // If running submit logic rule after, must finish
      // submit data first
      await stepPromise;
      invalid = await customSubmitCode(false);
      if (invalid) return;
    }

    return [stepPromise];
  };

  // usePayments (Stripe)
  const [getCardElement, setCardElement] = usePayments();

  async function setupStepPaymentMethod(formattedFields: any) {
    // Stripe payment setup is disabled on a draft.  This is because setup is mostly
    // done on the BE either on step submit or on a collect payment action, both of which
    // are themselves disabled for draft.  Also mapped field data may also be configured
    // and would require a custom submit prior to payment setup (which is also disabled for draft).
    if (!_draft)
      for (let i = 0; i < activeStep.servar_fields.length; i++) {
        const field = activeStep.servar_fields[i];
        if (field.servar.type === 'payment_method') {
          const integrationData = integrations?.stripe;
          const actionData: ActionData = {
            pmField: field,
            client,
            formattedFields,
            updateFieldValues,
            integrationData,
            targetElement: getCardElement(field.servar.key)
          };
          const actionResult = await setupPaymentMethod(actionData);
          return actionResult ?? {};
        }
      }
    return {};
  }

  async function purchaseProductsAction(triggerElement: any) {
    // Stripe purchasing is disabled on a draft.  This is because payment is mostly
    // done on the BE using collect payment EP.  Mapped field data may also be configured
    // and would require a custom submit prior to payment (which is also disabled for draft).
    if (!_draft) {
      const trigger = {
        ...lookUpTrigger(activeStep, triggerElement.key, 'container'),
        repeatIndex: 0
      } as Trigger;
      const errorCallback = getErrorCallback({
        // could be container or button but model as button for the time being...
        trigger
      });
      // validate all step fields and buttons.  Must be valid before payment.
      const { invalid, inlineErrors: newInlineErrors } = validateElements({
        step: activeStep,
        visiblePositions,
        triggerErrors: true,
        errorType: formSettings.errorType,
        formRef,
        errorCallback,
        setInlineErrors,
        trigger
      });
      if (invalid) return false;

      // payment/checkout
      const pmField = activeStep.servar_fields.find(
        ({ servar: { type } }: any) => type === 'payment_method'
      );
      const errors = await purchaseCart({
        triggerElement,
        pmField,
        client,
        updateFieldValues,
        integrationData: integrations?.stripe,
        targetElement: pmField ? getCardElement(pmField.servar.key) : null
      });
      if (errors) {
        const { errorMessage, errorField } = errors;
        await setFormElementError({
          formRef,
          errorCallback,
          fieldKey: errorField.servar ? errorField.servar.key : errorField.id,
          message: errorMessage,
          servarType: errorField.servar ? errorField.servar.type : '',
          errorType: formSettings.errorType,
          inlineErrors: newInlineErrors,
          setInlineErrors,
          triggerErrors: true
        });
        return false;
      }
    }
    return true;
  }

  async function goToNewStep({
    redirectKey,
    elementType,
    submitPromise,
    submitData = false
  }: any) {
    let eventData: Record<string, any> = {
      step_key: activeStep.key,
      event: submitData ? 'complete' : 'skip'
    };

    eventData = { ...eventData, next_step_key: redirectKey };

    await callbackRef.current.all();
    const explicitNav =
      submitData || ['button', 'text', 'container'].includes(elementType);
    if (!redirectKey) {
      if (explicitNav) {
        if (submitPromise) await submitPromise;

        // Check if there are any failed requests before completing
        if (await client.offlineRequestHandler.dbHasRequest()) {
          return;
        }

        eventData.completed = true;
        await client.registerEvent(eventData).then(() => {
          setFinished(true);
          // Need to rerender when the session is marked complete so
          // LoginForm can render children
          session.form_completed = true;
          rerenderAllForms();
        });
      }
    } else {
      const nextStep = steps[redirectKey];
      if (isStepTerminal(nextStep)) {
        const authIntegration = getAuthIntegrationMetadata(integrations);
        const complete = !isTerminalStepAuth(
          authIntegration,
          steps[stepKey].id
        );
        if (complete) {
          if (submitPromise) await submitPromise;

          // Check if there are any failed requests before completing
          if (await client.offlineRequestHandler.dbHasRequest()) {
            return;
          }

          eventData.completed = true;
          // Form completion must run after since logic may depend on
          // presence of fully submitted data
          await client
            .registerEvent(eventData)
            .then(() => handleFormComplete());
        }
      }
      if (!eventData.completed) client.registerEvent(eventData);
      updateBackNavMap({ [redirectKey]: activeStep.key });
      setShouldScrollToTop(explicitNav);

      if (trackHashes.current) {
        const newURL = getNewStepUrl(redirectKey);
        if (explicitNav) navigate(newURL);
        else navigate(newURL, { replace: true });
      } else setStepKey(redirectKey);
    }
  }

  const goToPreviousStep = async () => {
    await callbackRef.current.all();
    const prevStepKey = getPrevStepKey(activeStep, backNavMap);
    if (prevStepKey) {
      if (trackHashes.current) navigate(getNewStepUrl(prevStepKey));
      else setStepKey(prevStepKey);
    }
  };

  const setButtonLoader = async (button: any) => {
    const bp = button.properties;
    let loader: any = null;
    if (!bp.loading_icon) loader = <FeatherySpinner />;
    else if (bp.loading_icon_type === 'image/*') {
      loader = <img src={bp.loading_icon} alt='Button Loader' />;
    } else if (bp.loading_icon_type === 'application/json') {
      const animationData = await fetch(bp.loading_icon).then((response) =>
        response.json()
      );
      loader = <Lottie animationData={animationData} />;
    }
    setLoaders((loaders: Record<string, any>) => ({
      ...loaders,
      [button.id]: {
        showOn: bp.show_loading_icon,
        loader,
        type: bp.loading_icon ? bp.loading_file_type : 'default',
        repeat: button.repeat
      }
    }));
  };

  const customClickSelectionState = (
    el: ClickActionElement
  ): null | boolean => {
    let state = null;
    for (const action of el.properties?.actions ?? []) {
      if ([ACTION_BACK, ACTION_NEXT].includes(action.type)) {
        return null;
      } else if (action.type === ACTION_STORE_FIELD) {
        if (state === null) state = false;
        let val;
        if (action.custom_store_value_type === 'field') {
          val = fieldValues[action.custom_store_value_field_key];
        } else val = action.custom_store_value;

        let destVal = fieldValues[action.custom_store_field_key];
        if (isNum(el.repeat)) {
          if (Array.isArray(val)) val = val[el.repeat] ?? '';
          if (Array.isArray(destVal)) destVal = destVal[el.repeat] ?? '';
        }
        if (!!val && destVal === val) state = true;
      } else if (action.type === ACTION_SELECT_PRODUCT_TO_PURCHASE) {
        if (state === null) state = false;
        const productId = getLiveOrTestProduct(
          action.product_id,
          integrations?.stripe
        );
        if (isProductInPurchaseSelections(productId)) state = true;
      }
    }
    return state;
  };

  const buttonOnClick = async (button: ClickActionElement) => {
    await setButtonLoader(button);

    const setButtonError = (message: string) => {
      // Clear loaders before setting errors since buttons are disabled
      // when loaders are showing
      clearLoaders();
      // Set asynchronously since loaders need to unrender first
      setTimeout(
        () =>
          setFormElementError({
            formRef,
            fieldKey: button.id,
            message,
            errorType: formSettings.errorType,
            setInlineErrors,
            triggerErrors: true
          }),
        10
      );
    };

    try {
      if (button.properties.captcha_verification && !initState.isTestEnv) {
        const invalid = await verifyRecaptcha(client);
        if (invalid) {
          setButtonError("You didn't pass CAPTCHA verification");

          return;
        }
      }

      const running = await runElementActions({
        actions: button.properties.actions ?? [],
        element: button,
        elementType: 'button',
        submit: button.properties.submit,
        setElementError: setButtonError,
        onAsyncEnd: () => clearLoaders()
      });

      if (!running) clearLoaders();
    } catch (e: any) {
      if (e) setButtonError(e.toString());
      else clearLoaders();
    }
  };

  const runElementActions = async ({
    actions,
    element,
    elementType,
    submit = false,
    setElementError = () => {},
    onAsyncEnd = () => {},
    textSpanStart,
    textSpanEnd
  }: {
    actions: any[];
    element: any;
    elementType: string;
    submit?: boolean;
    setElementError?: any;
    onAsyncEnd?: any;
    textSpanStart?: number | undefined;
    textSpanEnd?: number | undefined;
  }) => {
    const id = element.id ?? '';
    // Prevent same element from being clicked multiple times while still running
    if (id && elementClicks[id]) return;
    elementClicks[id] = true;

    const metadata = {
      elementType,
      elementIDs: [element.id],
      start: textSpanStart,
      end: textSpanEnd
    };
    const trigger = {
      ...lookUpTrigger(
        activeStep,
        elementType === 'container' ? element.key : element.id,
        elementType
      ),
      repeatIndex: element.repeat
    } as Trigger;
    let submitPromise: Promise<any> = Promise.resolve();

    // If the step is readOnly, don't run validation or submit
    if (submit && !readOnly) {
      // Do not proceed until user has gone through required flows
      if (
        !hasFlowActions(actions) &&
        requiredStepAction &&
        !flowCompleted.current
      ) {
        setElementError(REQUIRED_FLOW_ACTIONS[requiredStepAction]);
        elementClicks[id] = false;
        return;
      }

      // run default form validation
      const { invalid } = validateElements({
        step: activeStep,
        visiblePositions,
        triggerErrors: true,
        errorType: formSettings.errorType,
        formRef,
        errorCallback: getErrorCallback({ trigger }),
        setInlineErrors,
        trigger
      });
      if (invalid) {
        setAutoValidate(true);
        elementClicks[id] = false;
        return;
      }

      // Don't try to complete the form on step submission if navigating to
      // a new step. The nav action goToNewStep will attempt to complete
      // it. If navigating but there is no step to navigate to, still attempt
      // to complete the form here since the user may leave before the
      // nav action event gets sent
      const hasNext =
        actions.some((action: any) => action.type === ACTION_NEXT) &&
        getNextStepKey(metadata);
      const newPromise = await submitStep(
        metadata,
        element.repeat || 0,
        !!hasNext
      );

      if (!newPromise) {
        elementClicks[id] = false;
        return;
      }
      submitPromise = newPromise[0];
    }

    // Adjust action order to prioritize certain actions and
    // to ensure all actions are run as expected
    actions = prioritizeActions(actions);

    const flowOnSuccess = (index: number) => async () => {
      flowCompleted.current = true;
      elementClicks[id] = false;
      const running = await runElementActions({
        actions: actions.slice(index + 1),
        element,
        elementType,
        submit,
        setElementError,
        onAsyncEnd,
        textSpanStart,
        textSpanEnd
      });
      if (!running) onAsyncEnd();
    };
    const actionTypes = actions.map((action) => action.type);
    const runAction = (beforeClickActions: boolean) =>
      runUserLogic(
        'action',
        () => ({
          trigger,
          beforeClickActions,
          actions: actionTypes,
          actionData: actions
        }),
        elementType === 'container' ? element.id : undefined,
        submitPromise,
        // Only need to flush data if might race against
        // click actions
        !!(beforeClickActions && actions.length)
      );

    await runAction(true);

    let i: number;
    for (i = 0; i < actions.length; i++) {
      const action = actions[i];
      const type = action.type;

      if (type === ACTION_ADD_REPEATED_ROW) {
        const container = getContainerById(activeStep, action.repeat_container);
        addRepeatedRow(container, action.max_repeats);
      } else if (type === ACTION_REMOVE_REPEATED_ROW) {
        const container = getContainerById(activeStep, action.repeat_container);
        removeRepeatedRow(element, container);
      } else if (type === ACTION_TRIGGER_PERSONA) {
        await Promise.all([submitPromise, client.flushCustomFields()]);
        const personaMeta = integrations?.persona.metadata ?? {};
        triggerPersona(
          personaMeta,
          flowOnSuccess(i),
          setElementError,
          updateFieldValues,
          client
        );
        break;
      } else if (type === ACTION_ALLOY_VERIFY_ID) {
        await verifyAlloyId(action, integrations?.alloy, flowOnSuccess(i));
        break;
      } else if (type === ACTION_SCHWAB_CREATE_CONTACT) {
        await Promise.all([submitPromise, client.flushCustomFields()]);
        await createSchwabContact(client, setElementError);
        break;
      } else if (type === ACTION_TRIGGER_PLAID) {
        await submitPromise;
        await openPlaidLink(
          client,
          flowOnSuccess(i),
          () => onAsyncEnd(),
          updateFieldValues,
          action,
          (err?: string) =>
            setElementError(err || 'Plaid was unable to fetch your data')
        );
        break;
      } else if (type === ACTION_TRIGGER_ARGYLE) {
        await submitPromise;
        await openArgyleLink(client, flowOnSuccess(i), integrations?.argyle);
        break;
      } else if (type === ACTION_TRIGGER_FLINKS) {
        await submitPromise;
        await openFlinksConnect(
          client,
          flowOnSuccess(i),
          (err?: string) => setElementError(err || 'Please connect Flinks'),
          integrations?.flinks,
          updateFieldValues
        );
        break;
      } else if (type === ACTION_URL) {
        let url = replaceTextVariables(action.url, element.repeat);
        if (url) {
          if (!url.includes(':')) url = 'https://' + url;
          if (action.open_tab) openTab(url);
        }
        if (!action.open_tab) {
          const eventData: Record<string, any> = {
            step_key: activeStep.key,
            next_step_key: '',
            event: submit ? 'complete' : 'skip',
            completed: true
          };
          await client.registerEvent(eventData);
          featheryWindow().location.href = url;
        }
      } else if (type === ACTION_SEND_SMS_MESSAGE) {
        const phoneNum = fieldValues[action.phone_target_field_key] as string;
        if (validators.phone(phoneNum)) {
          try {
            await client.sendSMSMessage(phoneNum, action.sms_message);
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('Your phone number is invalid or requested too much');
          break;
        }
      } else if (type === ACTION_SEND_SMS_CODE) {
        const phoneNum = fieldValues[action.auth_target_field_key] as string;
        if (validators.phone(phoneNum)) {
          try {
            await Auth.sendSms(phoneNum, client);
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('Your phone number is invalid or requested too much');
          break;
        }
      } else if (type === ACTION_SEND_EMAIL_CODE) {
        const emailAddress = fieldValues[action.email_field_key] as string;
        if (validators.email(emailAddress)) {
          try {
            await client.sendEmailOTP(emailAddress);
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('Your email address is invalid');
          break;
        }
      } else if ([ACTION_VERIFY_EMAIL, ACTION_VERIFY_SMS].includes(type)) {
        const pinKey = action.auth_target_field_key;
        const pin = fieldValues[pinKey] as string;
        const params = { fieldVal: pin, featheryClient: client };
        let hasErr = false;
        const prom =
          type === ACTION_VERIFY_EMAIL
            ? client.verifyOTP(pin, 'email-otp')
            : Auth.verifySMSOTP(params);
        await prom.catch((e: Error) => {
          let message = '';
          if (e.message === 'Please try again')
            message = 'Your code is invalid';
          else if (e.message in initState.defaultErrors)
            message = initState.defaultErrors[e.message];
          else message = e.message;
          setElementError(message);
          hasErr = true;
        });
        if (hasErr) break;

        client.submitCustom({ [pinKey]: pin });
        authState.redirectAfterLogin = true;
      } else if (type === ACTION_SEND_MAGIC_LINK) {
        const email = fieldValues[action.auth_target_field_key] as string;
        if (validators.email(email)) {
          try {
            await Auth.sendMagicLink(email);
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('A valid email is needed to send your magic link.');
          break;
        }
      } else if (type === ACTION_OAUTH_LOGIN) {
        const auth = await Auth.oauthRedirect(action.oauth_type, client);
        if (auth && auth.result) {
          const loginStep: any = getLoginStep(steps, integrations);
          if (loginStep) {
            await goToNewStep({
              redirectKey: loginStep.key
            });
          }
        }
      } else if (type === ACTION_LOGOUT) await Auth.inferAuthLogout();
      else if (type === ACTION_NEW_SUBMISSION) await updateUserId(uuidv4());
      else if (type === ACTION_NEXT) {
        await goToNewStep({
          redirectKey: getNextStepKey(metadata),
          elementType: metadata.elementType,
          submitData: submit,
          submitPromise
        });
      } else if (type === ACTION_BACK) await goToPreviousStep();
      else if (type === ACTION_PURCHASE_PRODUCTS) {
        const actionSuccess = await purchaseProductsAction(element);
        if (!actionSuccess) break;
      } else if (type === ACTION_SELECT_PRODUCT_TO_PURCHASE) {
        addToCart(action, updateFieldValues, integrations?.stripe, client);
      } else if (type === ACTION_REMOVE_PRODUCT_FROM_PURCHASE) {
        removeFromCart(action, updateFieldValues, integrations?.stripe, client);
      } else if (type === ACTION_VERIFY_COLLABORATOR) {
        const val = fieldValues[action.email_field_key] as string;
        if (!validators.email(val)) {
          setElementError(`${val} is an invalid email`);
          break;
        }
        const { valid } = await client.verifyCollaborator(val);
        if (!valid) {
          setElementError('Invalid form collaborator');
          break;
        }
      } else if (type === ACTION_INVITE_COLLABORATOR) {
        // Invited collaborators is a mixed list of emails and/or user group names (comma sep or array)
        const val = fieldValues[action.email_field_key];
        if (!val) {
          setElementError('Collaborators required');
          break;
        }
        const invitees = toList(val, true);
        // BE validates emails and user groups
        try {
          const res = await client.inviteCollaborator(
            invitees,
            action.template_id
          );
          const collabKey = action.collaborator_field_key;
          if (res && collabKey) {
            const newVals = {
              [collabKey]: res.collaborators.map((c: any) => c.id)
            };
            updateFieldValues(newVals);
            await client.submitCustom(newVals);
          }
        } catch (e: any) {
          setElementError((e as Error).message);
          break;
        }
      } else if (type === ACTION_REWIND_COLLABORATION) {
        try {
          await client.rewindCollaboration(
            action.template_id,
            action.email_field_key
          );
        } catch (e: any) {
          setElementError((e as Error).message);
          break;
        }
      } else if (type === ACTION_AI_EXTRACTION) {
        try {
          await submitPromise;

          const extractions = [];
          while (i < actions.length) {
            const curAction = actions[i];
            if (
              curAction.type === ACTION_AI_EXTRACTION &&
              // process the first extraction and any after if not run_sequential
              (extractions.length === 0 || !curAction.run_sequential)
            ) {
              extractions.push(
                client.runAIExtraction({
                  extractionId: curAction.extraction_id,
                  options: {
                    waitForCompletion: !curAction.run_async,
                    variantId: curAction.variant_id,
                    meetingUrl: fieldValues[curAction.meeting_url_field_key]
                  },
                  undefined,
                  setPollFuserData
                })
              );
              i++;
            } else {
              i--;
              break;
            }
          }
          const data = await Promise.all(extractions);
          const errorEntry = data.find((entry) => entry.status === 'error');
          if (errorEntry) {
            setElementError(errorEntry.message);
            break;
          } else {
            data.forEach((entry) => {
              if (entry.data) updateFieldValues(entry.data);
            });
          }
        } catch (e: any) {
          setElementError((e as Error).message);
          break;
        }
      } else if (type === ACTION_GENERATE_ENVELOPES) {
        await Promise.all([submitPromise, client.flushCustomFields()]);
        try {
          const data = await client.generateEnvelopes(action);
          const envAction = action.envelope_action;
          if (!envAction) {
            // Sign files
            const url = getSignUrl(action.redirect);
            if (action.redirect) {
              const eventData: Record<string, any> = {
                step_key: activeStep.key,
                next_step_key: '',
                event: submit ? 'complete' : 'skip',
                completed: true
              };
              await client.registerEvent(eventData);
              featheryWindow().location.href = url;
            } else openTab(url);
          } else if (envAction === 'download') {
            // Download files directly
            await downloadAllFileUrls(data.files);
          } else if (envAction === 'save') {
            let files = data.files;
            if (files.length === 1) files = files[0];
            const newValues = { [action.save_document_field_key]: files };
            updateFieldValues(newValues);
            client.submitCustom(newValues);
          }
        } catch (e: any) {
          setElementError((e as Error).message);
          break;
        }
      } else if (type === ACTION_GENERATE_QUIK_DOCUMENTS) {
        await Promise.all([submitPromise, client.flushCustomFields()]);
        try {
          const payload = await client.generateQuikEnvelopes(action);
          if (payload.error) setElementError(payload.error);
          else if (action.form_fill_type === 'html' && payload.html) {
            featheryWindow().QuikFeatherySubmitAction = () => {
              flowOnSuccess(i)().then(() => {
                // Avoid flicker of step before it navigates
                setTimeout(() => setShowQuikFormViewer(false), 500);
              });
            };
            featheryWindow().QuikFeatheryBackAction = () => {
              // Turn off loaders if user leaves the Quik viewer without
              // submitting
              clearLoaders();
            };
            setQuikHTMLPayload(payload.html);
            setShowQuikFormViewer(true);
            break;
          } else if (action.form_fill_type === 'pdf' && payload.files) {
            await downloadAllFileUrls(payload.files);
          }
        } catch (e: any) {
          setElementError((e as Error).message);
          break;
        }
      } else if (type === ACTION_STORE_FIELD) {
        const key = action.custom_store_field_key;
        if (!key) continue;

        let val;
        if (action.custom_store_value_type === 'field') {
          val = fieldValues[action.custom_store_value_field_key];
        } else val = action.custom_store_value;

        // Nested find statements return an item from the outer collection, so
        // short circuit the "some" statement once the field has been found
        let servar: any;
        Object.values(steps).some((step) => {
          const field = step.servar_fields.find(
            (field: any) => field.servar.key === key
          );
          if (field) {
            servar = field.servar;
            return true;
          }
        });

        if (isNum(element.repeat) && Array.isArray(val))
          val = val[element.repeat] ?? '';

        const hiddenFieldType = hiddenFields[key];
        val = hiddenFieldType
          ? castHiddenVal(hiddenFieldType, val)
          : castServarVal(servar?.type, val);

        let destVal = fieldValues[key] as any[];
        if (servar?.repeated) destVal = destVal[element.repeat ?? 0];
        const setToDefaultValue =
          action.toggle && JSON.stringify(destVal) === JSON.stringify(val);
        if (setToDefaultValue) {
          // could be a hidden field
          val = servar ? getDefaultFieldValue({ servar }) : '';
        }

        if (servar?.repeated) {
          destVal = [...(fieldValues[key] as any[])];
          const curIndex = element.repeat ?? 0;
          // Repeat index already set via click if retain_click_value
          if (!action.retain_click_value) destVal[curIndex] = val;
          if (action.repeat_single) {
            const defaultVal = getDefaultFieldValue({ servar });
            for (let i = 0; i < destVal.length; i++) {
              if (i !== curIndex) destVal[i] = defaultVal;
            }
          }

          val = destVal;
        } else if (action.retain_click_value) continue; // Field already set via click

        const newValues = { [key]: val };
        updateFieldValues(newValues, { clearErrors: false });
        client.submitCustom(newValues);
      } else if (type === ACTION_TELESIGN_SILENT_VERIFICATION) {
        const phoneNum = fieldValues[
          action.telesign_target_field_key
        ] as string;
        if (validators.phone(phoneNum)) {
          try {
            const silentVeriResult: boolean =
              await client.telesignSilentVerification(phoneNum);

            // set specified field value to the result
            const key = action.telesign_status_field_key;
            const newValues = {
              [key]: silentVeriResult
            };
            updateFieldValues(newValues, { clearErrors: false });
            client.submitCustom(newValues);
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('Your phone number is invalid');
          break;
        }
      } else if (type === ACTION_TELESIGN_PHONE_TYPE) {
        const phoneNum = fieldValues[
          action.telesign_target_field_key
        ] as string;
        if (validators.phone(phoneNum)) {
          try {
            const phoneType: string = await client.telesignPhoneType(phoneNum);

            // set specified field value to the result
            const key = action.telesign_status_field_key;
            const newValues = {
              [key]: phoneType
            };
            updateFieldValues(newValues, { clearErrors: false });
            client.submitCustom(newValues);
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('Your phone number is invalid');
          break;
        }
      } else if (
        [ACTION_TELESIGN_VOICE_OTP, ACTION_TELESIGN_SMS_OTP].includes(type)
      ) {
        const phoneNum = fieldValues[
          action.telesign_target_field_key
        ] as string;
        if (validators.phone(phoneNum)) {
          try {
            await client.telesignSendOTP(
              phoneNum,
              type === ACTION_TELESIGN_VOICE_OTP ? 'voice' : 'sms'
            );
          } catch (e) {
            setElementError((e as Error).message);
            break;
          }
        } else {
          setElementError('Your phone number is invalid');
          break;
        }
      } else if (type === ACTION_TELESIGN_VERIFY_OTP) {
        const pinKey = action.telesign_target_field_key;
        const pin = fieldValues[pinKey] as string;
        try {
          const pinMatch = await client.telesignVerifyOTP(pin);
          if (!pinMatch) {
            setElementError('Invalid code. Please try again');
            break;
          } else client.submitCustom({ [pinKey]: pin });
        } catch (e) {
          setElementError((e as Error).message);
          break;
        }
      }
    }

    if (i < actions.length) {
      elementClicks[id] = false;
      return true;
    }

    await runAction(false);
    elementClicks[id] = false;
  };

  const fieldOnChange =
    ({ fieldID, fieldKey, servarId, elementRepeatIndex = 0 }: any) =>
    ({
      triggerType = 'field',
      submitData = false,
      integrationData = {},
      // Multi-file upload is not a repeated row but a repeated field
      valueRepeatIndex = null
    } = {}) => {
      if (eventHasUserLogic('change')) {
        callbackRef.current.addCallback(
          runUserLogic('change', () => ({
            trigger: {
              id: fieldKey,
              _servarId: servarId,
              repeatIndex: elementRepeatIndex,
              type: triggerType
            },
            integrationData,
            valueRepeatIndex
          }))
        );
        setShouldScrollToTop(false);
      }

      let triggered = false;
      if (submitData) {
        const submitButton = activeStep.buttons.find(
          (b: any) => b.properties.submit
        );
        // Simulate button submit if available and valid to trigger button loader
        if (
          submitButton &&
          getNextStepKey({
            elementType: 'button',
            elementIDs: [submitButton.id]
          })
        ) {
          buttonOnClick(submitButton);
          triggered = true;
        }
      }
      if (!triggered) {
        const nextStep = getNextStepKey({
          elementType: 'field',
          elementIDs: [fieldID]
        });
        if (nextStep) {
          runElementActions({
            actions: [{ type: ACTION_NEXT }],
            element: { id: fieldID },
            elementType: 'field',
            submit: true
          });
        }
      }
    };

  const elementOnView =
    // be efficient and only create this function if we need it
    eventHasUserLogic('view')
      ? (elementId: any, isVisible: any) => {
          callbackRef.current.addCallback(
            runUserLogic('view', () => ({
              visibilityStatus: { elementId, isVisible }
            }))
          );
        }
      : undefined;

  const form = {
    userProgress,
    curDepth,
    maxDepth,
    elementProps,
    customComponents,
    activeStep,
    steps,
    customClickSelectionState,
    runElementActions,
    buttonOnClick,
    fieldOnChange,
    buttonLoaders,
    inlineErrors,
    setInlineErrors,
    changeValue,
    changeStep: (nextStepKey: string) =>
      changeFormStep(nextStepKey, activeStep.key, false),
    updateFieldValues,
    elementOnView,
    onViewElements: viewElements,
    formSettings,
    focusRef,
    formRef,
    setCardElement,
    visiblePositions,
    calendly: integrations?.calendly?.metadata,
    featheryContext: getFormContext(_internalId)
  };

  // If form was completed in a previous session and edits are disabled,
  // consider the form finished
  const anyFinished =
    finished || (session?.form_completed && !formSettings.allowEdits);

  useEffect(() => {
    if (!anyFinished) return;
    const redirectForm = () => {
      if (trackHashes.current)
        navigate(
          featheryWindow().location.pathname + featheryWindow().location.search,
          { replace: true }
        );
      if (initState.redirectCallbacks[_internalId]) {
        hasRedirected.current = true;
        initState.redirectCallbacks[_internalId]();
      }
    };
    handleFormComplete().then(redirectForm);
  }, [anyFinished]);

  // Form is turned off
  if (formOffReason.current === CLOSED)
    return <FormOff showCTA={formSettings.showBrand} />;
  else if (
    [COLLAB_COMPLETED, COLLAB_DIRECT_DISABLED, NO_BUSINESS_EMAIL].includes(
      formOffReason.current
    )
  )
    return <FormOff reason={formOffReason.current} showCTA={false} />;
  else if (anyFinished) {
    const completeState =
      formSettings.completionBehavior === 'show_completed_screen' ? (
        <FormOff reason={FILLED_OUT} showCTA={formSettings.showBrand} />
      ) : null;
    if (!completeState && initState.isTestEnv)
      console.log('Form has been hidden');
    return completeState;
  } else if (!activeStep) return stepLoader;

  return (
    <ReactPortal options={popupOptions}>
      <BootstrapForm
        {...formProps}
        autoComplete={formSettings.autocomplete}
        className={`feathery ${className || ''}`}
        ref={formRef}
        css={{
          ...globalCSS.getTarget('form'),
          ...stepCSS,
          ...style,
          position: 'relative',
          display: 'flex',
          ...(popupOptions ? { borderRadius: '10px' } : {})
        }}
        dir={formSettings.rightToLeft ? 'rtl' : 'ltr'}
      >
        {stepLoader}
        {children}
        {showQuikFormViewer && (
          <QuikFormViewer
            html={quikHTMLPayload}
            setShow={setShowQuikFormViewer}
          />
        )}
        {flinksFrame}
        <Grid step={activeStep} form={form} viewport={viewport} />
        {popupOptions && (
          <CloseIcon
            fill='white'
            css={{
              position: 'absolute',
              top: '17px',
              right: '17px',
              cursor: 'pointer'
            }}
            onClick={() => popupOptions.onHide && popupOptions.onHide()}
          />
        )}
        {initState.isTestEnv && (
          <DevNavBar
            allSteps={steps}
            curStep={activeStep}
            changeStep={(stepKey: string) => {
              if (trackHashes.current) navigate(getNewStepUrl(stepKey));
              else setStepKey(stepKey);
            }}
            formName={formName}
            draft={_draft}
            visible={!hideTestUI}
          />
        )}
        {global.firebase && (
          <div
            id='featheryRecaptcha'
            style={{ position: 'absolute', visibility: 'hidden' }}
          />
        )}
        <Watermark
          show={formSettings.showBrand}
          brandPosition={formSettings.brandPosition}
        />
      </BootstrapForm>
    </ReactPortal>
  );
}

// normal <Form /> (aka ReactForm) component is exported with just `props:
// Props`, so need this component to support exposing _internalId for use in
// renderAt without exposing InternalProps to SDK users
export function JSForm({
  formId,
  formName,
  _internalId,
  _isAuthLoading = false,
  ...props
}: Props & InternalProps) {
  const [remount, setRemount] = useState(false);

  useEffect(() => {
    initState.remountCallbacks[_internalId] = () =>
      setRemount((remount) => !remount);
    return () => {
      delete initState.remountCallbacks[_internalId];
    };
  }, []);

  // Check client for NextJS support
  if ((formId || formName) && runningInClient())
    return (
      <RouterProvider>
        <Form
          {...props}
          formId={formId}
          formName={formName}
          key={`${formId || formName}_${remount}`}
          _internalId={_internalId}
          _isAuthLoading={_isAuthLoading}
        />
      </RouterProvider>
    );
  else return null;
}

export default function ReactForm(props: Props) {
  let [internalId, setInternalId] = useState('');
  // Cannot use uuidv4 on server-side
  if (!internalId && runningInClient()) {
    internalId = uuidv4();
    setInternalId(internalId);
  }
  return <JSForm {...props} _internalId={internalId} />;
}
