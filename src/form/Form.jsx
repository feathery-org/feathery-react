import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import ReactForm from 'react-bootstrap/Form';
import TagManager from 'react-gtm-module';
import Lottie from 'lottie-react';
import { useHotkeys } from 'react-hotkeys-hook';

import { calculateStepCSS } from '../utils/hydration';
import {
  changeStep,
  formatAllFormFields,
  formatStepFields,
  getAllElements,
  getDefaultFieldValue,
  getFieldError,
  getFieldValue,
  getNewStepUrl,
  getOrigin,
  lookUpTrigger,
  nextStepKey,
  recurseProgressDepth,
  setFormElementError,
  shouldElementHide
} from '../utils/formHelperFunctions';
import {
  initInfo,
  initState,
  fieldValues,
  filePathMap,
  setValues
} from '../utils/init';
import { isEmptyArray, justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';
import { sendLoginCode, verifySMSCode } from '../integrations/firebase';
import { getPlaidFieldValues, openPlaidLink } from '../integrations/plaid';
import {
  LINK_ADD_REPEATED_ROW,
  LINK_CUSTOM,
  LINK_REMOVE_REPEATED_ROW,
  LINK_SEND_SMS,
  LINK_SKIP,
  LINK_SUBMIT,
  LINK_TRIGGER_PLAID,
  LINK_URL
} from '../elements/basic/ButtonElement';
import DevNavBar from './DevNavBar';
import Spinner from '../elements/components/Spinner';
import { isObjectEmpty } from '../utils/primitives';
import CallbackQueue from '../utils/callbackQueue';
import { openTab } from '../utils/network';
import { runningInClient } from '../utils/browser.js';
import FormOff from '../elements/components/FormOff';
import Watermark from '../elements/components/Watermark';
import Grid from './grid';
import { mobileBreakpointValue } from '../elements/styles';

const FieldCounter = {
  value: 0
};

export const fieldCounter = FieldCounter;

const getViewport = () => {
  return window.innerWidth > mobileBreakpointValue ? 'desktop' : 'mobile';
};

function Form({
  formKey: _formKey,
  formName: _formName,
  onChange = null,
  onLoad = null,
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
  style = {},
  className = '',
  children
}) {
  const formKey = _formName ?? _formKey;
  const [client, setClient] = useState(null);
  const history = useHistory();

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
  const [curDepth, setCurDepth] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const [formSettings, setFormSettings] = useState({
    redirectUrl: '',
    errorType: 'html5',
    autocomplete: 'on'
  });
  const [inlineErrors, setInlineErrors] = useState({});
  const [, setRepeatChanged] = useState(false);

  const [integrations, setIntegrations] = useState({});
  const [plaidLinked, setPlaidLinked] = useState(false);
  const [hasPlaid, setHasPlaid] = useState(false);
  const [gMapFilled, setGMapFilled] = useState(false);
  const [gMapBlurKey, setGMapBlurKey] = useState('');
  const [gMapTimeoutId, setGMapTimeoutId] = useState(-1);
  const [viewport, setViewport] = useState(getViewport());

  const [repeats, setRepeats] = useState(0);

  // Set to trigger conditional renders on field value updates, no need to use
  // eslint-disable-next-line no-unused-vars
  const [render, setRender] = useState(false);

  const [loaders, setLoaders] = useState({});
  const clearLoaders = () => setLoaders({});
  const stepLoader = useMemo(() => {
    const data = Object.values(loaders).find((l) => l?.showOn === 'full_page');
    if (!data) return null;
    return data.type === 'default' ? (
      <div style={{ height: '20vh', width: '20vh' }}>{data.loader}</div>
    ) : (
      data.loader
    );
  }, [loaders]);

  const handleResize = () => {
    setViewport(getViewport());
  };

  const formRef = useRef(null);
  // Tracks element to focus
  const focusRef = useRef();
  // Tracks the execution of user-provided callback functions
  const callbackRef = useRef(new CallbackQueue(null, setLoaders));
  // Tracks if the form has redirected
  const hasRedirected = useRef(false);
  const buttonClicks = useRef({}).current;

  // Determine if there is a field with a custom repeat_trigger configuration anywhere in the step
  const repeatTriggerExists = useMemo(
    () =>
      rawActiveStep
        ? rawActiveStep.servar_fields.some(
            (field) => field.servar.repeat_trigger
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

    const hasLoginField = activeStep.servar_fields.some((field) => {
      const servar = field.servar;
      return (
        servar.type === 'login' &&
        servar.metadata.login_methods.includes('phone')
      );
    });
    const renderedButtons = activeStep.buttons.filter(
      (element) =>
        !shouldElementHide({
          fields: activeStep.servar_fields,
          values: fieldValues,
          element: element
        })
    );
    const submitButton = renderedButtons.find(
      (b) => b.properties.link === LINK_SUBMIT
    );
    if (hasLoginField && submitButton) {
      window.firebaseRecaptchaVerifier = new global.firebase.auth.RecaptchaVerifier(
        submitButton.id,
        { size: 'invisible' }
      );
    } else {
      const smsButton = renderedButtons.find(
        (b) => b.properties.link === LINK_SEND_SMS
      );
      if (smsButton) {
        window.firebaseRecaptchaVerifier = new global.firebase.auth.RecaptchaVerifier(
          smsButton.id,
          { size: 'invisible' }
        );
      }
    }
  }, [activeStep?.id, global.firebase]);

  // Logic to run every time step changes
  useEffect(() => {
    if (!activeStep) return;

    if (focusRef.current) {
      focusRef.current.focus({
        preventScroll: true
      });
      focusRef.current = null;
    }

    setHasPlaid(
      !!activeStep.buttons.find((b) => b.properties.link === LINK_TRIGGER_PLAID)
    );
    setPlaidLinked(false);
    setGMapFilled(
      activeStep.servar_fields.find(
        (f) => f.servar.type === 'gmap_line_1' && fieldValues[f.servar.key]
      )
    );
    callbackRef.current = new CallbackQueue(activeStep, setLoaders);
  }, [activeStep?.id]);

  const scrollToRef = (ref) =>
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
      e.preventDefault();
      e.stopPropagation();
      // Submit steps by pressing `Enter`
      const submitButton = activeStep.buttons.find(
        (b) => b.properties.link === LINK_SUBMIT
      );
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
    // if (isNaN(activeStep.repeat_row_start) || isNaN(activeStep.repeat_row_end))
    //   return;

    // Collect a list of all repeated elements
    const repeatedServarFields = rawActiveStep.servar_fields.filter(
      (field) => field.servar.repeated
    );

    // Update the values by appending a default value for each field
    const updatedValues = {};
    const fieldIDs = [];
    const fieldKeys = [];
    repeatedServarFields.forEach((field) => {
      const { servar } = field;
      updatedValues[servar.key] = [
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

  function removeRepeatedRow(index) {
    if (isNaN(index)) return;

    // Collect a list of all repeated elements
    const repeatedServarFields = rawActiveStep.servar_fields.filter(
      (field) => field.servar.repeated
    );

    // Update the values by removing the specified index from each field
    const updatedValues = {};
    const fieldIDs = [];
    const fieldKeys = [];
    repeatedServarFields.forEach((field) => {
      const { servar } = field;
      const newRepeatedValues = justRemove(fieldValues[servar.key], index);
      const defaultValue = [getDefaultFieldValue(field)];
      updatedValues[servar.key] =
        newRepeatedValues.length === 0 ? defaultValue : newRepeatedValues;
      fieldIDs.push(field.id);
      fieldKeys.push(servar.key);
    });

    setRepeatChanged((repeatChanged) => !repeatChanged);
    updateFieldValues(updatedValues);
    return { fieldIDs, fieldKeys };
  }

  // Update the map we maintain to track files that have already been uploaded to S3
  // This means nulling the existing mapping because the user uploaded a new file
  function clearFilePathMapEntry(key, index = null) {
    if (index !== null) {
      if (!filePathMap[key]) filePathMap[key] = [];
      filePathMap[key][index] = null;
    } else {
      filePathMap[key] = null;
    }
  }

  const updateFieldValues = (newFieldValues, rerender = true) => {
    const entries = Object.entries(newFieldValues);
    const noChange = entries.every(([key, val]) => fieldValues[key] === val);
    if (noChange) return false;

    const empty = entries.some(([key, val]) => !val || !fieldValues[key]);
    Object.assign(fieldValues, newFieldValues);
    // Always rerender from empty state for display purposes
    if (rerender || empty) setRender((render) => !render);
    return true;
  };

  const updateFieldOptions = (stepData, activeStepData) => (
    newFieldOptions
  ) => {
    Object.values(stepData).forEach((step) => {
      step.servar_fields.forEach((field) => {
        const servar = field.servar;
        if (servar.key in newFieldOptions) {
          servar.metadata.options = newFieldOptions[servar.key];
        }
      });
    });
    setSteps(JSON.parse(JSON.stringify(stepData)));

    const newActiveStep = activeStepData || rawActiveStep;
    newActiveStep.servar_fields.forEach((field) => {
      const servar = field.servar;
      if (servar.key in newFieldOptions) {
        servar.metadata.options = newFieldOptions[servar.key];
      }
    });
    setRawActiveStep(JSON.parse(JSON.stringify(newActiveStep)));
  };

  const runUserCallback = async (
    userCallback,
    callbackProps,
    newStep = activeStep
  ) => {
    try {
      await userCallback({
        setValues,
        setOptions: updateFieldOptions(steps),
        setProgress: (val) => setUserProgress(val),
        setStep: (stepKey) => {
          changeStep(stepKey, newStep.key, steps, history);
        },
        step: {
          style: {
            // eslint-disable-next-line camelcase
            backgroundColor: newStep?.default_background_color
          }
        },
        userId: initInfo().userKey,
        stepName: newStep?.key ?? '',
        ...callbackProps
      });
    } catch (e) {
      console.log(e);
    }
  };

  const getErrorCallback = (props1) => async (props2) => {
    if (typeof onError === 'function') {
      const formattedFields = formatAllFormFields(steps, true);
      await runUserCallback(onError, {
        fields: formattedFields,
        ...props1,
        ...props2
      });
    }
  };

  const updateNewStep = (newStep) => {
    clearLoaders();
    setRawActiveStep(newStep);
    client.registerEvent({ step_key: newStep.key, event: 'load' });
  };

  const getNewStep = async (newKey) => {
    let newStep = steps[newKey];
    while (true) {
      let logOut = false;
      const loadCond = newStep.next_conditions.find((cond) => {
        if (cond.trigger !== 'load' || cond.element_type !== 'step')
          return false;
        const notAuth =
          cond.rules.find((r) => r.comparison === 'not_authenticated') &&
          !initState.authId &&
          !window.firebaseConfirmationResult;
        const auth =
          cond.rules.find((r) => r.comparison === 'authenticated') &&
          initState.authId;
        if (notAuth) logOut = true;
        return notAuth || auth;
      });
      if (loadCond) {
        if (logOut) setFirstLoggedOut(true);
        if (changeStep(loadCond.next_step_key, newKey, steps, history)) return;
      } else break;
    }
    newStep = JSON.parse(JSON.stringify(newStep));

    const [curDepth, maxDepth] = recurseProgressDepth(steps, newKey);
    setCurDepth(curDepth);
    setMaxDepth(maxDepth);

    if (TagManager.initialized) {
      TagManager.dataLayer({
        dataLayer: {
          stepId: newKey,
          formId: client.formKey,
          event: 'FeatheryStepLoad'
        }
      });
    }

    initState.validateCallbacks[formKey] = (trigger) => {
      const inlineErrors = {};
      const errors = newStep.servar_fields
        // Skip validation on hidden elements
        .filter(
          (field) =>
            !shouldElementHide({
              fields: newStep.servar_fields,
              values: fieldValues,
              element: field
            })
        )
        .reduce((errors, field) => {
          const servar = field.servar;
          const message = getFieldError(fieldValues[servar.key], servar);
          errors[servar.key] = message;
          if (trigger) {
            setFormElementError({
              formRef,
              errorCallback: getErrorCallback({ trigger }),
              fieldKey: servar.key,
              message,
              errorType: formSettings.errorType,
              servarType: servar.type,
              inlineErrors
            });
          }
          return errors;
        }, {});
      if (trigger) {
        setFormElementError({
          formRef,
          errorType: formSettings.errorType,
          inlineErrors,
          setInlineErrors,
          triggerErrors: true
        });
      }
      return errors;
    };

    if (typeof onLoad === 'function') {
      const formattedFields = formatAllFormFields(steps, true);

      const integrationData = {};
      if (initState.authId) {
        integrationData.firebaseAuthId = initState.authId;
      }
      let stepChanged = false;
      await runUserCallback(
        onLoad,
        {
          fields: formattedFields,
          stepName: newStep.key,
          previousStepName: activeStep?.key,
          lastStep: steps[newKey].next_conditions.length === 0,
          setStep: (stepKey) => {
            stepChanged = changeStep(stepKey, newKey, steps, history);
          },
          firstStepLoaded: first,
          integrationData
        },
        newStep
      );
      if (stepChanged) return;
      updateNewStep(newStep);
    } else {
      updateNewStep(newStep);
    }
  };

  useEffect(() => {
    if (client === null) {
      const clientInstance = new Client(formKey, hasRedirected);
      setClient(clientInstance);
      setFirst(true);

      // render form without values first for speed
      const formPromise = clientInstance
        .fetchForm(initialValues)
        .then(([steps, res]) => {
          steps = steps.reduce((result, step) => {
            result[step.key] = step;
            return result;
          }, {});
          setSteps(steps);
          setFormSettings({
            redirectUrl: res.redirect_url,
            errorType: res.error_type,
            autocomplete: res.autocomplete ? 'on' : 'off',
            formOff: Boolean(res.formOff),
            showBrand: Boolean(res.show_brand)
          });
          setProductionEnv(res.production);
          return [steps, res];
        });

      // fetch values separately because this request
      // goes to Feathery origin, while the previous
      // request goes to our CDN
      clientInstance
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
            setIntegrations(session.integrations);
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
              clientInstance.submitCustom(initialValues);
            const hashKey = decodeURI(location.hash.substr(1));
            const newKey =
              initialStepId ||
              (hashKey && hashKey in steps && hashKey) ||
              (saveUserLocation && session.current_step_key) ||
              getOrigin(steps).key;
            setFirstStep(newKey);
            history.replace(location.pathname + location.search + `#${newKey}`);
          }
        )
        .catch(async (error) => {
          console.log(error);
          // Go to first step if origin fails
          const [data] = await formPromise;
          const newKey = getOrigin(data).key;
          setFirstStep(newKey);
          history.replace(location.pathname + location.search + `#${newKey}`);
        });
    }
  }, [client, activeStep, setClient, setFirst, setSteps, updateFieldValues]);

  useEffect(() => {
    return steps
      ? history.listen(async () => {
          const hashKey = decodeURI(location.hash.substr(1));
          if (hashKey in steps) setStepKey(hashKey);
        })
      : undefined;
  }, [steps]);

  useEffect(() => {
    if (stepKey) getNewStep(stepKey);
  }, [stepKey]);

  if (!activeStep) {
    if (formSettings.formOff) return <FormOff />;
    else return null;
  }
  if (finished) {
    if (formSettings.redirectUrl) {
      hasRedirected.current = true;
      window.location.href = formSettings.redirectUrl;
    }
    return null;
  }

  // Note: If index is provided, handleChange assumes the field is a repeated field
  const changeValue = (value, field, index = null, rerender = true) => {
    const updateValues = {};
    let clearGMaps = false;
    let repeatRowOperation;

    const servar = field.servar;
    if (servar.repeat_trigger === 'set_value') {
      const defaultValue = getDefaultFieldValue(field);
      const { value: previousValue, valueList } = getFieldValue(
        field,
        fieldValues
      );

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

    updateValues[servar.key] =
      index === null
        ? value
        : justInsert(fieldValues[servar.key] || [], value, index);

    if (clearGMaps) {
      activeStep.servar_fields.forEach((field) => {
        const servar = field.servar;
        if (
          ['gmap_line_2', 'gmap_city', 'gmap_state', 'gmap_zip'].includes(
            servar.type
          )
        ) {
          updateValues[servar.key] =
            index === null
              ? ''
              : justInsert(fieldValues[servar.key], '', index);
        }
      });
    }

    const change = updateFieldValues(updateValues, rerender);
    if (repeatRowOperation === 'add') {
      setRepeats(repeats + 1);
      addRepeatedRow();
    }
    return change;
  };

  const handleOtherStateChange = (oldOtherVal) => (e) => {
    const target = e.target;
    const curOtherVal = target.value;
    let curFieldVal = fieldValues[target.id];
    if (Array.isArray(curFieldVal)) {
      if (oldOtherVal) {
        curFieldVal = curFieldVal.filter((val) => val !== oldOtherVal);
      }
      if (curOtherVal) {
        curFieldVal.push(curOtherVal);
      }
    } else {
      if (curFieldVal === oldOtherVal) curFieldVal = curOtherVal;
    }
    updateFieldValues({ [target.id]: curFieldVal });
  };

  const handleCheckboxGroupChange = (e, servarKey) => {
    const target = e.target;
    const opt = target.name;
    activeStep.servar_fields.forEach((field) => {
      const servar = field.servar;
      if (servar.key !== servarKey) return;

      const fieldValue = getFieldValue(field, fieldValues);
      const { value } = fieldValue;
      const newValue = target.checked
        ? [...value, opt]
        : value.filter((v) => v !== opt);
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

  const submit = async ({
    metadata,
    repeat = 0,
    plaidSuccess = plaidLinked,
    setLoader = () => {}
  }) => {
    // Can't submit step until the user has gone through the Plaid flow if present
    if (hasPlaid && !plaidSuccess) return;

    const servarMap = {};
    activeStep.servar_fields.forEach(
      (field) => (servarMap[field.servar.key] = field)
    );
    const formattedFields = formatStepFields(activeStep, false);
    const elementType = metadata.elementType;
    const trigger = {
      ...lookUpTrigger(activeStep, metadata.elementIDs[0], elementType),
      type: elementType,
      action: metadata.trigger
    };

    const newInlineErrors = {};
    Object.entries(formattedFields).map(async ([fieldKey, { value }]) => {
      const field = servarMap[fieldKey];
      // Skip validation on hidden elements
      if (
        shouldElementHide({
          fields: activeStep.servar_fields,
          values: fieldValues,
          element: field
        })
      )
        return;
      const message = getFieldError(value, field.servar);
      await setFormElementError({
        formRef,
        errorCallback: getErrorCallback({ trigger }),
        fieldKey,
        message,
        errorType: formSettings.errorType,
        servarType: field.servar.type,
        inlineErrors: newInlineErrors
      });
    });
    // do validation check before running user submission function
    // so user does not access invalid data
    const invalid = await setFormElementError({
      formRef,
      errorType: formSettings.errorType,
      inlineErrors: newInlineErrors,
      setInlineErrors,
      triggerErrors: true
    });
    if (invalid) return;

    const { loggedIn, errorMessage, errorField } = await handleActions(
      setLoader
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
        integrationData.firebaseAuthId = initState.authId;
      }

      const allFields = formatAllFormFields(steps, true);
      const plaidFieldValues = getPlaidFieldValues(
        integrations.plaid,
        fieldValues
      );
      const lastStep = !nextStepKey(
        activeStep.next_conditions,
        metadata,
        fieldValues
      );
      let stepChanged = false;
      await setLoader();
      await runUserCallback(onSubmit, {
        submitFields: { ...formattedFields, ...plaidFieldValues },
        elementRepeatIndex: repeat,
        fields: allFields,
        lastStep,
        setErrors: (errors) => {
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
        setStep: (stepKey) => {
          stepChanged = changeStep(stepKey, activeStep.key, steps, history);
        },
        firstStepSubmitted: first,
        integrationData,
        trigger
      });
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
      return await handleSubmitRedirect({
        metadata,
        formattedFields,
        loggedIn
      });
    } else {
      return await handleSubmitRedirect({
        metadata,
        formattedFields,
        loggedIn
      });
    }
  };

  async function handleActions(setLoader) {
    for (let i = 0; i < activeStep.servar_fields.length; i++) {
      const servar = activeStep.servar_fields[i].servar;
      const fieldVal = fieldValues[servar.key];
      if (servar.type === 'login') {
        setLoader();
        return await sendLoginCode(fieldVal, servar);
      } else if (
        servar.type === 'pin_input' &&
        servar.metadata.verify_sms_code
      ) {
        setLoader();
        return await verifySMSCode(fieldVal, servar, client);
      }
    }
    return {};
  }

  function handleSubmitRedirect({
    metadata,
    formattedFields,
    loggedIn = false
  }) {
    let redirectKey = '';
    if (loggedIn && firstLoggedOut && firstStep !== activeStep.key) {
      setFirstLoggedOut(false);
      redirectKey = firstStep;
    }

    const featheryFields = Object.entries(formattedFields).map(([key, val]) => {
      let newVal = val.value;
      newVal = Array.isArray(newVal)
        ? newVal.filter((v) => v || v === 0)
        : newVal;
      return {
        key,
        [val.type]: newVal
      };
    });
    let submitPromise = null;
    if (featheryFields.length > 0)
      submitPromise = client.submitStep(featheryFields);
    if (TagManager.initialized) {
      TagManager.dataLayer({
        dataLayer: {
          stepId: activeStep.key,
          formId: client.formKey,
          event: 'FeatheryStepSubmit'
        }
      });
    }

    return handleRedirect({
      metadata,
      redirectKey,
      submitPromise,
      submitData: true
    });
  }

  async function handleRedirect({
    metadata,
    redirectKey = '',
    submitPromise = null,
    submitData = false
  }) {
    let eventData = {
      step_key: activeStep.key,
      next_step_key: redirectKey,
      event: submitData ? 'complete' : 'skip'
    };

    if (!redirectKey) {
      const newStepKey = nextStepKey(
        activeStep.next_conditions,
        metadata,
        fieldValues
      );

      redirectKey = newStepKey;
      eventData = { ...eventData, next_step_key: newStepKey };
    }

    await callbackRef.current.all();
    if (!redirectKey) {
      if (submitData || ['button', 'text'].includes(metadata.elementType)) {
        eventData.completed = true;
        client
          .registerEvent(eventData, submitPromise)
          .then(() => setFinished(true));
        return true;
      }
    } else {
      setFirst(false);
      if (steps[redirectKey].next_conditions.length === 0)
        eventData.completed = true;
      client.registerEvent(eventData, submitPromise);
      const newURL = getNewStepUrl(redirectKey);
      if (
        submitData ||
        (metadata.elementType === 'text' && metadata.trigger === 'click')
      )
        setShouldScrollToTop(true);
      else setShouldScrollToTop(false);
      if (submitData || ['button', 'text'].includes(metadata.elementType))
        history.push(newURL);
      else history.replace(newURL);
      return true;
    }
  }

  const setButtonLoader = async (button) => {
    const bp = button.properties;
    let loader = null;
    if (!bp.loading_icon) loader = <Spinner />;
    else if (bp.loading_icon_type === 'image/*') {
      loader = <img src={bp.loading_icon} alt='Button Loader' />;
    } else if (bp.loading_icon_type === 'application/json') {
      const animationData = await fetch(bp.loading_icon).then((response) =>
        response.json()
      );
      loader = <Lottie animationData={animationData} loop autoplay />;
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

  const buttonOnSubmit = async (submitData, button) => {
    try {
      const metadata = {
        elementType: 'button',
        elementIDs: [button.id],
        trigger: 'click'
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
        if (typeof onSkip === 'function') {
          let stepChanged = false;
          await runUserCallback(onSkip, {
            setStep: (stepKey) => {
              stepChanged = changeStep(stepKey, activeStep.key, steps, history);
            },
            trigger: {
              ...lookUpTrigger(activeStep, button.id, 'button'),
              type: 'button',
              action: 'click'
            }
          });
          if (stepChanged) return;
        }
        await handleRedirect({ metadata });
      }
    } catch {
      clearLoaders();
    }
  };

  const buttonOnClick = async (button) => {
    // Prevent same button from being clicked multiple times while still running
    if (buttonClicks[button.id]) return;
    buttonClicks[button.id] = true;
    let clickPromise = Promise.resolve();

    const link = button.properties.link;
    if ([LINK_ADD_REPEATED_ROW, LINK_REMOVE_REPEATED_ROW].includes(link)) {
      let data;
      if (link === LINK_ADD_REPEATED_ROW) data = addRepeatedRow();
      else if (link === LINK_REMOVE_REPEATED_ROW) {
        data = removeRepeatedRow(button.repeat);
      }
      if (data.fieldKeys.length > 0) {
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
              await buttonOnSubmit(true, button);
          },
          updateFieldValues,
          () => setButtonLoader(button),
          () => clearLoaders()
        );
      }
    } else if (link === LINK_URL) {
      openTab(button.properties.link_url);
    } else if (link === LINK_CUSTOM) {
      if (typeof onCustomAction === 'function') {
        await runUserCallback(onCustomAction, {
          trigger: {
            ...lookUpTrigger(activeStep, button.id, 'button'),
            type: 'button',
            action: 'click'
          }
        });
      }
    } else if (link === LINK_SEND_SMS) {
      clickPromise = setButtonLoader(button)
        .then(
          async () =>
            await sendLoginCode(
              fieldValues[button.properties.sms_code_field_key],
              null,
              ['phone']
            )
        )
        .then(() => clearLoaders());
    } else if ([LINK_SUBMIT, LINK_SKIP].includes(link)) {
      clickPromise = buttonOnSubmit(link === LINK_SUBMIT, button);
    }
    await clickPromise;
    buttonClicks[button.id] = false;
  };

  const fieldOnChange = ({ fieldIDs, fieldKeys, elementRepeatIndex = 0 }) => ({
    trigger = 'field',
    submitData = false,
    // Multi-file upload is not a repeated row but a repeated field
    valueRepeatIndex = null
  } = {}) => {
    if (trigger === 'googleMaps') {
      setGMapFilled(true);
      fieldKeys.forEach((fieldKey) => {
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
      const formattedFields = formatAllFormFields(steps, true);
      callbackRef.current.addCallback(
        runUserCallback(onChange, {
          changeKeys: fieldKeys,
          trigger,
          integrationData: {},
          fields: formattedFields,
          lastStep: activeStep.next_conditions.length === 0,
          elementRepeatIndex,
          valueRepeatIndex
        }),
        loaders
      );
      setShouldScrollToTop(false);
    }
    const metadata = {
      elementType: 'field',
      elementIDs: fieldIDs,
      trigger: 'change'
    };
    if (submitData) {
      // Simulate button click if available
      const submitButton = activeStep.buttons.find(
        (b) => b.properties.link === LINK_SUBMIT
      );
      if (submitButton) buttonOnClick(submitButton);
      else submit({ metadata, repeat: elementRepeatIndex });
    } else handleRedirect({ metadata });
  };

  const elementOnView =
    typeof onView === 'function'
      ? (elementId, isVisible) => {
          callbackRef.current.addCallback(
            runUserCallback(onView, {
              visibilityStatus: { elementId, isVisible }
            }),
            loaders
          );
        }
      : undefined;

  const form = {
    userProgress,
    curDepth,
    maxDepth,
    elementProps,
    fieldValues,
    handleRedirect,
    activeStep,
    loaders,
    buttonOnClick,
    submit,
    fieldOnChange,
    inlineErrors,
    repeatTriggerExists,
    changeValue,
    updateFieldValues,
    handleCheckboxGroupChange,
    handleOtherStateChange,
    setGMapBlurKey,
    elementOnView,
    onViewElements,
    formSettings,
    clearFilePathMapEntry,
    focusRef,
    steps
  };

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
        <Grid
          step={activeStep}
          form={form}
          values={fieldValues}
          viewport={viewport}
        />
        {!productionEnv && (
          <DevNavBar allSteps={steps} curStep={activeStep} history={history} />
        )}
        {formSettings.showBrand && (
          <div
            css={{
              position: 'absolute',
              bottom: -60,
              right: 40,
              pointerEvents: 'none'
            }}
          >
            <Watermark />
          </div>
        )}
      </ReactForm>
    </>
  );
}

export default function FormWithRouter(props) {
  return (
    <>
      {runningInClient() /* NextJS support */ ? (
        <BrowserRouter>
          <Route path='/'>
            <Form {...props} />
          </Route>
        </BrowserRouter>
      ) : null}
    </>
  );
}
