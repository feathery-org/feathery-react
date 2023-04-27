import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback
} from 'react';

import BootstrapForm from 'react-bootstrap/Form';
import { useHotkeys } from 'react-hotkeys-hook';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import debounce from 'lodash.debounce';

import { calculateStepCSS } from '../utils/hydration';
import {
  castVal,
  changeStep,
  FieldOptions,
  formatAllFormFields,
  formatStepFields,
  getAllElements,
  getDefaultFieldValue,
  getFieldValue,
  getInitialStep,
  getNewStepUrl,
  getOrigin,
  getPrevStepUrl,
  getServarTypeMap,
  getUrlHash,
  lookUpTrigger,
  nextStepKey,
  recurseProgressDepth,
  registerRenderCallback,
  rerenderAllForms,
  setFormElementError,
  setUrlStepHash,
  updateStepFieldOptions
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
  usePayments,
  setupPaymentMethod,
  collectPayment
} from '../integrations/stripe';
import { ActionData, trackEvent } from '../integrations/utils';
import DevNavBar from './components/DevNavBar';
import Spinner from '../elements/components/Spinner';
import { isObjectEmpty } from '../utils/primitives';
import CallbackQueue from '../utils/callbackQueue';
import { openTab, runningInClient } from '../utils/browser';
import FormOff from '../elements/components/FormOff';
import Lottie from '../elements/components/Lottie';
import Watermark from '../elements/components/Watermark';
import Grid from './grid';
import { mobileBreakpointValue } from '../elements/styles';
import {
  ContextOnChange,
  ContextOnLoad,
  FormContext,
  ContextOnSubmit,
  ContextOnSkip,
  ContextOnError,
  ContextOnCustomAction,
  ContextOnView,
  ElementProps,
  IntegrationData,
  PopupOptions
} from '../types/Form';
import usePrevious from '../hooks/usePrevious';
import ReactPortal from './components/ReactPortal';
import { replaceTextVariables } from '../elements/components/TextNodes';
import { getFormContext } from '../utils/formContext';
import { v4 as uuidv4 } from 'uuid';
import internalState from '../utils/internalState';
import useFormAuth from '../auth/internal/useFormAuth';
import {
  ACTION_ADD_REPEATED_ROW,
  ACTION_BACK,
  ACTION_CUSTOM,
  ACTION_OAUTH_LOGIN,
  ACTION_LOGOUT,
  ACTION_NEXT,
  ACTION_REMOVE_REPEATED_ROW,
  ACTION_COLLECT_PAYMENT,
  ACTION_SEND_MAGIC_LINK,
  ACTION_SEND_SMS,
  ACTION_STORE_FIELD,
  ACTION_TRIGGER_PLAID,
  ACTION_URL,
  ACTION_VERIFY_SMS,
  ACTIONS_TO_VALIDATE,
  shouldValidateStep,
  SUBMITTABLE_ACTIONS,
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
import Auth from '../auth/internal/AuthIntegrationInterface';
import { CloseIcon } from '../elements/components/icons';
import useLoader, { InitialLoader } from '../hooks/useLoader';

export interface Props {
  formName: string;
  onChange?: null | ((context: ContextOnChange) => Promise<any> | void);
  onLoad?: null | ((context: ContextOnLoad) => Promise<any> | void);
  onFormComplete?: null | ((context: FormContext) => Promise<any> | void);
  onSubmit?: null | ((context: ContextOnSubmit) => Promise<any> | void);
  onSkip?: null | ((context: ContextOnSkip) => Promise<any> | void);
  onError?: null | ((context: ContextOnError) => Promise<any> | void);
  onCustomAction?:
    | null
    | ((context: ContextOnCustomAction) => Promise<any> | void);
  onView?: null | ((context: ContextOnView) => Promise<any> | void);
  onViewElements?: string[];
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
}

interface InternalProps {
  _internalId: string; // Used to uniquely identify forms when the same form is rendered multiple times
  _isAuthLoading?: boolean; // Flag to show the loader for auth purposes
}

interface ClickActionElement {
  id: string;
  properties: { [key: string]: any };
  repeat?: any;
}

const getViewport = () => {
  return window.innerWidth > mobileBreakpointValue ? 'desktop' : 'mobile';
};
const findSubmitButton = (step: any) =>
  step.buttons.find((b: any) =>
    b.properties.actions.some(
      (action: any) =>
        SUBMITTABLE_ACTIONS.includes(action.type) && action.submit
    )
  );
const isElementAButtonOnStep = (step: any, el: any) =>
  el.id && step.buttons.find((b: any) => b.id === el.id);

function Form({
  _internalId,
  _isAuthLoading = false,
  formName,
  onChange = null,
  onLoad = null,
  onFormComplete = null,
  onSubmit = null,
  onSkip = null,
  onError = null,
  onCustomAction = null,
  onView = null,
  onViewElements = [],
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
  children
}: InternalProps & Props) {
  const [client, setClient] = useState<any>(null);
  const history = useHistory();
  const session = initState.formSessions[formName];

  const [autoValidate, setAutoValidate] = useState(false);
  const [first, setFirst] = useState(true);

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
    formOff: undefined,
    showBrand: false,
    brandPosition: undefined,
    allowEdit: 'yes',
    autoscroll: 'top_of_form'
  });
  const [inlineErrors, setInlineErrors] = useState<
    Record<string, { message: string; index: number }>
  >({});
  const [, setRepeatChanged] = useState(false);

  const [integrations, setIntegrations] = useState<null | Record<string, any>>(
    null
  );
  const flowCompleted = useRef(false);
  const [stepHasRequiredFlow, setStepHasRequiredFlow] = useState(false);
  const [gMapFilled, setGMapFilled] = useState(false);
  const [gMapBlurKey, setGMapBlurKey] = useState('');
  const [gMapTimeoutId, setGMapTimeoutId] = useState<NodeJS.Timeout | number>(
    -1
  );
  const [viewport, setViewport] = useState(getViewport());
  const handleResize = () => setViewport(getViewport());

  const prevAuthId = usePrevious(authState.authId);
  const prevStepKey = usePrevious(stepKey);

  // Set to trigger conditional renders on field value updates, no need to use the value itself
  const [render, setRender] = useState({ v: 1 });

  // When the active step changes, recalculate the dimensions of the new step
  const stepCSS = useMemo(() => calculateStepCSS(activeStep), [activeStep]);

  const visiblePositions = useMemo(
    () => (activeStep ? getVisiblePositions(activeStep) : null),
    [activeStep, render]
  );
  useFirebaseRecaptcha(activeStep, visiblePositions);
  const getNextAuthStep = useFormAuth({
    initialStep: getInitialStep({ initialStepId, steps }),
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
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {}, [viewport]);

  useEffect(() => {
    if (gMapFilled) clearTimeout(gMapTimeoutId);
    else if (gMapBlurKey) {
      // Delay by 0.5 seconds to ensure onChange finishes running first if it needs to
      const timeoutId = setTimeout(
        () =>
          setFormElementError({
            formRef,
            errorCallback: getErrorCallback({
              trigger: {
                id: gMapBlurKey,
                type: 'field'
              }
            }),
            fieldKey: gMapBlurKey,
            message: 'An address must be selected',
            errorType: formSettings.errorType,
            setInlineErrors: setInlineErrors,
            triggerErrors: true
          }),
        500
      );
      setGMapBlurKey('');
      setGMapTimeoutId(timeoutId);
    }
  }, [gMapTimeoutId, gMapFilled, gMapBlurKey]);

  // Logic to run every time step changes
  useEffect(() => {
    if (!activeStep) return;

    setAutoValidate(false); // Each step to initially not auto validate

    if (formSettings.autofocus && focusRef.current) {
      focusRef.current.focus({
        preventScroll: true
      });
      focusRef.current = null;
    }

    setStepHasRequiredFlow(
      activeStep.buttons.some((b: any) =>
        b.properties.actions.some((action: any) =>
          REQUIRED_FLOW_ACTIONS.includes(action.type)
        )
      )
    );
    setGMapFilled(
      activeStep.servar_fields.some(
        (f: any) => f.servar.type === 'gmap_line_1' && fieldValues[f.servar.key]
      )
    );
  }, [activeStep?.id]);

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
      // Some browsers may not have support for scrollTo
      if (window.scrollTo) window.scrollTo({ top, behavior: 'smooth' });
    }
  }, [stepKey]);

  function addRepeatedRow() {
    // Collect a list of all repeated elements
    const repeatedServarFields = activeStep.servar_fields.filter(
      (field: any) => field.servar.repeated
    );

    // Update the values by appending a default value for each field
    const updatedValues = {};
    const fieldIDs: any[] = [];
    const fieldKeys: any[] = [];
    repeatedServarFields.forEach((field: any) => {
      const { servar } = field;
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      updatedValues[servar.key] = [
        // @ts-expect-error TS(2461): Type 'FeatheryFieldTypes' is not an array type.
        ...fieldValues[servar.key],
        getDefaultFieldValue(field)
      ];
      fieldIDs.push(field.id);
      fieldKeys.push(servar.key);
    });

    setRepeatChanged((repeatChanged) => !repeatChanged);
    updateFieldValues(updatedValues);
    return {
      fieldIDs,
      fieldKeys
    };
  }

  function removeRepeatedRow(index: number) {
    if (isNaN(index)) return;

    // Collect a list of all repeated elements
    const repeatedServarFields = activeStep.servar_fields.filter(
      (field: any) => field.servar.repeated
    );

    // Update the values by removing the specified index from each field
    const updatedValues = {};
    const fieldIDs: string[] = [];
    const fieldKeys: string[] = [];
    repeatedServarFields.forEach((field: any) => {
      const { servar } = field;
      const newRepeatedValues = justRemove(fieldValues[servar.key], index);
      const defaultValue = [getDefaultFieldValue(field)];
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      updatedValues[servar.key] =
        newRepeatedValues.length === 0 ? defaultValue : newRepeatedValues;
      fieldIDs.push(field.id);
      fieldKeys.push(servar.key);
    });

    setRepeatChanged((repeatChanged) => !repeatChanged);
    updateFieldValues(updatedValues);
    return { fieldIDs, fieldKeys };
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
      debouncedRerender.cancel();
    };
  }, [debouncedValidate, debouncedRerender]);

  const updateFieldValues = (newFieldValues: any, rerender = true) => {
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

  const runUserCallback = async (
    userCallback: any,
    getProps: () => Record<string, any> = () => ({})
  ) => {
    if (typeof userCallback !== 'function') return;
    try {
      await userCallback({
        ...getFormContext(_internalId),
        ...getProps()
      });
    } catch (e) {
      console.warn(e);
    }
  };

  const getErrorCallback =
    (props1 = {}) =>
    (props2 = {}) =>
      runUserCallback(onError, () => ({
        fields: formatAllFormFields(steps, true),
        ...props1,
        ...props2
      }));

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

    internalState[_internalId] = {
      currentStep: newStep,
      visiblePositions,
      client,
      formName,
      formRef,
      formSettings,
      getErrorCallback,
      history,
      setInlineErrors,
      setUserProgress,
      steps,
      updateFieldOptions
    };

    let stepChanged = false;
    await runUserCallback(onLoad, () => {
      const formattedFields = formatAllFormFields(steps, true);
      const integrationData: IntegrationData = {};
      if (authState.authId) integrationData.firebaseAuthId = authState.authId;

      return {
        fields: formattedFields,
        previousStepName: activeStep?.key,
        lastStep: steps[newKey].next_conditions.length === 0,
        numSteps: Object.keys(steps).length,
        firstStepLoaded: first,
        integrationData,
        // Override setStep fn from the common context props with this one for special bx
        setStep: (stepKey: any) => {
          stepChanged = changeStep(stepKey, newKey, steps, history);
        }
      };
    });
    if (stepChanged) return;

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

  useEffect(() => {
    if (client === null) {
      const clientInstance = new Client(formName, hasRedirected);
      setClient(clientInstance);
      setFirst(true);
      // render form without values first for speed
      const formPromise = clientInstance
        .fetchForm(initialValues, language)
        .then(({ steps, ...res }) => {
          steps = steps.reduce((result: any, step: any) => {
            result[step.key] = step;
            return result;
          }, {});
          setSteps(steps);
          if (res.redirect_url)
            initState.redirectCallbacks[_internalId] = () => {
              window.location.href = res.redirect_url;
            };
          setFormSettings({
            errorType: res.error_type,
            autocomplete: res.autocomplete ? 'on' : 'off',
            autofocus: res.autofocus,
            // @ts-expect-error TS(2322): Type 'boolean' is not assignable to type 'undefine... Remove this comment to see the full error message
            formOff: Boolean(res.formOff),
            allowEdit: res.allow_edit_after_completion,
            showBrand: Boolean(res.show_brand),
            brandPosition: res.brand_position,
            autoscroll: res.autoscroll
          });
          setProductionEnv(res.production);
          return steps;
        });
      // fetch values separately because this request
      // goes to Feathery origin, while the previous
      // request goes to our CDN
      clientInstance
        // @ts-expect-error TS(2345): Argument of type 'Promise<any[]>' is not assignabl... Remove this comment to see the full error message
        .fetchSession(formPromise, true)
        .then(([session, steps]) => {
          updateBackNavMap(session.back_nav_map);
          setIntegrations(session.integrations);
          if (!isObjectEmpty(initialValues)) {
            const servarKeyToTypeMap = getServarTypeMap(steps);
            const castValues = { ...initialValues };
            Object.entries(castValues).map(([key, val]) => {
              castValues[key] = castVal(servarKeyToTypeMap[key], val);
            });
            clientInstance.submitCustom(castValues, false);
          }

          // User is authenticating. auth hook will set the initial stepKey once auth has finished
          if (authState.redirectAfterLogin) return;

          const newKey = getInitialStep({
            initialStepId,
            steps,
            sessionCurrentStep: session.current_step_key
          });
          setUrlStepHash(history, steps, newKey);
          setStepKey(newKey);
        })
        .catch(async (error) => {
          console.warn(error);
          // Go to first step if origin fails
          const [data] = await formPromise;
          const newKey = (getOrigin as any)(data).key;
          history.replace(location.pathname + location.search + `#${newKey}`);
        });
    }
  }, [client, activeStep, setClient, setFirst, setSteps, updateFieldValues]);

  useEffect(() => {
    return history.listen(async () => {
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
    let clearGMaps = false;
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
      value = parseInt(value);
    else if (servar.type === 'gmap_line_1' && !value) clearGMaps = true;
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

    if (clearGMaps) {
      activeStep.servar_fields.forEach((field: any) => {
        const servar = field.servar;
        if (
          ['gmap_line_2', 'gmap_city', 'gmap_state', 'gmap_zip'].includes(
            servar.type
          )
        ) {
          // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          updateValues[servar.key] =
            index === null
              ? ''
              : justInsert(fieldValues[servar.key], '', index);
        }
      });
    }

    const change = updateFieldValues(updateValues, rerender);
    if (repeatRowOperation === 'add') addRepeatedRow();
    return change;
  };

  const getNextStepKey = (metadata: any) =>
    nextStepKey(activeStep.next_conditions, metadata);

  const submitStep = async ({ metadata, repeat = 0 }: any) => {
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
          fieldKey: errorField.key,
          message: errorMessage,
          servarType: errorField.type,
          errorType: formSettings.errorType,
          inlineErrors: newInlineErrors,
          setInlineErrors: setInlineErrors,
          triggerErrors: true
        });
        return;
      }
    }

    // Execute user-provided onSubmit function if present
    if (typeof onSubmit === 'function') {
      let stepChanged = false;
      await runUserCallback(onSubmit, () => ({
        submitFields: formattedFields,
        elementRepeatIndex: repeat,
        fields: formatAllFormFields(steps, true),
        lastStep: !getNextStepKey(metadata),
        setErrors: (
          errors: Record<string, string | { index: number; message: string }>
        ) => {
          Object.entries(errors).forEach(([fieldKey, error]) => {
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
              inlineErrors: newInlineErrors
            });
          });
        },
        setStep: (stepKey: string) => {
          stepChanged = changeStep(stepKey, activeStep.key, steps, history);
        },
        firstStepSubmitted: first,
        integrationData: { authProviderId: authState.authId ?? '' },
        trigger
      }));
      if (stepChanged) return;

      // do validation check in case user has manually invalidated the step
      const invalid = await setFormElementError({
        formRef,
        errorType: formSettings.errorType,
        inlineErrors: newInlineErrors,
        setInlineErrors,
        triggerErrors: true
      });
      if (invalid) return;
    }

    const hiddenPromise = submitStepHiddenFields();
    const featheryFields = Object.entries(formattedFields).map(([key, val]) => {
      let newVal = (val as any).value;
      newVal = Array.isArray(newVal)
        ? newVal.filter((v) => v || v === 0)
        : newVal;
      return { key, [(val as any).type]: newVal };
    });
    const stepPromise =
      featheryFields.length > 0
        ? client.submitStep(featheryFields)
        : Promise.resolve();

    trackEvent('FeatheryStepSubmit', activeStep.key, formName);

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
    return client.submitCustom(hiddenFields);
  };

  // usePayments (Stripe)
  const [getCardElement, setCardElement] = usePayments();

  async function setupStepPaymentMethod(formattedFields: any) {
    for (let i = 0; i < activeStep.servar_fields.length; i++) {
      const servar = activeStep.servar_fields[i].servar;
      if (servar.type === 'payment_method') {
        const integrationData = integrations?.stripe;
        const actionData: ActionData = {
          servar,
          client,
          formattedFields,
          updateFieldValues,
          integrationData,
          targetElement: getCardElement(servar.key)
        };
        const actionResult = await setupPaymentMethod(actionData);
        return actionResult ?? {};
      }
    }
    return {};
  }

  async function collectPaymentAction(triggerElement: any) {
    const errorCallback = getErrorCallback({
      // could be container or button but model as button for the time being...
      trigger: lookUpTrigger(activeStep, triggerElement.id, 'container')
    });
    // validate all step fields and buttons.  Must be valid before payment.
    const { invalid, inlineErrors: newInlineErrors } = validateElements({
      step: activeStep,
      visiblePositions,
      triggerErrors: true,
      errorType: formSettings.errorType,
      formRef,
      errorCallback,
      setInlineErrors
    });
    if (invalid) return false;

    // payment/checkout
    const pm = activeStep.servar_fields.find(
      ({ servar: { type } }: any) => type === 'payment_method'
    );
    const errors = await collectPayment({
      triggerElement,
      triggerElementType: isElementAButtonOnStep(activeStep, triggerElement)
        ? 'button'
        : 'container',
      servar: pm ? pm.servar : null,
      client,
      updateFieldValues,
      integrationData: integrations?.stripe,
      targetElement: pm ? getCardElement(pm.servar.key) : null
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
        setInlineErrors: setInlineErrors,
        triggerErrors: true
      });
      return false;
    }
    return true;
  }

  async function goToNewStep({
    metadata,
    redirectKey = '',
    submitPromise = null,
    submitData = false
  }: any) {
    let eventData: Record<string, any> = {
      step_key: activeStep.key,
      next_step_key: redirectKey,
      event: submitData ? 'complete' : 'skip'
    };

    if (!redirectKey) {
      redirectKey = getNextStepKey(metadata);
      eventData = { ...eventData, next_step_key: redirectKey };
    }

    await callbackRef.current.all();
    const explicitNav =
      submitData || ['button', 'text'].includes(metadata.elementType);
    if (!redirectKey) {
      if (explicitNav) {
        eventData.completed = true;
        session.form_completed = true;
        // Need to rerender when onboarding questions are complete so
        // LoginForm can render children
        rerenderAllForms();
        client.registerEvent(eventData, submitPromise).then(() => {
          setFinished(true);
        });
      }
    } else {
      setFirst(false);
      const nextStep = steps[redirectKey];
      const hasNext = nextStep.buttons.some((b: any) =>
        b.properties.actions.some((action: any) => action.type === ACTION_NEXT)
      );
      const nextStepIsTerminal =
        !hasNext && nextStep.next_conditions.length === 0;
      if (nextStepIsTerminal) {
        const authIntegration = getAuthIntegrationMetadata(integrations);
        eventData.completed = !isTerminalStepAuth(
          authIntegration,
          steps[stepKey].id
        );
      }
      client
        .registerEvent(eventData, submitPromise)
        .then(() => updateBackNavMap({ [redirectKey]: activeStep.key }));
      const newURL = getNewStepUrl(redirectKey);
      setShouldScrollToTop(explicitNav);
      if (explicitNav) history.push(newURL);
      else history.replace(newURL);
    }
  }

  const goToPreviousStep = async () => {
    await callbackRef.current.all();
    const prevStepUrl = getPrevStepUrl(activeStep, backNavMap);
    if (prevStepUrl) history.push(prevStepUrl);
  };

  const setButtonLoader = async (button: any) => {
    const bp = button.properties;
    let loader: any = null;
    if (!bp.loading_icon) loader = <Spinner />;
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
      } else if ([ACTION_STORE_FIELD, ACTION_CUSTOM].includes(action.type)) {
        if (state === null) state = false;
        if (action.type === ACTION_STORE_FIELD) {
          const val = action.custom_store_value;
          // Treat the string 0 as the number 0, which is a bottom value
          const turnOn = val && val !== '0';
          if (turnOn && fieldValues[action.custom_store_field_key] === val)
            state = true;
        } else if (
          action.type === ACTION_CUSTOM &&
          fieldValues[action.select_field_indicator_key]
        )
          state = true;
      }
    }
    return state;
  };

  const buttonOnClick = async (button: ClickActionElement) => {
    const setButtonError = (message: string) =>
      setFormElementError({
        formRef,
        fieldKey: button.id,
        message,
        errorType: formSettings.errorType,
        setInlineErrors: setInlineErrors,
        triggerErrors: true
      });

    await setButtonLoader(button);
    await runElementActions({
      actions: button.properties.actions,
      element: button,
      elementType: 'button',
      setElementError: setButtonError
    });
    clearLoaders();
  };

  const runElementActions = async ({
    actions,
    element,
    elementType,
    setElementError = () => {},
    textSpanStart,
    textSpanEnd
  }: {
    actions: any[];
    element: any;
    elementType: string;
    setElementError?: any;
    textSpanStart?: number | undefined;
    textSpanEnd?: number | undefined;
  }) => {
    const id = element.id ?? '';
    // Prevent same element from being clicked multiple times while still running
    if (id && elementClicks[id]) return;
    elementClicks[id] = true;

    if (shouldValidateStep(actions)) {
      setAutoValidate(true);

      const trigger = lookUpTrigger(activeStep, element.id, elementType);
      // run default form validation
      const { invalid } = validateElements({
        step: activeStep,
        visiblePositions,
        triggerErrors: true,
        errorType: formSettings.errorType,
        formRef,
        errorCallback: getErrorCallback({ trigger }),
        setInlineErrors
      });
      if (invalid) {
        elementClicks[id] = false;
        return;
      }
    }

    // Do not proceed until user has gone through required flows
    if (
      !hasFlowActions(actions) &&
      stepHasRequiredFlow &&
      !flowCompleted.current
    )
      return;

    const flowOnSuccess = (index: number) => async () => {
      flowCompleted.current = true;
      elementClicks[id] = false;
      await runElementActions({
        actions: actions.slice(index + 1),
        element,
        elementType,
        setElementError,
        textSpanStart,
        textSpanEnd
      });
    };

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const type = action.type;

      if (
        [ACTION_ADD_REPEATED_ROW, ACTION_REMOVE_REPEATED_ROW].includes(type)
      ) {
        let data: any;
        if (type === ACTION_ADD_REPEATED_ROW) data = addRepeatedRow();
        else data = removeRepeatedRow(element.repeat);
        if (data && data.fieldKeys.length > 0) {
          fieldOnChange({
            fieldIds: data.fieldIDs,
            fieldKeys: data.fieldKeys,
            elementRepeatIndex: element.repeat
          })();
        }
      } else if (type === ACTION_TRIGGER_PLAID) {
        await openPlaidLink(client, flowOnSuccess(i), updateFieldValues);
        break;
      } else if (type === ACTION_TRIGGER_ARGYLE) {
        await openArgyleLink(
          client,
          flowOnSuccess(i),
          integrations?.argyle,
          updateFieldValues
        );
        break;
      } else if (type === ACTION_URL) {
        const url = action.url;
        action.open_tab ? openTab(url) : (location.href = url);
      } else if (type === ACTION_CUSTOM) {
        if (action.submit)
          await submitStep({
            metadata: {
              elementType,
              elementIDs: [element.id]
            },
            repeat: element.repeat || 0
          });

        await runUserCallback(onCustomAction, () => ({
          trigger: lookUpTrigger(activeStep, element.id, elementType)
        }));
      } else if (type === ACTION_SEND_SMS) {
        const phoneNum = fieldValues[action.auth_target_field_key] as string;
        if (validators.phone(phoneNum)) {
          // Don't block to make potential subsequent navigation snappy
          Auth.sendSms(phoneNum);
        } else {
          setElementError(
            'A valid phone number is needed to send your login code.'
          );
          break;
        }
      } else if (type === ACTION_VERIFY_SMS) {
        const pin = fieldValues[action.auth_target_field_key] as string;
        const params = { fieldVal: pin, featheryClient: client };
        let hasErr = false;
        await Auth.verifySms(params).catch((err: any) => {
          setElementError(err.message);
          hasErr = true;
        });
        if (hasErr) break;
        else authState.redirectAfterLogin = true;
      } else if (type === ACTION_SEND_MAGIC_LINK) {
        const email = fieldValues[action.auth_target_field_key] as string;
        if (validators.email(email)) {
          // Don't block to make potential subsequent navigation snappy
          Auth.sendMagicLink(email);
        } else {
          setElementError('A valid email is needed to send your magic link.');
          break;
        }
      } else if (type === ACTION_OAUTH_LOGIN)
        Auth.oauthRedirect(action.oauth_type);
      else if (type === ACTION_LOGOUT) await Auth.inferAuthLogout();
      else if (type === ACTION_NEXT) {
        const metadata = {
          elementType,
          elementIDs: [element.id],
          start: textSpanStart,
          end: textSpanEnd
        };
        if (action.submit) {
          const submitPromise = await submitStep({
            metadata,
            repeat: element.repeat || 0
          });
          if (submitPromise) {
            await goToNewStep({
              metadata,
              submitPromise: Promise.all(submitPromise),
              submitData: true
            });
          }
        } else {
          let stepChanged = false;
          await runUserCallback(onSkip, () => ({
            setStep: (stepKey: string) => {
              stepChanged = changeStep(stepKey, activeStep.key, steps, history);
            },
            trigger: lookUpTrigger(activeStep, element.id, elementType),
            lastStep: !getNextStepKey(metadata)
          }));
          if (!stepChanged) {
            await goToNewStep({ metadata });
          }
        }
      } else if (type === ACTION_BACK) await goToPreviousStep();
      else if (type === ACTION_COLLECT_PAYMENT) {
        if (!(await collectPaymentAction(element))) break;
      } else if (type === ACTION_STORE_FIELD) {
        const {
          custom_store_field_key: key,
          custom_store_value: value,
          toggle
        } = action;

        // Nested find statements return an item from the outer collection, so
        // short circuit the some statement once the field has been found
        let field: any;
        Object.values(steps).some((step) => {
          field = step.servar_fields.find(
            (field: any) => field.servar.key === key
          );
          if (field) return true;
        });

        const castValue = castVal(field?.servar.type, value);
        const setToDefaultValue =
          toggle &&
          JSON.stringify(fieldValues[key]) === JSON.stringify(castValue);

        const newValues = {
          [key]: setToDefaultValue ? getDefaultFieldValue(field) : castValue
        };
        updateFieldValues(newValues);
        client.submitCustom(newValues);
      }
    }

    elementClicks[id] = false;
  };

  const fieldOnChange =
    ({ fieldIDs, fieldKeys, elementRepeatIndex = 0 }: any) =>
    ({
      trigger = 'field',
      submitData = false,
      integrationData = {},
      // Multi-file upload is not a repeated row but a repeated field
      valueRepeatIndex = null
    } = {}) => {
      if (trigger === 'addressSelect') {
        setGMapFilled(true);
        fieldKeys.forEach((fieldKey: any) => {
          setFormElementError({
            formRef,
            fieldKey,
            message: '',
            errorType: formSettings.errorType,
            setInlineErrors: setInlineErrors,
            triggerErrors: true
          });
        });
      }
      if (typeof onChange === 'function') {
        callbackRef.current.addCallback(
          runUserCallback(onChange, () => ({
            changeKeys: fieldKeys,
            trigger,
            integrationData,
            fields: formatAllFormFields(steps, true),
            lastStep: activeStep.next_conditions.length === 0,
            elementRepeatIndex,
            valueRepeatIndex
          }))
        );
        setShouldScrollToTop(false);
      }
      if (submitData) {
        const submitButton = findSubmitButton(activeStep);
        // Simulate button submit if available and valid to trigger button loader
        if (
          submitButton &&
          getNextStepKey({
            elementType: 'button',
            elementIDs: [submitButton.id]
          })
        ) {
          buttonOnClick(submitButton);
        } else {
          runElementActions({
            actions: [{ type: ACTION_NEXT, submit: true }],
            element: { id: fieldIDs[0] },
            elementType: 'field'
          });
        }
      } else
        goToNewStep({
          metadata: {
            elementType: 'field',
            elementIDs: fieldIDs
          }
        });
    };

  const elementOnView =
    typeof onView === 'function'
      ? (elementId: any, isVisible: any) => {
          callbackRef.current.addCallback(
            runUserCallback(onView, () => ({
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
    setGMapBlurKey,
    elementOnView,
    onViewElements,
    formSettings,
    focusRef,
    formRef,
    steps,
    setCardElement,
    visiblePositions
  };

  let completeState;
  if (formSettings.allowEdit === 'hide') completeState = null;
  else if (formSettings.allowEdit === 'disable')
    completeState = <FormOff noEdit />;

  // If form was completed in a previous session and edits are disabled,
  // consider the form finished
  const anyFinished =
    finished || (session?.form_completed && completeState !== undefined);

  useEffect(() => {
    if (!anyFinished) return;
    const redirectForm = () => {
      history.replace(location.pathname + location.search);
      if (initState.redirectCallbacks[_internalId]) {
        hasRedirected.current = true;
        initState.redirectCallbacks[_internalId]();
      }
    };
    runUserCallback(onFormComplete).then(redirectForm);
  }, [anyFinished]);

  if (formSettings.formOff) {
    // Form is turned off
    return <FormOff />;
  } else if (anyFinished) {
    return completeState ?? null;
  } else if (!activeStep) {
    return stepLoader;
  }

  const addChin =
    formSettings.showBrand && stepCSS.minHeight !== '100%' && !popupOptions;
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
          marginBottom: addChin ? '80px' : '0',
          display: 'flex',
          ...(popupOptions ? { borderRadius: '10px' } : {})
        }}
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
          <DevNavBar allSteps={steps} curStep={activeStep} history={history} />
        )}
        <Watermark
          show={formSettings.showBrand}
          addChin={addChin}
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
