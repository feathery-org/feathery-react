import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback
} from 'react';

import BootstrapForm from 'react-bootstrap/Form';
import debounce from 'lodash.debounce';

import { calculateStepCSS } from '../utils/hydration';
import {
  castVal,
  changeStep,
  clearBrowserErrors,
  FieldOptions,
  formatStepFields,
  getAllElements,
  getAllFields,
  getDefaultFieldValue,
  getFieldValue,
  getInitialStep,
  getNewStepUrl,
  getOrigin,
  getPrevStepKey,
  getUrlHash,
  isStepTerminal,
  isValidFieldIdentifier,
  lookUpTrigger,
  nextStepKey,
  recurseProgressDepth,
  registerRenderCallback,
  rerenderAllForms,
  setFormElementError,
  setUrlStepHash,
  updateStepFieldOptions,
  mapFormSettingsResponse,
  saveInitialValuesAndUrlParams,
  httpHelpers
} from '../utils/formHelperFunctions';
import {
  getHideIfReferences,
  getVisiblePositions
} from '../utils/hideAndRepeats';
import { validators, validateElements } from '../utils/validation';
import { initState, fieldValues, FieldValues } from '../utils/init';
import { isEmptyArray, justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';
import { useFirebaseRecaptcha } from '../integrations/firebase';
import { openPlaidLink } from '../integrations/plaid';
import {
  addToCart,
  checkForPaymentCheckoutCompletion,
  isProductInPurchaseSelections,
  usePayments,
  removeFromCart,
  setupPaymentMethod,
  purchaseCart,
  FEATHERY_PAYMENTS_SELECTIONS,
  FEATHERY_PAYMENTS_TOTAL
} from '../integrations/stripe';
import { ActionData, trackEvent } from '../integrations/utils';
import DevNavBar from './components/DevNavBar';
import FeatherySpinner from '../elements/components/Spinner';
import CallbackQueue from '../utils/callbackQueue';
import { featheryWindow, openTab, runningInClient } from '../utils/browser';
import FormOff from '../elements/components/FormOff';
import Lottie from '../elements/components/Lottie';
import Watermark from '../elements/components/Watermark';
import Grid from './grid';
import { mobileBreakpointValue } from '../elements/styles';
import {
  ContextOnChange,
  FormContext,
  ContextOnSubmit,
  ContextOnError,
  ContextOnView,
  ElementProps,
  PopupOptions,
  ContextOnAction,
  Trigger
} from '../types/Form';
import usePrevious from '../hooks/usePrevious';
import ReactPortal from './components/ReactPortal';
import { replaceTextVariables } from '../elements/components/TextNodes';
import { getFormContext } from '../utils/formContext';
import { v4 as uuidv4 } from 'uuid';
import internalState, { setFormInternalState } from '../utils/internalState';
import useFormAuth from '../auth/internal/useFormAuth';
import {
  ACTION_ADD_REPEATED_ROW,
  ACTION_BACK,
  ACTION_OAUTH_LOGIN,
  ACTION_LOGOUT,
  ACTION_NEXT,
  ACTION_REMOVE_REPEATED_ROW,
  ACTION_PURCHASE_PRODUCTS,
  ACTION_SELECT_PRODUCT_TO_PURCHASE,
  ACTION_REMOVE_PRODUCT_FROM_PURCHASE,
  ACTION_SEND_MAGIC_LINK,
  ACTION_SEND_SMS,
  ACTION_STORE_FIELD,
  ACTION_TRIGGER_PLAID,
  ACTION_URL,
  ACTION_VERIFY_SMS,
  ACTION_TRIGGER_ARGYLE,
  REQUIRED_FLOW_ACTIONS,
  hasFlowActions
} from '../utils/elementActions';
import { openArgyleLink } from '../integrations/argyle';
import { authState } from '../auth/LoginForm';
import {
  getAuthIntegrationMetadata,
  isTerminalStepAuth
} from '../auth/internal/utils';
import Field from '../utils/Field';
import Auth from '../auth/internal/AuthIntegrationInterface';
import { CloseIcon } from '../elements/components/icons';
import useLoader, { InitialLoader } from '../hooks/useLoader';
import { installRecaptcha, verifyRecaptcha } from '../integrations/recaptcha';
export * from './grid/StyledContainer';
export type { StyledContainerProps } from './grid/StyledContainer';

export interface Props {
  formName: string;
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
  language?: string;
  initialLoader?: InitialLoader;
  popupOptions?: PopupOptions;
  elementProps?: ElementProps;
  contextRef?: React.MutableRefObject<null | FormContext>;
  formProps?: Record<string, any>;
  customComponents?: Record<string, any>;
  style?: { [cssProperty: string]: string };
  className?: string;
  children?: JSX.Element;
  _draft?: boolean;
}

interface InternalProps {
  _internalId: string; // Used to uniquely identify forms when the same form is rendered multiple times
  _isAuthLoading?: boolean; // Flag to show the loader for auth purposes
  _bypassCDN?: boolean; // Fetch form directly from API if true
}

interface ClickActionElement {
  id: string;
  properties: { [key: string]: any };
  repeat?: any;
}

interface LogicRule {
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

const getViewport = () => {
  return featheryWindow().innerWidth > mobileBreakpointValue
    ? 'desktop'
    : 'mobile';
};

function Form({
  _internalId,
  _isAuthLoading = false,
  _bypassCDN = false,
  formName,
  onChange = null,
  onLoad = null,
  onFormComplete = null,
  onSubmit = null,
  onError = null,
  onView = null,
  onAction = null,
  onViewElements = [],
  saveUrlParams = false,
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
  _draft = false
}: InternalProps & Props) {
  const [client, setClient] = useState<any>(null);
  const history = useHistory();
  const session = initState.formSessions[formName];

  const [autoValidate, setAutoValidate] = useState(false);

  const [productionEnv, setProductionEnv] = useState(true);
  const [steps, setSteps] = useState<Record<string, any>>({});
  const [activeStep, setActiveStep] = useState<any>(null);
  const [stepKey, setStepKey] = useState('');
  const [shouldScrollToTop, setShouldScrollToTop] = useState(false);
  const [finished, setFinished] = useState(false);
  const [userProgress, setUserProgress] = useState(null);
  const [curDepth, setCurDepth] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const [formSettings, setFormSettings] = useState({
    errorType: 'html5',
    autocomplete: 'on',
    autofocus: true,
    formOff: undefined as undefined | boolean,
    showBrand: false,
    brandPosition: undefined,
    autoscroll: 'top_of_form',
    rightToLeft: false,
    allowEdits: true,
    saveUrlParams: false,
    completionBehavior: ''
  });
  const trackHashes = useRef(false);

  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [hiddenFieldKeys, setHiddenFieldKeys] = useState<string[]>([]);

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

  const [viewport, setViewport] = useState(getViewport());
  const handleResize = () => setViewport(getViewport());

  const prevAuthId = usePrevious(authState.authId);
  const prevStepKey = usePrevious(stepKey);

  // Set to trigger conditional renders on field value updates, no need to use the value itself
  const [render, setRender] = useState({ v: 1 });

  // When the active step changes, recalculate the dimensions of the new step
  const stepCSS = useMemo(() => calculateStepCSS(activeStep), [activeStep]);

  useFirebaseRecaptcha(activeStep);
  const getNextAuthStep = useFormAuth({
    initialStep: getInitialStep({
      initialStepId,
      steps,
      trackHashes: trackHashes.current
    }),
    integrations,
    setStepKey,
    steps,
    client,
    _internalId
  });

  const [backNavMap, setBackNavMap] = useState({});
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
  const focusRef = useRef<any>();
  // Tracks the execution of user-provided callback functions
  const callbackRef = useRef<any>(new CallbackQueue(null, setLoaders));
  // Tracks if the form has redirected
  const hasRedirected = useRef<boolean>(false);
  const elementClicks = useRef<any>({}).current;

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
    featheryWindow().addEventListener('resize', handleResize);
    return () => featheryWindow().removeEventListener('resize', handleResize);
  }, []);

  // Logic to run every time step changes
  useEffect(() => {
    if (!activeStep) return;

    setAutoValidate(false); // Each step to initially not auto validate

    if (formSettings.autofocus && focusRef.current?.focus) {
      focusRef.current.focus({
        preventScroll: true
      });
      focusRef.current = null;
    }

    activeStep.buttons.forEach((b: any) =>
      (b.properties.actions ?? []).forEach((action: any) => {
        if (action.type in REQUIRED_FLOW_ACTIONS) {
          setRequiredStepAction(action.type);
        }
      })
    );
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
      const top =
        autoscroll === 'top_of_form' ? formRef?.current?.offsetTop : 0;
      try {
        // Needs to be async to scroll up in Safari sometimes
        setTimeout(
          () => featheryWindow().scrollTo({ top, behavior: 'smooth' }),
          100
        );
      } catch (e) {
        // Some browsers may not have support for scrollTo
        console.warn(e);
      }
    }
  }, [stepKey]);

  function addRepeatedRow() {
    // Collect a list of all repeated elements
    const repeatedServarFields = activeStep.servar_fields.filter(
      (field: any) => field.servar.repeated
    );

    // Update the values by appending a default value for each field
    const updatedValues = {};
    repeatedServarFields.forEach((field: any) => {
      const { servar } = field;
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      updatedValues[servar.key] = [
        // @ts-expect-error TS(2461): Type 'FeatheryFieldTypes' is not an array type.
        ...fieldValues[servar.key],
        getDefaultFieldValue(field)
      ];
    });

    setRepeatChanged((repeatChanged) => !repeatChanged);
    updateFieldValues(updatedValues);
  }

  function removeRepeatedRow(index: number) {
    if (isNaN(index)) return;

    // Collect a list of all repeated elements
    const repeatedServarFields = activeStep.servar_fields.filter(
      (field: any) => field.servar.repeated
    );

    // Update the values by removing the specified index from each field
    const updatedValues = {};
    repeatedServarFields.forEach((field: any) => {
      const { servar } = field;
      const newRepeatedValues = justRemove(fieldValues[servar.key], index);
      const defaultValue = [getDefaultFieldValue(field)];
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      updatedValues[servar.key] =
        newRepeatedValues.length === 0 ? defaultValue : newRepeatedValues;
    });

    setRepeatChanged((repeatChanged) => !repeatChanged);
    updateFieldValues(updatedValues);
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

  const updateFieldValues = (newFieldValues: any, rerender = true) => {
    clearBrowserErrors(formRef);
    const entries = Object.entries(newFieldValues);
    if (entries.every(([key, val]) => fieldValues[key] === val)) return false;

    const empty = entries.some(([key, val]) => !val || !fieldValues[key]);
    const hideIfDependenciesChanged = entries.some(
      ([key, val]) => fieldValues[key] !== val && hideIfFieldReferences.has(key)
    );

    Object.assign(fieldValues, newFieldValues);

    // Always rerender from empty state for display purposes
    // If any fields involved in a hideIf have changed, then rerender if
    // its dependencies have changed. The field that changed needs to immediately
    // rerender if specified, but hideIf rerenders can be debounced
    if (rerender || empty) setRender((render) => ({ ...render }));
    else if (hideIfDependenciesChanged) debouncedRerender();

    // Only validate on each field change if auto validate is enabled due to prev a submit attempt
    if (autoValidate) debouncedValidate(setInlineErrors);

    return true;
  };

  const updateFieldOptions =
    (stepData: any, curStep: any) => (newOptions: FieldOptions) => {
      Object.values(stepData).forEach((step) =>
        updateStepFieldOptions(step, newOptions)
      );
      setSteps(JSON.parse(JSON.stringify(stepData)));

      updateStepFieldOptions(curStep, newOptions);
      setActiveStep(JSON.parse(JSON.stringify(curStep)));
    };

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
    if (featheryWindow().webkit?.messageHandlers?.feathery) {
      if (!productionEnv) console.log('Webkit event sent');
      featheryWindow().webkit.messageHandlers.feathery.postMessage(
        'Form completed'
      );
    }
    // Send form completion message for React Native Webview
    if (featheryWindow().ReactNativeWebView) {
      if (!productionEnv) console.log('React Native Webview event sent');
      featheryWindow().ReactNativeWebView.postMessage('Form completed');
    }
    // Send form completion message for Android Webview
    if (global.FeatheryInterface) {
      if (!productionEnv) console.log('Android Webview event sent');
      global.FeatheryInterface.onComplete();
    }
    await runUserLogic('form_complete');
  };

  const runUserLogic = async (
    event: string,
    getProps: () => Record<string, any> = () => ({}),
    containerId?: string | undefined
  ) => {
    const props = {
      ...getFormContext(_internalId),
      ...getProps()
    };
    const stepEvents = ['submit', 'load'];
    const elementEvents = ['view', 'change', 'action'];

    let logicRan = false;
    if (typeof eventCallbackMap[event] === 'function') {
      logicRan = true;
      await eventCallbackMap[event](props);
    }
    // filter the logicRules that have trigger_event matching the trigger event (type_)
    if (logicRules) {
      const logicRulesForEvent = logicRules.filter(
        (logicRule: any) => logicRule.trigger_event === event
      );
      // Run the logic rules in sequence!
      for (const logicRule of logicRulesForEvent) {
        // all disabled, invalid or empty rules are filtered out by the BE

        const currentStepId = (internalState[_internalId]?.currentStep ?? {})
          .id;
        // Apply steps and elements filters to the applicable event types
        // to determine if the rule should be run.  Some event types support
        // neither filter and will always run.
        if (
          ![...stepEvents, ...elementEvents].includes(
            logicRule.trigger_event
          ) ||
          (stepEvents.includes(logicRule.trigger_event) &&
            (logicRule.steps.length === 0 ||
              (logicRule.steps.length > 0 &&
                logicRule.steps.includes(currentStepId)))) ||
          (logicRule.trigger_event === 'view' &&
            logicRule.elements.includes(
              (props as ContextOnView).visibilityStatus.elementId
            )) ||
          (logicRule.trigger_event === 'change' &&
            logicRule.elements.includes(
              (props as ContextOnChange | ContextOnAction).trigger._servarId ??
                ''
            )) ||
          (logicRule.trigger_event === 'action' &&
            (logicRule.elements.includes(
              (props as ContextOnChange | ContextOnAction).trigger.id
            ) ||
              logicRule.elements.includes(containerId ?? '')))
        ) {
          logicRan = true;

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
              { ...props, http: httpHelpers(client) },
              ...Object.values(injectableFields)
            );
          } catch (e) {
            // rule had an error, log it to console for now
            console.warn(
              'Exception while running rule: ',
              logicRule.name,
              ' On Event: ',
              logicRule.trigger_event,
              ' Exception: ',
              e
            );
          }
        }
      }
    }
    return logicRan;
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

  const getNewStep = async (newKey: any) => {
    let newStep = steps[newKey];

    const nextStep = getNextAuthStep(newStep);
    if (
      nextStep !== '' &&
      productionEnv &&
      changeStep(nextStep, newKey, steps, history)
    )
      return;
    newStep = JSON.parse(JSON.stringify(newStep));

    // This could be a redirect from Stripe following a successful payment checkout
    checkForPaymentCheckoutCompletion(
      newStep,
      client,
      updateFieldValues,
      integrations?.stripe
    );

    // create fields only once and seal it
    let fields = internalState[_internalId]?.fields;
    if (!fields || !Object.isSealed(fields))
      fields = Object.seal(
        getAllFields(fieldKeys, hiddenFieldKeys, _internalId)
      );

    setFormInternalState(
      _internalId,
      {
        currentStep: newStep,
        previousStepName: activeStep?.key ?? '',
        visiblePositions: getVisiblePositions(newStep),
        client,
        fields,
        formName,
        formRef,
        formSettings,
        getErrorCallback,
        history,
        inlineErrors,
        setInlineErrors,
        setUserProgress,
        steps,
        updateFieldOptions,
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
              errorType: formSettings.errorType,
              inlineErrors,
              setInlineErrors,
              triggerErrors: true
            });
          });
        }
      },
      // Avoid all these other obj props going through Object.assign which is not necessary.
      // It turns out that not doing so caused breakage on steps after the first step.
      // But for only fields it is fine and necessary.
      ['fields']
    );

    // This could be a redirect from Stripe following a successful payment checkout
    checkForPaymentCheckoutCompletion(
      newStep,
      client,
      updateFieldValues,
      integrations?.stripe
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

    trackEvent('FeatheryStepLoad', newKey, formName);

    callbackRef.current = new CallbackQueue(newStep, setLoaders);
    // Hydrate field descriptions
    newStep.servar_fields.forEach((field: any) => {
      field.servar.name = replaceTextVariables(field.servar.name, field.repeat);
    });
    // setActiveStep, apparently, must go after setting the callbackRef
    // because it triggers a new render, before this fn finishes execution,
    // which can cause onView to fire before the callbackRef is set
    setActiveStep(newStep);
    client.registerEvent({ step_key: newStep.key, event: 'load' });
  };

  const visiblePositions = useMemo(
    () => (activeStep ? getVisiblePositions(activeStep) : null),
    [activeStep, render]
  );

  useEffect(() => {
    if (client === null) {
      const clientInstance = new Client(
        formName,
        hasRedirected,
        _draft,
        _bypassCDN
      );
      setClient(clientInstance);
      let saveUrlParamsFormSetting = false;
      // render form without values first for speed
      const formPromise = clientInstance
        .fetchForm(initialValues, language)
        .then(({ steps, ...res }) => {
          steps = steps.reduce((result: any, step: any) => {
            result[step.key] = step;
            return result;
          }, {});
          setSteps(steps);
          if (res.completion_behavior === 'redirect' && res.redirect_url)
            initState.redirectCallbacks[_internalId] = () => {
              featheryWindow().location.href = res.redirect_url;
            };
          if (res.save_url_params) saveUrlParamsFormSetting = true;
          setFormSettings(mapFormSettingsResponse(res));
          setLogicRules(res.logic_rules);
          trackHashes.current = res.track_hashes;

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

          setProductionEnv(res.production);
          if (res.production) installRecaptcha(steps);
          return steps;
        });
      // fetch values separately because this request
      // goes to Feathery origin, while the previous
      // request goes to our CDN
      clientInstance
        // @ts-expect-error TS(2345): Argument of type 'Promise<any[]>' is not assignabl... Remove this comment to see the full error message
        .fetchSession(formPromise, true)
        .then(([session, steps]) => {
          if (!session.track_location && trackHashes.current) {
            // Clear URL hash on new session if not tracking location
            history.replace(location.pathname + location.search);
          }
          updateBackNavMap(session.back_nav_map);
          setIntegrations(session.integrations);

          setFieldKeys(session.servars);
          setHiddenFieldKeys(session.hidden_fields);

          saveInitialValuesAndUrlParams({
            updateFieldValues,
            client: clientInstance,
            saveUrlParams: saveUrlParams || saveUrlParamsFormSetting,
            initialValues,
            steps
          });

          // User is authenticating. auth hook will set the initial stepKey once auth has finished
          if (authState.redirectAfterLogin) return;

          const newKey = getInitialStep({
            initialStepId,
            steps,
            sessionCurrentStep: session.current_step_key,
            trackHashes: trackHashes.current
          });
          if (trackHashes.current) setUrlStepHash(history, steps, newKey);
          setStepKey(newKey);
        })
        .catch(async (error) => {
          console.warn(error);
          // Go to first step if origin fails
          const [data] = await formPromise;
          const newKey = (getOrigin as any)(data).key;
          if (trackHashes.current) setUrlStepHash(history, steps, newKey);
          else setStepKey(newKey);
        });
    }
  }, [client, activeStep, setClient, setSteps, updateFieldValues]);

  useEffect(() => {
    return history.listen(async () => {
      if (!trackHashes.current) return;
      const hashKey = getUrlHash();
      if (hashKey in steps) setStepKey(hashKey);
    });
  }, [steps]);

  useEffect(() => {
    // We set render to re-evaluate auth nav rules - but should only getNewStep if either the step or authId has changed.
    // Should not fetch new step if render was set for another reason
    if (stepKey && (prevStepKey !== stepKey || prevAuthId !== authState.authId))
      getNewStep(stepKey);
  }, [stepKey, render]);

  // Note: If index is provided, handleChange assumes the field is a repeated field
  const changeValue = (
    value: any,
    field: any,
    index = null,
    rerender = true
  ) => {
    const updateValues = {};
    let repeatRowOperation;

    const servar = field.servar;
    if (servar.repeat_trigger === 'set_value') {
      const defaultValue = getDefaultFieldValue(field);
      const { value: previousValue, valueList } = getFieldValue(field);

      // Add a repeated row if the value went from unset to set
      const isPreviousValueDefaultArray =
        isEmptyArray(previousValue) && isEmptyArray(defaultValue);

      // And this is the last field in a set of repeated fields
      const isLastRepeatedField = valueList && index === valueList.length - 1;

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
        : justInsert(fieldValues[servar.key] || [], value, index);

    const change = updateFieldValues(updateValues, rerender);
    if (repeatRowOperation === 'add') addRepeatedRow();
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
      visiblePositions,
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

    // Execute user-provided onSubmit function or submit rules if present
    if (
      await runUserLogic('submit', () => ({
        submitFields: formattedFields,
        trigger
      }))
    ) {
      // do validation check in case user has manually invalidated the step
      const invalid = await setFormElementError({
        formRef,
        errorType: formSettings.errorType,
        // Need the latest accrued inlineErrors here.
        // This could have come potentially from multiple setFieldErrors calls.
        inlineErrors: internalState[_internalId].inlineErrors,
        setInlineErrors,
        triggerErrors: true
      });
      if (invalid) return;
    }

    const hiddenPromise = submitStepHiddenFields();
    const featheryFields = Object.entries(formattedFields).map(([key, val]) => {
      let newVal = (val as any).value;
      newVal = Array.isArray(newVal)
        ? newVal.filter((v) => v || [0, ''].includes(v))
        : newVal;
      return { key, [(val as any).type]: newVal };
    });
    const stepPromise =
      featheryFields.length > 0
        ? client.submitStep(featheryFields, activeStep.key, hasNext)
        : Promise.resolve();

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
    trackEvent('FeatheryStepSubmit', activeStep.key, formName, fieldData);

    return [hiddenPromise, stepPromise];
  };

  const isStoreFieldValueAction = (el: any) =>
    (el.properties?.actions ?? []).some(
      (action: any) => action.type === ACTION_STORE_FIELD
    );

  const submitStepHiddenFields = () => {
    const items = [
      ...activeStep.buttons.filter(isStoreFieldValueAction),
      ...activeStep.subgrids.filter(isStoreFieldValueAction)
    ];
    const hiddenFields: Record<string, any> = {};
    items.forEach(({ properties }: any) => {
      const fieldKey = properties.custom_store_field_key;
      const value = fieldValues[fieldKey];
      // need to include value === '' so that we can clear out hidden fields
      if (value !== undefined) hiddenFields[fieldKey] = value;
    });
    // submit feathery reserved hidden fields
    if (fieldValues[FEATHERY_PAYMENTS_SELECTIONS] !== undefined)
      hiddenFields[FEATHERY_PAYMENTS_SELECTIONS] =
        fieldValues[FEATHERY_PAYMENTS_SELECTIONS];
    if (fieldValues[FEATHERY_PAYMENTS_TOTAL] !== undefined)
      hiddenFields[FEATHERY_PAYMENTS_TOTAL] =
        fieldValues[FEATHERY_PAYMENTS_TOTAL];
    return client.submitCustom(hiddenFields);
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
    metadata,
    submitPromise = null,
    submitData = false
  }: any) {
    let eventData: Record<string, any> = {
      step_key: activeStep.key,
      event: submitData ? 'complete' : 'skip'
    };

    const redirectKey = getNextStepKey(metadata);
    eventData = { ...eventData, next_step_key: redirectKey };

    await callbackRef.current.all();
    const explicitNav =
      submitData || ['button', 'text'].includes(metadata.elementType);
    if (!redirectKey) {
      if (explicitNav) {
        eventData.completed = true;
        await client.registerEvent(eventData, submitPromise).then(() => {
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
          eventData.completed = true;
          await handleFormComplete();
        }
      }
      client.registerEvent(eventData, submitPromise);
      updateBackNavMap({ [redirectKey]: activeStep.key });
      setShouldScrollToTop(explicitNav);

      if (trackHashes.current) {
        const newURL = getNewStepUrl(redirectKey);
        if (explicitNav) history.push(newURL);
        else history.replace(newURL);
      } else setStepKey(redirectKey);
    }
  }

  const goToPreviousStep = async () => {
    await callbackRef.current.all();
    const prevStepKey = getPrevStepKey(activeStep, backNavMap);
    if (prevStepKey) {
      if (trackHashes.current) history.push(getNewStepUrl(prevStepKey));
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
        type: bp.loading_icon ? bp.loading_file_type : 'default'
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
        if (!!val && fieldValues[action.custom_store_field_key] === val)
          state = true;
      } else if (action.type === ACTION_SELECT_PRODUCT_TO_PURCHASE) {
        if (state === null) state = false;
        if (isProductInPurchaseSelections(action.product_id)) state = true;
      }
    }
    return state;
  };

  const buttonOnClick = async (button: ClickActionElement) => {
    await setButtonLoader(button);

    const setButtonError = (message: string) =>
      setFormElementError({
        formRef,
        fieldKey: button.id,
        message,
        errorType: formSettings.errorType,
        setInlineErrors,
        triggerErrors: true
      });
    if (button.properties.captcha_verification && productionEnv) {
      const invalid = await verifyRecaptcha(client);
      if (invalid) {
        setButtonError('Submission failed');
        clearLoaders();
        return;
      }
    }

    await runElementActions({
      actions: button.properties.actions ?? [],
      element: button,
      elementType: 'button',
      submit: button.properties.submit,
      setElementError: setButtonError
    });

    clearLoaders();
  };

  const runElementActions = async ({
    actions,
    element,
    elementType,
    submit = false,
    setElementError = () => {},
    textSpanStart,
    textSpanEnd
  }: {
    actions: any[];
    element: any;
    elementType: string;
    submit?: boolean;
    setElementError?: any;
    textSpanStart?: number | undefined;
    textSpanEnd?: number | undefined;
  }) => {
    const id = element.id ?? '';
    // Prevent same element from being clicked multiple times while still running
    if (id && elementClicks[id]) return;
    elementClicks[id] = true;

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
    if (submit) {
      setAutoValidate(true);

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
      submitPromise = Promise.all(newPromise);
    }

    const flowOnSuccess = (index: number) => async () => {
      flowCompleted.current = true;
      elementClicks[id] = false;
      await runElementActions({
        actions: actions.slice(index + 1),
        element,
        elementType,
        submit,
        setElementError,
        textSpanStart,
        textSpanEnd
      });
    };

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const type = action.type;

      await runUserLogic(
        'action',
        () => ({
          trigger,
          action: type
        }),
        elementType === 'container' ? element.id : undefined
      );

      if (type === ACTION_ADD_REPEATED_ROW) addRepeatedRow();
      else if (type === ACTION_REMOVE_REPEATED_ROW)
        removeRepeatedRow(element.repeat);
      else if (type === ACTION_TRIGGER_PLAID) {
        await submitPromise;
        await openPlaidLink(client, flowOnSuccess(i), updateFieldValues);
        break;
      } else if (type === ACTION_TRIGGER_ARGYLE) {
        await submitPromise;
        await openArgyleLink(client, flowOnSuccess(i), integrations?.argyle);
        break;
      } else if (type === ACTION_URL) {
        let url = replaceTextVariables(action.url, element.repeat);
        if (url) {
          if (!url.includes(':')) url = 'https://' + url;
          if (action.open_tab) openTab(url);
          else {
            const eventData: Record<string, any> = {
              step_key: activeStep.key,
              next_step_key: '',
              event: submit ? 'complete' : 'skip',
              completed: true
            };
            client.registerEvent(eventData, submitPromise).then(() => {
              location.href = url;
            });
          }
        }
      } else if (type === ACTION_SEND_SMS) {
        const phoneNum = fieldValues[action.auth_target_field_key] as string;
        if (validators.phone(phoneNum)) {
          try {
            await Auth.sendSms(phoneNum, client);
          } catch (e) {
            setElementError((e as Error).message);
            elementClicks[id] = false;
            break;
          }
        } else {
          setElementError('Your phone number is invalid or requested too much');
          break;
        }
      } else if (type === ACTION_VERIFY_SMS) {
        const pinKey = action.auth_target_field_key;
        const pin = fieldValues[pinKey] as string;
        const params = { fieldVal: pin, featheryClient: client };
        let hasErr = false;
        await Auth.verifySms(params).catch((e) => {
          setElementError(
            (e as Error).message === 'Please try again.'
              ? 'Your code is invalid'
              : (e as Error).message
          );
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
            elementClicks[id] = false;
            break;
          }
        } else {
          setElementError('A valid email is needed to send your magic link.');
          break;
        }
      } else if (type === ACTION_OAUTH_LOGIN)
        Auth.oauthRedirect(action.oauth_type);
      else if (type === ACTION_LOGOUT) await Auth.inferAuthLogout();
      else if (type === ACTION_NEXT) {
        await goToNewStep({
          metadata,
          submitPromise,
          submitData: submit
        });
      } else if (type === ACTION_BACK) await goToPreviousStep();
      else if (type === ACTION_PURCHASE_PRODUCTS) {
        const actionSuccess = await purchaseProductsAction(element);
        if (!actionSuccess) break;
      } else if (type === ACTION_SELECT_PRODUCT_TO_PURCHASE) {
        addToCart(action, updateFieldValues, integrations?.stripe);
      } else if (type === ACTION_REMOVE_PRODUCT_FROM_PURCHASE) {
        removeFromCart(action, updateFieldValues, integrations?.stripe);
      } else if (type === ACTION_STORE_FIELD) {
        let val;
        if (action.custom_store_value_type === 'field') {
          val = fieldValues[action.custom_store_value_field_key];
        } else val = action.custom_store_value;

        const key = action.custom_store_field_key;

        // Nested find statements return an item from the outer collection, so
        // short circuit the "some" statement once the field has been found
        let field: any;
        Object.values(steps).some((step) => {
          field = step.servar_fields.find(
            (field: any) => field.servar.key === key
          );
          if (field) return true;
        });

        const castValue = castVal(field?.servar.type, val);
        const setToDefaultValue =
          action.toggle &&
          JSON.stringify(fieldValues[key]) === JSON.stringify(castValue);

        // could be a hidden field
        const defaultValue = field ? getDefaultFieldValue(field) : '';
        const newValues = {
          [key]: setToDefaultValue ? defaultValue : castValue
        };
        updateFieldValues(newValues);
        client.submitCustom(newValues);
      }
    }

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
    customClickSelectionState,
    runElementActions,
    buttonOnClick,
    fieldOnChange,
    buttonLoaders,
    inlineErrors,
    setInlineErrors,
    changeValue,
    updateFieldValues,
    elementOnView,
    onViewElements: viewElements,
    formSettings,
    focusRef,
    formRef,
    setCardElement,
    visiblePositions,
    calendlyUrl: integrations?.calendly?.metadata.api_key
  };

  const completeState =
    formSettings.completionBehavior === 'show_completed_screen' ? (
      <FormOff noEdit showCTA={formSettings.showBrand} />
    ) : null;

  // If form was completed in a previous session and edits are disabled,
  // consider the form finished
  const anyFinished =
    finished || (session?.form_completed && !formSettings.allowEdits);

  useEffect(() => {
    if (!anyFinished) return;
    const redirectForm = () => {
      if (trackHashes.current)
        history.replace(location.pathname + location.search);
      if (initState.redirectCallbacks[_internalId]) {
        hasRedirected.current = true;
        initState.redirectCallbacks[_internalId]();
      }
    };
    handleFormComplete().then(redirectForm);
  }, [anyFinished]);

  // Form is turned off
  if (formSettings.formOff) return <FormOff showCTA={formSettings.showBrand} />;
  else if (anyFinished) {
    if (!completeState && !productionEnv) console.log('Form has been hidden');
    return completeState;
  } else if (!activeStep) return stepLoader;

  return (
    <ReactPortal options={popupOptions}>
      <BootstrapForm
        {...formProps}
        autoComplete={formSettings.autocomplete}
        className={className}
        ref={formRef}
        css={{
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
        {!productionEnv && (
          <DevNavBar
            allSteps={steps}
            curStep={activeStep}
            changeStep={(stepKey: string) => {
              if (trackHashes.current) history.push(getNewStepUrl(stepKey));
              else setStepKey(stepKey);
            }}
            formName={formName}
            draft={_draft}
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
  formName,
  language,
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
  if (formName && runningInClient())
    return (
      /* @ts-ignore */
      <BrowserRouter>
        {/* @ts-ignore */}
        <Route path='/'>
          <Form
            {...props}
            formName={formName}
            // Changing the language changes the key and fetches the new form data
            key={`${formName}_${language}_${remount}`}
            language={language}
            _internalId={_internalId}
            _isAuthLoading={_isAuthLoading}
          />
        </Route>
      </BrowserRouter>
    );
  else return null;
}

export default function ReactForm(props: Props): JSX.Element | null {
  let [internalId, setInternalId] = useState('');
  // Cannot use uuidv4 on server-side
  if (!internalId && runningInClient()) {
    internalId = uuidv4();
    setInternalId(internalId);
  }
  return <JSForm {...props} _internalId={internalId} />;
}
