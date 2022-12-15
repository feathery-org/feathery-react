import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback
} from 'react';

import ReactForm from 'react-bootstrap/Form';
import { useHotkeys } from 'react-hotkeys-hook';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import debounce from 'lodash.debounce';

import { calculateStepCSS, isFill } from '../utils/hydration';
import {
  changeStep,
  FieldOptions,
  formatAllFormFields,
  formatStepFields,
  getAllElements,
  getDefaultFieldValue,
  getFieldValue,
  getNewStepUrl,
  getOrigin,
  getPrevStepUrl,
  lookUpTrigger,
  nextStepKey,
  recurseProgressDepth,
  setFormElementError,
  updateStepFieldOptions
} from '../utils/formHelperFunctions';
import { shouldElementHide, getHideIfReferences } from '../utils/hideIfs';
import { validators, validateElements } from '../utils/validation';
import {
  initInfo,
  initState,
  fieldValues,
  setValues,
  FieldValues
} from '../utils/init';
import { isEmptyArray, justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';
import { sendFirebaseLogin, verifySMSCode } from '../integrations/firebase';
import {
  googleOauthRedirect,
  sendMagicLink,
  sendSMSCode,
  smsLogin
} from '../integrations/stytch';
import { getPlaidFieldValues, openPlaidLink } from '../integrations/plaid';
import {
  usePayments,
  toggleProductSelection,
  isProductSelected,
  setupPaymentMethodAndPay
} from '../integrations/stripe';
import {
  ActionData,
  trackEvent,
  inferAuthLogout,
  isAuthStytch
} from '../integrations/utils';
import {
  LINK_ADD_REPEATED_ROW,
  LINK_CUSTOM,
  LINK_GOOGLE_OAUTH,
  LINK_REMOVE_REPEATED_ROW,
  LINK_SEND_SMS,
  LINK_SEND_MAGIC_LINK,
  LINK_TRIGGER_PLAID,
  LINK_URL,
  LINK_STORE_FIELD,
  LINK_SELECT_PRODUCT,
  LINK_BACK,
  LINK_NEXT,
  LINK_LOGOUT,
  LINK_VERIFY_SMS,
  SUBMITTABLE_LINKS
} from '../elements/basic/ButtonElement';
import DevNavBar from './components/DevNavBar';
import Spinner from '../elements/components/Spinner';
import { isObjectEmpty } from '../utils/primitives';
import CallbackQueue from '../utils/callbackQueue';
import { openTab, runningInClient } from '../utils/browser';
import FormOff from '../elements/components/FormOff';
import Lottie from '../elements/components/Lottie';
import Watermark from '../elements/components/Watermark';
import Grid from './components/grid';
import { mobileBreakpointValue } from '../elements/styles';
import {
  ContextOnChange,
  ContextOnLoad,
  Context,
  ContextOnSubmit,
  ContextOnSkip,
  ContextOnError,
  ContextOnCustomAction,
  ContextOnView,
  ElementProps,
  IntegrationData
} from '../types/Form';
import usePrevious from '../hooks/usePrevious';
import ReactPortal from './components/ReactPortal';
import { replaceTextVariables } from '../elements/components/TextNodes';

export interface Props {
  formName: string;
  onChange?: null | ((context: ContextOnChange) => Promise<any> | void);
  onLoad?: null | ((context: ContextOnLoad) => Promise<any> | void);
  onFormComplete?: null | ((context: Context) => Promise<any> | void);
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
  display?: 'inline' | 'modal';
  elementProps?: ElementProps;
  formProps?: Record<string, any>;
  customComponents?: Record<string, any>;
  style?: { [cssProperty: string]: string };
  className?: string;
  children?: JSX.Element;
}

const getViewport = () => {
  return window.innerWidth > mobileBreakpointValue ? 'desktop' : 'mobile';
};
const findSubmitButton = (step: any) =>
  step.buttons.find(
    (b: any) =>
      !b.properties.link_no_submit &&
      SUBMITTABLE_LINKS.includes(b.properties.link)
  );

function Form({
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
  display = 'inline',
  elementProps = {},
  formProps = {},
  customComponents = {},
  style = {},
  className = '',
  children
}: Props) {
  const [client, setClient] = useState(null);
  const history = useHistory();

  const [autoValidate, setAutoValidate] = useState(false);
  const [first, setFirst] = useState(true);

  const [productionEnv, setProductionEnv] = useState(true);
  const [steps, setSteps] = useState({});
  const [activeStep, setActiveStep] = useState<any>(null);
  const [stepKey, setStepKey] = useState('');
  const [shouldScrollToTop, setShouldScrollToTop] = useState(false);
  const [finished, setFinished] = useState(false);
  const [userProgress, setUserProgress] = useState(null);
  const [formCompleted, setFormCompleted] = useState(false);
  const [curDepth, setCurDepth] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const [formSettings, setFormSettings] = useState({
    redirectUrl: '',
    errorType: 'html5',
    autocomplete: 'on',
    autofocus: true,
    formOff: undefined,
    showBrand: false,
    brandPosition: undefined,
    allowEdit: 'yes'
  });
  const [inlineErrors, setInlineErrors] = useState({});
  const [, setRepeatChanged] = useState(false);

  const [integrations, setIntegrations] = useState<Record<string, any>>({});
  const [plaidLinked, setPlaidLinked] = useState(false);
  const [hasPlaid, setHasPlaid] = useState(false);
  const [gMapFilled, setGMapFilled] = useState(false);
  const [gMapBlurKey, setGMapBlurKey] = useState('');
  const [gMapTimeoutId, setGMapTimeoutId] = useState<NodeJS.Timeout | number>(
    -1
  );
  const [viewport, setViewport] = useState(getViewport());
  const handleResize = () => setViewport(getViewport());

  const prevAuthId = usePrevious(initState.authId);
  const prevStepKey = usePrevious(stepKey);

  // Set to trigger conditional renders on field value updates, no need to use the value itself
  const [render, setRender] = useState(false);

  const [loaders, setLoaders] = useState({});
  const clearLoaders = (clearAuthLoader = false) => {
    if (clearAuthLoader) setLoaders({});
    else
      setLoaders(({ auth }: any) => ({
        auth
      }));
  };
  const stepLoader = useMemo(() => {
    const data = Object.values(loaders).find(
      (l) => (l as any)?.showOn === 'full_page'
    );
    if (!data) return null;
    return (data as any).type === 'default' ? (
      <div style={{ height: '20vh', width: '20vh' }}>
        {(data as any).loader}
      </div>
    ) : (
      (data as any).loader
    );
  }, [loaders]);

  const [backNavMap, setBackNavMap] = useState({});
  const updateBackNavMap = (newNavs: Record<string, string>) =>
    newNavs && setBackNavMap({ ...backNavMap, ...newNavs });

  const formRef = useRef<any>(null);
  // Tracks element to focus
  const focusRef = useRef<any>();
  // Tracks the execution of user-provided callback functions
  const callbackRef = useRef<any>(new CallbackQueue(null, setLoaders));
  // Tracks if the form has redirected
  const hasRedirected = useRef<boolean>(false);
  const buttonClicks = useRef<any>({}).current;

  // Determine if there is a field with a custom repeat_trigger configuration anywhere in the step
  const repeatTriggerExists = useMemo(
    () =>
      activeStep
        ? activeStep.servar_fields.some(
            (field: any) => field.servar.repeat_trigger
          )
        : false,
    [activeStep]
  );

  // When the active step changes, recalculate the dimensions of the new step
  const stepCSS = useMemo(() => calculateStepCSS(activeStep), [activeStep]);

  // All mount and unmount logic should live here
  useEffect(() => {
    initState.renderCallbacks[formName] = () => {
      setRender((render) => !render);
    };

    if (window.location.search.includes('stytch_token_type'))
      setLoaders((loaders) => ({
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

    return () => {
      delete initState.renderCallbacks[formName];
      delete initState.validateCallbacks[formName];
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

  // Logic to run on each step once firebase is loaded
  useEffect(() => {
    if (!activeStep || !global.firebase) return;

    const renderedButtons = activeStep.buttons.filter(
      (element: any) =>
        !shouldElementHide({
          element: element
        })
    );
    const smsButton = renderedButtons.find(
      (b: any) => b.properties.link === LINK_SEND_SMS
    );

    if (smsButton) {
      window.firebaseRecaptchaVerifier =
        new global.firebase.auth.RecaptchaVerifier(smsButton.id, {
          size: 'invisible'
        });
    }
  }, [activeStep?.id, global.firebase]);

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

    setHasPlaid(
      !!activeStep.buttons.find(
        (b: any) => b.properties.link === LINK_TRIGGER_PLAID
      )
    );
    setPlaidLinked(false);
    setGMapFilled(
      activeStep.servar_fields.find(
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

  const scrollToRef = (ref: any) =>
    window.scrollTo({
      top: ref?.current?.offsetTop,
      behavior: 'smooth'
    });
  useEffect(() => {
    if (shouldScrollToTop) {
      scrollToRef(formRef);
    }
  }, [stepKey]);

  useHotkeys(
    'enter',
    (e) => {
      if (!activeStep) return;

      e.preventDefault();
      e.stopPropagation();
      // Submit steps by pressing `Enter`
      const submitButton = findSubmitButton(activeStep);
      if (submitButton) {
        // Simulate button click if available
        buttonOnClick(submitButton);
      }
    },
    {
      enableOnTags: ['INPUT', 'SELECT']
    }
  );

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
      // validate all step fields and buttons
      activeStep &&
        validateElements({
          elements: [...activeStep.servar_fields, ...activeStep.buttons],
          triggerErrors: true,
          errorType: formSettings.errorType,
          formRef,
          setInlineErrors
        });
    }, 750),
    [activeStep?.id, formRef, validateElements]
  );

  // Debouncing the rerender due to changing values of referenced fields in hide if rules.
  // Need to rate limit re-renders here for performance reasons.
  const debouncedRerender = useCallback(
    debounce(() => setRender((render) => !render), 500),
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
    if (rerender || empty) setRender((render) => !render);
    else if (hideIfDependenciesChanged) debouncedRerender();

    // Only validate on each field change if auto validate is enabled due to prev a submit attempt
    if (autoValidate) debouncedValidate(setInlineErrors);

    return true;
  };

  const updateFieldOptions =
    (stepData: any, loadStep = null) =>
    (newOptions: FieldOptions) => {
      Object.values(stepData).forEach((step) =>
        updateStepFieldOptions(step, newOptions)
      );
      setSteps(JSON.parse(JSON.stringify(stepData)));

      const newActiveStep = loadStep || activeStep;
      updateStepFieldOptions(newActiveStep, newOptions);
      setActiveStep(JSON.parse(JSON.stringify(newActiveStep)));
    };

  const runUserCallback = async (
    userCallback: any,
    getProps: () => Record<string, any> = () => ({}),
    newStep = activeStep
  ) => {
    if (typeof userCallback !== 'function') return;
    try {
      await userCallback({
        setValues,
        setOptions: updateFieldOptions(steps),
        setProgress: (val: any) => setUserProgress(val),
        setStep: (stepKey: any) => {
          changeStep(stepKey, newStep.key, steps, history);
        },
        step: {
          style: {
            backgroundColor: newStep?.default_background_color
          }
        },
        userId: initInfo().userId,
        stepName: newStep?.key ?? '',
        ...getProps()
      });
    } catch (e) {
      console.log(e);
    }
  };

  const getErrorCallback = (props1: any) => (props2: any) =>
    runUserCallback(onError, () => ({
      fields: formatAllFormFields(steps, true),
      ...props1,
      ...props2
    }));

  const updateNewStep = (newStep: any) => {
    clearLoaders();
    callbackRef.current = new CallbackQueue(newStep, setLoaders);
    // Hydrate field descriptions
    newStep.servar_fields.forEach((field: any) => {
      field.servar.name = replaceTextVariables(field.servar.name, field.repeat);
    });
    // setActiveStep, apparently, must go after setting the callbackRef
    // because it triggers a new render, before this fn finishes execution,
    // which can cause onView to fire before the callbackRef is set
    setActiveStep(newStep);
    // @ts-expect-error TS(2531): Object is possibly 'null'.
    client.registerEvent({ step_key: newStep.key, event: 'load' });
  };

  const getNewStep = async (newKey: any) => {
    // @ts-expect-error TS(2531): Object is possibly 'null'.
    let newStep = steps[newKey];

    const metadata =
      integrations.stytch?.metadata ?? integrations.firebase?.metadata;
    const authSteps = metadata?.auth_gate_steps ?? [];
    if (authSteps.length > 0) {
      const userAuthed = Boolean(initInfo().authId);
      const nextStepIsProtected = authSteps.includes(newStep.id);
      const findStepName = (stepId: string) => {
        const step: undefined | { key: string } = Object.values(steps).find(
          (step: any) => step.id === stepId
        ) as undefined | { key: string };
        return step?.key;
      };
      let nextStep: undefined | string;

      if (userAuthed && initInfo().redirectAfterLogin) {
        initState.redirectAfterLogin = false;
        nextStep = findStepName(metadata.login_step);
      } else if (!userAuthed && nextStepIsProtected)
        nextStep = findStepName(metadata.logout_step);

      if (
        nextStep !== undefined &&
        changeStep(nextStep, newKey, steps, history)
      ) {
        clearLoaders(true);
        return;
      }
    }
    newStep = JSON.parse(JSON.stringify(newStep));

    const [curDepth, maxDepth] = recurseProgressDepth(steps, newKey);
    setCurDepth(curDepth);
    setMaxDepth(maxDepth);

    trackEvent('FeatheryStepLoad', newKey, formName);

    initState.validateCallbacks[formName] = (trigger: any) => {
      // validate all step fields and buttons
      const { errors } = validateElements({
        elements: [...newStep.servar_fields, ...newStep.buttons],
        triggerErrors: trigger,
        errorType: formSettings.errorType,
        formRef,
        errorCallback: getErrorCallback(trigger),
        setInlineErrors
      });
      return errors;
    };

    let stepChanged = false;
    await runUserCallback(
      onLoad,
      () => {
        const formattedFields = formatAllFormFields(steps, true);
        const integrationData: IntegrationData = {};
        if (initState.authId) {
          integrationData.firebaseAuthId = initState.authId;
        }

        return {
          fields: formattedFields,
          stepName: newStep.key,
          previousStepName: activeStep?.key,
          // @ts-expect-error TS(2531): Object is possibly 'null'.
          lastStep: steps[newKey].next_conditions.length === 0,
          numSteps: Object.keys(steps).length,
          setStep: (stepKey: any) => {
            stepChanged = changeStep(stepKey, newKey, steps, history);
          },
          setOptions: updateFieldOptions(steps, newStep),
          firstStepLoaded: first,
          integrationData
        };
      },
      newStep
    );
    if (stepChanged) return;

    updateNewStep(newStep);
  };

  useEffect(() => {
    if (client === null) {
      const clientInstance = new Client(formName, hasRedirected);
      // @ts-expect-error TS(2345): Argument of type 'Client' is not assignable to par... Remove this comment to see the full error message
      setClient(clientInstance);
      setFirst(true);
      // render form without values first for speed
      const formPromise = clientInstance
        .fetchForm(initialValues)
        .then(({ steps, ...res }) => {
          steps = steps.reduce((result: any, step: any) => {
            result[step.key] = step;
            return result;
          }, {});
          setSteps(steps);
          setFormSettings({
            redirectUrl: res.redirect_url,
            errorType: res.error_type,
            autocomplete: res.autocomplete ? 'on' : 'off',
            autofocus: res.autofocus,
            // @ts-expect-error TS(2322): Type 'boolean' is not assignable to type 'undefine... Remove this comment to see the full error message
            formOff: Boolean(res.formOff),
            allowEdit: res.allow_edit_after_completion,
            showBrand: Boolean(res.show_brand),
            brandPosition: res.brand_position
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
          setFormCompleted(session.form_completed);
          if (!isObjectEmpty(initialValues))
            clientInstance.submitCustom(initialValues, false);
          const hashKey = decodeURI(location.hash.substr(1));
          const newKey =
            initialStepId ||
            (hashKey && hashKey in steps && hashKey) ||
            session.current_step_key ||
            (getOrigin as any)(steps).key;
          // No hash necessary if form only has one step
          if (Object.keys(steps).length > 1) {
            history.replace(location.pathname + location.search + `#${newKey}`);
          }
          setStepKey(newKey);
        })
        .catch(async (error) => {
          console.log(error);
          // Go to first step if origin fails
          const [data] = await formPromise;
          const newKey = (getOrigin as any)(data).key;
          history.replace(location.pathname + location.search + `#${newKey}`);
        });
    }
  }, [client, activeStep, setClient, setFirst, setSteps, updateFieldValues]);

  useEffect(() => {
    return history.listen(async () => {
      let hashKey;
      try {
        hashKey = decodeURI(location.hash.substr(1));
        if (hashKey in steps) setStepKey(hashKey);
      } catch (e) {
        console.log(e);
      }
    });
  }, [steps]);

  useEffect(() => {
    // We set render to re-evaluate auth nav rules - but should only getNewStep if either the step or authId has changed.
    // Should not fetch new step if render was set for another reason
    if (stepKey && (prevStepKey !== stepKey || prevAuthId !== initState.authId))
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

  const handleOtherStateChange = (oldOtherVal: any) => (e: any) => {
    const target = e.target;
    const curOtherVal = target.value;
    let curFieldVal = fieldValues[target.id];
    if (Array.isArray(curFieldVal)) {
      // @ts-expect-error TS(2349): This expression is not callable.
      curFieldVal = curFieldVal.filter(
        (val: any) => val !== oldOtherVal || (!val && !oldOtherVal)
      );
      if (curOtherVal) {
        (curFieldVal as any).push(curOtherVal);
      }
    } else {
      if (curFieldVal === oldOtherVal) curFieldVal = curOtherVal;
    }
    updateFieldValues({ [target.id]: curFieldVal });
  };

  const handleCheckboxGroupChange = (e: any, servarKey: any) => {
    const target = e.target;
    const opt = target.name;
    activeStep.servar_fields.forEach((field: any) => {
      const servar = field.servar;
      if (servar.key !== servarKey) return;

      const fieldValue = getFieldValue(field);
      const { value } = fieldValue;
      const newValue = target.checked
        ? [...value, opt]
        : value.filter((v: any) => v !== opt);
      if (fieldValue.repeated) {
        const { valueList, index } = fieldValue;
        updateFieldValues({
          [servar.key]: justInsert(valueList, newValue, index)
        });
      } else {
        updateFieldValues({ [servar.key]: newValue });
      }
    });
  };

  const getNextStepKey = (metadata: any) =>
    nextStepKey(activeStep.next_conditions, metadata);

  const submitAndNavigate = async ({
    metadata,
    repeat = 0,
    buttonAction,
    plaidSuccess = plaidLinked,
    setLoader = () => {}
  }: any) => {
    // Can't submit step until the user has gone through the Plaid flow if present
    if (hasPlaid && !plaidSuccess) return;

    // start auto validation mode now that a submit has been attempted
    setAutoValidate(true);

    const formattedFields = formatStepFields(activeStep, false);
    const elementType = metadata.elementType;
    const trigger = {
      ...lookUpTrigger(activeStep, metadata.elementIDs[0], elementType),
      type: elementType
    };

    // validate all step fields and buttons
    const { invalid, inlineErrors: newInlineErrors } = validateElements({
      elements: [...activeStep.servar_fields, ...activeStep.buttons],
      triggerErrors: true,
      errorType: formSettings.errorType,
      formRef,
      errorCallback: getErrorCallback(trigger),
      setInlineErrors
    });
    if (invalid) return;

    let errors: { errorMessage?: string; errorField?: any } = {};
    if (buttonAction) errors = buttonAction();
    if (
      activeStep.servar_fields.find(
        ({ servar: { type } }: any) => type === 'payment_method'
      )
    )
      errors = await handleStepSubmissionPayment(setLoader, formattedFields);

    const { errorMessage, errorField } = errors;
    if (errorMessage && errorField) {
      clearLoaders();
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

    // Execute user-provided onSubmit function if present
    if (typeof onSubmit === 'function') {
      const integrationData = {};
      if (initState.authId) {
        (integrationData as any).firebaseAuthId = initState.authId;
      }

      const allFields = formatAllFormFields(steps, true);
      const plaidFieldValues = getPlaidFieldValues(
        (integrations as any).plaid,
        fieldValues
      );
      let stepChanged = false;
      await setLoader();
      await runUserCallback(onSubmit, () => ({
        // @ts-expect-error TS(2698): Spread types may only be created from object types... Remove this comment to see the full error message
        submitFields: { ...formattedFields, ...plaidFieldValues },
        elementRepeatIndex: repeat,
        fields: allFields,
        lastStep: !getNextStepKey(metadata),
        setErrors: (
          errors: Record<string, string | { index: number; message: string }>
        ) => {
          if (!isObjectEmpty(errors)) clearLoaders();
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
        integrationData,
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

    submitStepHiddenFields();
    const featheryFields = Object.entries(formattedFields).map(([key, val]) => {
      let newVal = (val as any).value;
      newVal = Array.isArray(newVal)
        ? newVal.filter((v) => v || v === 0)
        : newVal;
      return {
        key,
        [(val as any).type]: newVal
      };
    });
    let submitPromise = null;
    if (featheryFields.length > 0)
      // @ts-expect-error TS(2531): Object is possibly 'null'.
      submitPromise = client.submitStep(featheryFields);

    trackEvent('FeatheryStepSubmit', activeStep.key, formName);

    return goToNewStep({
      metadata,
      submitPromise,
      submitData: true
    });
  };

  const isStoreFieldValueAction = (el: any) =>
    el.properties?.link === LINK_STORE_FIELD;

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
    // @ts-expect-error TS(2531): Object is possibly 'null'.
    client.submitCustom(hiddenFields);
  };

  // usePayments (Stripe)
  const [getCardElement, setCardElement] = usePayments();

  async function handleStepSubmissionPayment(
    setLoader: any,
    formattedFields: any
  ) {
    for (let i = 0; i < activeStep.servar_fields.length; i++) {
      const servar = activeStep.servar_fields[i].servar;
      if (servar.type === 'payment_method') {
        const integrationData = integrations.stripe;
        const actionData: ActionData = {
          fieldVal: fieldValues[servar.key],
          servar,
          client,
          formattedFields,
          updateFieldValues,
          step: activeStep,
          integrationData,
          targetElement: getCardElement(servar.key)
        };
        setLoader();
        const actionResult = await setupPaymentMethodAndPay(actionData);
        return actionResult ?? {};
      }
    }

    return {};
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
        // @ts-expect-error TS(2531): Object is possibly 'null'.
        client.registerEvent(eventData, submitPromise).then(() => {
          setFinished(true);
        });
        return true;
      }
    } else {
      setFirst(false);
      // @ts-expect-error TS(2531): Object is possibly 'null'.
      const nextStep = steps[redirectKey];
      const hasNext = nextStep.buttons.some(
        (b: any) => b.properties.link === LINK_NEXT
      );
      const terminalStep = !hasNext && nextStep.next_conditions.length === 0;
      if (terminalStep) eventData.completed = true;
      // @ts-expect-error TS(2531): Object is possibly 'null'.
      client
        .registerEvent(eventData, submitPromise)
        .then(() => updateBackNavMap({ [redirectKey]: activeStep.key }));
      const newURL = getNewStepUrl(redirectKey);
      setShouldScrollToTop(explicitNav);
      if (explicitNav) history.push(newURL);
      else history.replace(newURL);
      return true;
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
    setLoaders((loaders) => ({
      ...loaders,
      [button.id]: {
        showOn: bp.show_loading_icon,
        loader,
        type: bp.loading_icon ? bp.loading_file_type : 'default'
      }
    }));
  };

  const buttonOnSubmit = async (
    button: any,
    submitData: boolean,
    buttonAction?: any
  ) => {
    try {
      const metadata = {
        elementType: 'button',
        elementIDs: [button.id]
      };
      if (submitData) {
        await submitAndNavigate({
          metadata,
          repeat: button.repeat || 0,
          buttonAction,
          plaidSuccess: true,
          setLoader: () => setButtonLoader(button),
          clearLoader: () => clearLoaders()
        });
      } else {
        let stepChanged = false;
        await runUserCallback(onSkip, () => ({
          setStep: (stepKey: string) => {
            stepChanged = changeStep(stepKey, activeStep.key, steps, history);
          },
          trigger: {
            ...lookUpTrigger(activeStep, button.id, 'button'),
            type: 'button'
          },
          lastStep: !getNextStepKey(metadata)
        }));
        if (stepChanged) return;
        await goToNewStep({ metadata });
      }
    } catch {
      clearLoaders();
    }
  };

  interface ClickActionElement {
    id: string;
    properties: { [key: string]: any };
    repeat?: any;
  }
  const getButtonSelectionState = (el: ClickActionElement) => {
    const props = el.properties ?? {};
    const link = props.link;
    if (link === LINK_SELECT_PRODUCT) {
      return isProductSelected({
        productId: props.product_id,
        selectedProductIdField: props.selected_product_id_field_key
      });
    } else if (link === LINK_STORE_FIELD) {
      return Boolean(fieldValues[props.custom_store_field_key]);
    } else if (link === LINK_CUSTOM) {
      return fieldValues[props.select_field_indicator_key];
    }
    return false;
  };

  const textOnClick = (
    text: ClickActionElement,
    start: number | undefined,
    end: number | undefined
  ) => {
    const link = text.properties.link;
    if (link === LINK_NEXT)
      goToNewStep({
        metadata: {
          elementType: 'text',
          elementIDs: [text.id],
          start,
          end
        }
      });
    else if (link === LINK_BACK) goToPreviousStep();
  };

  const buttonOnClick = async (button: ClickActionElement) => {
    // Prevent same button from being clicked multiple times while still running
    if (buttonClicks[button.id]) return;
    buttonClicks[button.id] = true;
    let clickPromise = Promise.resolve();

    const authNavAndSubmit = (authFn: any) => {
      if (!button.properties.link_no_nav) {
        // Auth actions always need to validate and submit the current step
        return buttonOnSubmit(button, true, authFn);
      } else {
        return setButtonLoader(button)
          .then(authFn)
          .then(() => clearLoaders());
      }
    };
    const setError = (message: string) =>
      setFormElementError({
        formRef,
        fieldKey: button.id,
        message,
        errorType: formSettings.errorType,
        setInlineErrors: setInlineErrors,
        triggerErrors: true
      });

    const link = button.properties.link;
    if ([LINK_ADD_REPEATED_ROW, LINK_REMOVE_REPEATED_ROW].includes(link)) {
      let data: any;
      if (link === LINK_ADD_REPEATED_ROW) data = addRepeatedRow();
      else data = removeRepeatedRow(button.repeat);
      if (data && data.fieldKeys.length > 0) {
        fieldOnChange({
          fieldIds: data.fieldIDs,
          fieldKeys: data.fieldKeys,
          elementRepeatIndex: button.repeat
        })();
      }
    } else if (link === LINK_TRIGGER_PLAID) {
      if (!plaidLinked) {
        clickPromise = openPlaidLink(
          client,
          async () => {
            setPlaidLinked(true);
            if (activeStep.servar_fields.length === 0)
              await buttonOnSubmit(button, true);
          },
          updateFieldValues,
          () => setButtonLoader(button),
          () => clearLoaders()
        );
      }
    } else if (link === LINK_URL) {
      const url = button.properties.link_url;
      button.properties.link_url_open_tab
        ? openTab(url)
        : (location.href = url);
    } else if (link === LINK_CUSTOM) {
      clickPromise = runUserCallback(onCustomAction, () => ({
        trigger: {
          ...lookUpTrigger(activeStep, button.id, 'button'),
          type: 'button'
        }
      }));
    } else if (link === LINK_SEND_SMS) {
      const phoneNum = fieldValues[
        button.properties.auth_target_field_key
      ] as string;
      if (validators.phone(phoneNum)) {
        const authFn = isAuthStytch()
          ? () => sendSMSCode({ fieldVal: phoneNum })
          : () =>
              sendFirebaseLogin({
                fieldVal: phoneNum,
                servar: null,
                method: 'phone'
              });
        clickPromise = authNavAndSubmit(authFn);
      } else {
        setError('A valid phone number is needed to send your login code.');
      }
    } else if (link === LINK_VERIFY_SMS) {
      const pin = fieldValues[
        button.properties.auth_target_field_key
      ] as string;

      const params = { fieldVal: pin, featheryClient: client };
      const authFn = isAuthStytch()
        ? () => smsLogin(params)
        : () => verifySMSCode(params);
      clickPromise = authNavAndSubmit(authFn).catch(() => {
        setError('Your code is not valid.');
      });
    } else if (link === LINK_SEND_MAGIC_LINK) {
      const email = fieldValues[
        button.properties.auth_target_field_key
      ] as string;
      if (validators.email(email)) {
        const authFn = isAuthStytch()
          ? () => sendMagicLink({ fieldVal: email })
          : () =>
              sendFirebaseLogin({
                fieldVal: email,
                servar: null,
                method: 'email'
              });

        clickPromise = authNavAndSubmit(authFn);
      } else {
        setError('A valid email is needed to send your magic link.');
      }
    } else if (link === LINK_GOOGLE_OAUTH) {
      googleOauthRedirect();
    } else if (link === LINK_LOGOUT) {
      inferAuthLogout();
    } else if (link === LINK_NEXT) {
      clickPromise = buttonOnSubmit(button, !button.properties.link_no_submit);
    } else if (link === LINK_BACK) {
      await goToPreviousStep();
    } else if (link === LINK_SELECT_PRODUCT) {
      await toggleProductSelection({
        productId: button.properties.product_id,
        selectedProductIdFieldId: button.properties.selected_product_id_field,
        selectedProductIdFieldKey:
          button.properties.selected_product_id_field_key,
        fieldValues,
        updateFieldValues,
        client,
        integrations
      });
    } else if (link === LINK_STORE_FIELD) {
      const { custom_store_field_key: key, custom_store_value: value } =
        button.properties;

      // TODO: get default value here for the field and set it instead of ''
      // However, we can link to a field not on this step, in which case we can't lookup the servar in activeStep
      // So either set to false for checkboxes, or '' for other fields
      const defaultValue = value === true ? false : '';

      // Toggle 'off' the value if it has already been set
      const newValue = {
        [key]: fieldValues[key] === value ? defaultValue : value
      };
      updateFieldValues(newValue);
    }

    await clickPromise;
    buttonClicks[button.id] = false;
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
          })),
          loaders
        );
        setShouldScrollToTop(false);
      }
      const metadata = {
        elementType: 'field',
        elementIDs: fieldIDs
      };
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
        } else submitAndNavigate({ metadata, repeat: elementRepeatIndex });
      } else goToNewStep({ metadata });
    };

  const elementOnView =
    typeof onView === 'function'
      ? (elementId: any, isVisible: any) => {
          callbackRef.current.addCallback(
            runUserCallback(onView, () => ({
              visibilityStatus: { elementId, isVisible }
            })),
            loaders
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
    loaders,
    getButtonSelectionState,
    buttonOnClick,
    textOnClick,
    fieldOnChange,
    inlineErrors,
    setInlineErrors,
    repeatTriggerExists,
    changeValue,
    updateFieldValues,
    handleCheckboxGroupChange,
    handleOtherStateChange,
    setGMapBlurKey,
    elementOnView,
    onViewElements,
    formSettings,
    focusRef,
    formRef,
    steps,
    setCardElement,
    onCustomAction: (id: string) =>
      runUserCallback(onCustomAction, () => ({
        trigger: { id, type: 'container' }
      }))
  };

  let completeState;
  if (formSettings.allowEdit === 'hide') completeState = null;
  else if (formSettings.allowEdit === 'disable')
    completeState = <FormOff noEdit />;

  // If form was completed in a previous session and edits are disabled,
  // consider the form finished
  const anyFinished =
    finished || (formCompleted && completeState !== undefined);

  useEffect(() => {
    if (!anyFinished) return;
    const redirectForm = () => {
      history.replace(location.pathname + location.search);
      if (formSettings.redirectUrl) {
        hasRedirected.current = true;
        window.location.href = formSettings.redirectUrl;
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
    // Form has not been loaded yet
    return null;
  }

  const addChin = formSettings.showBrand && !isFill(activeStep.height);
  return (
    <>
      {stepLoader && (
        <div
          style={{
            backgroundColor: `#${activeStep.default_background_color}`,
            position: 'fixed',
            height: '100vh',
            width: '100vw',
            zIndex: 50,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}
        >
          {stepLoader}
        </div>
      )}
      <ReactPortal portal={display === 'modal'}>
        <ReactForm
          {...formProps}
          autoComplete={formSettings.autocomplete}
          className={className}
          ref={formRef}
          css={{
            ...stepCSS,
            ...style,
            position: 'relative',
            marginBottom: addChin ? '80px' : '0',
            display: 'flex'
          }}
        >
          {children}
          <Grid step={activeStep} form={form} viewport={viewport} />
          {!productionEnv && (
            <DevNavBar
              allSteps={steps}
              curStep={activeStep}
              history={history}
            />
          )}
          {formSettings.showBrand && (
            <Watermark
              addChin={addChin}
              brandPosition={formSettings.brandPosition}
            />
          )}
        </ReactForm>
      </ReactPortal>
    </>
  );
}

export default function FormWithRouter({
  formName,
  ...props
}: Props): JSX.Element | null {
  // Check client for NextJS support
  if (formName && runningInClient())
    return (
      /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
      /* @ts-ignore */
      <BrowserRouter>
        {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
        {/* @ts-ignore */}
        <Route path='/'>
          <Form {...props} formName={formName} key={formName} />
        </Route>
      </BrowserRouter>
    );
  else return null;
}
