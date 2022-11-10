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
  shouldElementHide
} from '../utils/formHelperFunctions';
import { validators, validateElements } from '../utils/validation';
import {
  initInfo,
  initState,
  fieldValues,
  filePathMap,
  setValues,
  FieldValues
} from '../utils/init';
import { isEmptyArray, justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';
import { sendFirebaseLogin, verifySMSCode } from '../integrations/firebase';
import { googleOauthRedirect, sendMagicLink } from '../integrations/stytch';
import { getPlaidFieldValues, openPlaidLink } from '../integrations/plaid';
import {
  usePayments,
  toggleProductSelection,
  isProductSelected
} from '../integrations/stripe';
import {
  getIntegrationActionConfiguration,
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
  LINK_STRIPE,
  LINK_BACK,
  LINK_NEXT,
  LINK_LOGOUT,
  LINK_VERIFY_SMS
} from '../elements/basic/ButtonElement';
import DevNavBar from './DevNavBar';
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
  usePreviousUserData?: null | boolean;
  elementProps?: ElementProps;
  formProps?: Record<string, any>;
  style?: { [cssProperty: string]: string };
  className?: string;
  children?: JSX.Element;
}

const FieldCounter = {
  value: 0
};

export const fieldCounter = FieldCounter;

const getViewport = () => {
  return window.innerWidth > mobileBreakpointValue ? 'desktop' : 'mobile';
};
const findSubmitButton = (b: any) =>
  b.properties.link === LINK_NEXT && !b.properties.link_no_submit;

function Form({
  // @ts-expect-error TS(2339): Property 'formKey' does not exist on type 'Props'.
  formKey: _formKey,
  formName: _formName,
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
  usePreviousUserData = null,
  elementProps = {},
  formProps = {},
  style = {},
  className = '',
  children
}: Props) {
  const formKey = _formName ?? _formKey;
  const [client, setClient] = useState(null);
  const history = useHistory();

  const [autoValidate, setAutoValidate] = useState(false);
  const [first, setFirst] = useState(true);
  const [firstStep, setFirstStep] = useState(true);
  // If true, will automatically redirect to firstStep if logged back in
  const [firstLoggedOut, setFirstLoggedOut] = useState(false);

  const [productionEnv, setProductionEnv] = useState(true);
  const [steps, setSteps] = useState(null);
  const [rawActiveStep, setRawActiveStep] = useState(null);
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

  const [integrations, setIntegrations] = useState({});
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
      rawActiveStep
        ? (rawActiveStep as any).servar_fields.some(
            (field: any) => field.servar.repeat_trigger
          )
        : false,
    [rawActiveStep]
  );

  // Create the fully-hydrated activeStep by injecting repeated rows
  // Note: Other hydration transformations can also be included here
  const activeStep = useMemo(() => {
    if (!rawActiveStep) return null;
    return JSON.parse(JSON.stringify(rawActiveStep));
  }, [rawActiveStep]);

  const [stepCSS] = useMemo(() => {
    if (!activeStep) return [{}, []];
    return [
      // When the active step changes, recalculate the dimensions of the new step
      calculateStepCSS(activeStep),
      getAllElements(activeStep)
    ];
  }, [activeStep]);

  // All mount and unmount logic should live here
  useEffect(() => {
    initState.renderCallbacks[formKey] = () => {
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

    if (_formKey)
      console.warn(
        "<Form/>'s formKey prop has been deprecated. Use formName instead."
      );

    return () => {
      delete initState.renderCallbacks[formKey];
      delete initState.validateCallbacks[formKey];
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
                type: 'field',
                action: 'blur'
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
          fields: activeStep.servar_fields,
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
      const submitButton = activeStep.buttons.find(findSubmitButton);
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
    const repeatedServarFields = (rawActiveStep as any)?.servar_fields.filter(
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
    // @ts-expect-error TS(2531): Object is possibly 'null'.
    const repeatedServarFields = rawActiveStep.servar_fields.filter(
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
          servars: activeStep.servar_fields,
          triggerErrors: true,
          errorType: formSettings.errorType,
          formRef,
          setInlineErrors
        });
    }, 750),
    [activeStep?.id, formRef, validateElements]
  );
  useEffect(() => {
    return () => {
      debouncedValidate.cancel();
    };
  }, [debouncedValidate]);

  const updateFieldValues = (newFieldValues: any, rerender = true) => {
    const entries = Object.entries(newFieldValues);
    const noChange = entries.every(([key, val]) => fieldValues[key] === val);
    if (noChange) return false;

    const empty = entries.some(([key, val]) => !val || !fieldValues[key]);
    Object.assign(fieldValues, newFieldValues);
    // Always rerender from empty state for display purposes
    if (rerender || empty) setRender((render) => !render);

    // Only validate on each field change if auto validate is enabled due to prev a submit attempt
    if (autoValidate) debouncedValidate(setInlineErrors);

    return true;
  };

  const updateFieldOptions =
    (stepData: any, activeStepData: any) => (newFieldOptions: any) => {
      Object.values(stepData).forEach((step) => {
        (step as any).servar_fields.forEach((field: any) => {
          const servar = field.servar;
          if (servar.key in newFieldOptions) {
            servar.metadata.options = newFieldOptions[servar.key];
          }
        });
      });
      setSteps(JSON.parse(JSON.stringify(stepData)));

      const newActiveStep = activeStepData || rawActiveStep;
      newActiveStep.servar_fields.forEach((field: any) => {
        const servar = field.servar;
        if (servar.key in newFieldOptions) {
          servar.metadata.options = newFieldOptions[servar.key];
        }
      });
      setRawActiveStep(JSON.parse(JSON.stringify(newActiveStep)));
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
        // @ts-expect-error TS(2554): Expected 2 arguments, but got 1.
        setOptions: updateFieldOptions(steps),
        setProgress: (val: any) => setUserProgress(val),
        setStep: (stepKey: any) => {
          changeStep(stepKey, newStep.key, steps, history);
        },
        step: {
          style: {
            // eslint-disable-next-line camelcase
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
    // setRawActiveStep, apparently, must go after setting the callbackRef
    // because it triggers a new render, before this fn finishes execution,
    // which can cause onView to fire before the callbackRef is set
    setRawActiveStep(newStep);
    // @ts-expect-error TS(2531): Object is possibly 'null'.
    client.registerEvent({ step_key: newStep.key, event: 'load' });
  };

  const getNewStep = async (newKey: any) => {
    // @ts-expect-error TS(2531): Object is possibly 'null'.
    let newStep = steps[newKey];
    while (true) {
      let logOut = false;
      const loadCond = newStep.next_conditions.find((cond: any) => {
        if (cond.element_type !== 'step') return false;
        const notAuth =
          cond.rules.find((r: any) => r.comparison === 'not_authenticated') &&
          !initState.authId &&
          // Re: firebaseConfirmationResult, the user hasn't authenticated yet
          // but they're in the process of doing so and we don't want to
          // consider them "unauthenticated" for the purposes of redirecting
          !window.firebaseConfirmationResult;
        const auth =
          cond.rules.find((r: any) => r.comparison === 'authenticated') &&
          initState.authId;
        if (notAuth) logOut = true;
        return notAuth || auth;
      });
      if (loadCond) {
        if (logOut) setFirstLoggedOut(true);
        if (changeStep(loadCond.next_step_key, newKey, steps, history)) {
          clearLoaders(true);
          return;
        }
      } else break;
    }
    newStep = JSON.parse(JSON.stringify(newStep));

    const [curDepth, maxDepth] = recurseProgressDepth(steps, newKey);
    setCurDepth(curDepth);
    setMaxDepth(maxDepth);

    trackEvent('FeatheryStepLoad', newKey, formKey);

    initState.validateCallbacks[formKey] = (trigger: any) => {
      // validate all step fields and buttons
      const { errors } = validateElements({
        elements: [...newStep.servar_fields, ...newStep.buttons],
        servars: newStep.servar_fields,
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
          setStep: (stepKey: any) => {
            stepChanged = changeStep(stepKey, newKey, steps, history);
          },
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
      const clientInstance = new Client(formKey, hasRedirected);
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
          return [steps, res];
        });
      // fetch values separately because this request
      // goes to Feathery origin, while the previous
      // request goes to our CDN
      clientInstance
        // @ts-expect-error TS(2345): Argument of type 'Promise<any[]>' is not assignabl... Remove this comment to see the full error message
        .fetchSession(formPromise, true)
        .then(
          ([
            session,
            [
              steps,
              {
                save_user_location: saveUserLocation,
                save_user_data: saveUserData
              }
            ]
          ]) => {
            updateBackNavMap(session.back_nav_map);
            setIntegrations(session.integrations);
            setFormCompleted(session.form_completed);
            const usePrevious =
              usePreviousUserData === null ? saveUserData : usePreviousUserData;
            if (!usePrevious) {
              // Pass initial values to overwrite values when form history is off
              clientInstance.setDefaultFormValues({
                steps: Object.values(steps),
                additionalValues: initialValues,
                override: true
              });
            }
            if (!isObjectEmpty(initialValues))
              clientInstance.submitCustom(initialValues, false);
            const hashKey = decodeURI(location.hash.substr(1));
            const newKey =
              initialStepId ||
              (hashKey && hashKey in steps && hashKey) ||
              (saveUserLocation && session.current_step_key) ||
              (getOrigin as any)(steps).key;
            setFirstStep(newKey);
            // No hash necessary if form only has one step
            if (Object.keys(steps).length > 1) {
              history.replace(
                location.pathname + location.search + `#${newKey}`
              );
            }
            setStepKey(newKey);
          }
        )
        .catch(async (error) => {
          console.log(error);
          // Go to first step if origin fails
          const [data] = await formPromise;
          const newKey = (getOrigin as any)(data).key;
          setFirstStep(newKey);
          history.replace(location.pathname + location.search + `#${newKey}`);
        });
    }
  }, [client, activeStep, setClient, setFirst, setSteps, updateFieldValues]);

  useEffect(() => {
    return steps
      ? history.listen(async () => {
          let hashKey;
          try {
            hashKey = decodeURI(location.hash.substr(1));
            if (hashKey in steps) setStepKey(hashKey);
          } catch (e) {
            console.log(e);
          }
        })
      : undefined;
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
      if (oldOtherVal) {
        // @ts-expect-error TS(2349): This expression is not callable.
        curFieldVal = curFieldVal.filter((val: any) => val !== oldOtherVal);
      }
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

  const submit = async ({
    metadata,
    repeat = 0,
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
      type: elementType,
      action: metadata.elementType === 'field' ? 'change' : 'click'
    };

    // validate all step fields and buttons
    const { invalidCheckPromise, inlineErrors: newInlineErrors } =
      validateElements({
        elements: [...activeStep.servar_fields, ...activeStep.buttons],
        servars: activeStep.servar_fields,
        triggerErrors: true,
        errorType: formSettings.errorType,
        formRef,
        errorCallback: getErrorCallback(trigger),
        setInlineErrors
      });
    if (await invalidCheckPromise) return;

    const { loggedIn, errorMessage, errorField } = await handleActions(
      setLoader,
      formattedFields,
      elementType
    );
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

      // async execution after user's onSubmit
      return submitAndNavigate({
        metadata,
        formattedFields,
        loggedIn
      });
    } else {
      return submitAndNavigate({
        metadata,
        formattedFields,
        loggedIn
      });
    }
  };

  // usePayments (Stripe)
  const [getCardElement, setCardElement] = usePayments();

  async function handleActions(
    setLoader: any,
    formattedFields: any,
    elementType: string,
    // memoizing actionConfigurations provided no real benefit here because it we need a fresh getCardElement
    actionConfigurations = getIntegrationActionConfiguration(getCardElement)
  ) {
    // Run through all action types for any relevant fields and execute them.
    // Actions have a priority sequence and some actions must be exclusive (don't run any other
    // actions after them).
    for (const actionConfig of actionConfigurations) {
      for (let i = 0; i < activeStep.servar_fields.length; i++) {
        const servar = activeStep.servar_fields[i].servar;
        if (servar.type === actionConfig.servarType) {
          const actionData: ActionData = {
            fieldVal: fieldValues[servar.key],
            servar,
            client,
            formattedFields,
            updateFieldValues,
            step: activeStep,
            // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            integrationData: integrations[actionConfig.integrationKey],
            targetElement:
              actionConfig.targetElementFn &&
              actionConfig.targetElementFn(servar.key)
          };

          if (
            // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
            integrations[actionConfig.integrationKey] &&
            (!actionConfig.isMatch ||
              (actionConfig.isMatch && actionConfig.isMatch(actionData)))
          ) {
            // We only want to run firebase submit logic if it is happening via field auto-submit
            if (
              actionConfig.integrationKey === 'firebase' &&
              elementType !== 'field'
            )
              return;
            setLoader();
            const actionResult = await actionConfig.actionFn(actionData);
            // Return right now if this action is not configured to continue to the next or there was an error
            if (!actionConfig.continue || actionResult !== null) {
              return actionResult ?? {};
            }
          }
        }
      }
    }
    return {};
  }

  function submitAndNavigate({
    metadata,
    formattedFields,
    loggedIn = false
  }: any) {
    let redirectKey = '';
    if (loggedIn && firstLoggedOut && firstStep !== activeStep.key) {
      setFirstLoggedOut(false);
      // @ts-expect-error TS(2322): Type 'boolean' is not assignable to type 'string'.
      redirectKey = firstStep;
    }

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

    trackEvent('FeatheryStepSubmit', activeStep.key, formKey);

    return goToNewStep({
      metadata,
      redirectKey,
      submitPromise,
      submitData: true
    });
  }

  async function goToNewStep({
    metadata,
    redirectKey = '',
    submitPromise = null,
    submitData = false
  }: any) {
    let eventData = {
      step_key: activeStep.key,
      next_step_key: redirectKey,
      event: submitData ? 'complete' : 'skip'
    };

    if (!redirectKey) {
      redirectKey = getNextStepKey(metadata);
      eventData = { ...eventData, next_step_key: redirectKey };
    }

    await callbackRef.current.all();
    if (!redirectKey) {
      if (submitData || ['button', 'text'].includes(metadata.elementType)) {
        (eventData as any).completed = true;
        // @ts-expect-error TS(2531): Object is possibly 'null'.
        client.registerEvent(eventData, submitPromise).then(() => {
          setFinished(true);
        });
        return true;
      }
    } else {
      setFirst(false);
      // @ts-expect-error TS(2531): Object is possibly 'null'.
      if (steps[redirectKey].next_conditions.length === 0)
        (eventData as any).completed = true;
      // @ts-expect-error TS(2531): Object is possibly 'null'.
      client
        .registerEvent(eventData, submitPromise)
        .then(() => updateBackNavMap({ [redirectKey]: activeStep.key }));
      const newURL = getNewStepUrl(redirectKey);
      setShouldScrollToTop(submitData || metadata.elementType === 'text');
      if (submitData || ['button', 'text'].includes(metadata.elementType))
        history.push(newURL);
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

  const buttonOnSubmit = async (button: any, submitData: any) => {
    try {
      const metadata = {
        elementType: 'button',
        elementIDs: [button.id]
      };
      if (submitData) {
        await submit({
          metadata,
          repeat: button.repeat || 0,
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
            type: 'button',
            action: 'click'
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
  const getButtonSelectionState = (button: ClickActionElement) => {
    const link = button.properties?.link;
    if (link === LINK_STRIPE) {
      return isProductSelected({
        productId: button.properties.product_id,
        selectedProductIdField: button.properties.selected_product_id_field_key,
        fieldValues
      });
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
          trigger: 'click',
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

    const authNavAndSubmit = () => {
      if (!button.properties.link_no_nav)
        buttonOnSubmit(button, !button.properties.link_no_submit);
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
          type: 'button',
          action: 'click'
        }
      }));
    } else if (link === LINK_SEND_SMS) {
      const phoneNum = fieldValues[
        button.properties.auth_target_field_key
      ] as string;
      if (validators.phone(phoneNum)) {
        clickPromise = setButtonLoader(button)
          .then(() =>
            sendFirebaseLogin({
              fieldVal: phoneNum,
              servar: null,
              method: 'phone'
            })
          )
          .then(authNavAndSubmit)
          .then(() => clearLoaders());
      } else {
        setError('A valid phone number is needed to send your login code.');
      }
    } else if (link === LINK_VERIFY_SMS) {
      const pin = fieldValues[
        button.properties.auth_target_field_key
      ] as string;

      clickPromise = setButtonLoader(button)
        .then(() =>
          verifySMSCode({ fieldVal: pin, servar: null, method: client })
        )
        .then(authNavAndSubmit)
        .then(() => clearLoaders())
        .catch(() => {
          setError('Your code is not valid.');
        });
    } else if (link === LINK_SEND_MAGIC_LINK) {
      const email = fieldValues[
        button.properties.auth_target_field_key
      ] as string;
      if (validators.email(email)) {
        clickPromise = setButtonLoader(button)
          .then(() => {
            if (isAuthStytch()) return sendMagicLink({ fieldVal: email });
            else
              return sendFirebaseLogin({
                fieldVal: email,
                servar: null,
                method: 'email'
              });
          })
          .then(authNavAndSubmit)
          .then(() => clearLoaders());
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
    } else if (link === LINK_STRIPE) {
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
        const submitButton = activeStep.buttons.find(findSubmitButton);
        // Simulate button submit if available and valid to trigger button loader
        if (
          submitButton &&
          getNextStepKey({
            elementType: 'button',
            elementIDs: [submitButton.id]
          })
        )
          buttonOnSubmit(submitButton, true);
        else submit({ metadata, repeat: elementRepeatIndex });
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
    setCardElement
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
      <ReactForm
        {...formProps}
        autoComplete={formSettings.autocomplete}
        className={className}
        ref={formRef}
        css={{
          ...stepCSS,
          ...style,
          position: 'relative',
          marginBottom: formSettings.showBrand ? '80px' : '0',
          display: 'flex'
        }}
      >
        {children}
        <Grid step={activeStep} form={form} viewport={viewport} />
        {!productionEnv && (
          <DevNavBar allSteps={steps} curStep={activeStep} history={history} />
        )}
        {formSettings.showBrand && (
          <Watermark
            addChin={!isFill(activeStep.height)}
            brandPosition={formSettings.brandPosition}
          />
        )}
      </ReactForm>
    </>
  );
}

export default function FormWithRouter(props: Props): JSX.Element | null {
  // Check client for NextJS support
  return runningInClient() ? (
    /* eslint-disable-next-line @typescript-eslint/ban-ts-comment */
    /* @ts-ignore */
    <BrowserRouter>
      {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
      {/* @ts-ignore */}
      <Route path='/'>
        <Form {...props} />
      </Route>
    </BrowserRouter>
  ) : null;
}
