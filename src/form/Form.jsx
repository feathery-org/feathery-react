import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import WebFont from 'webfontloader';
import ReactForm from 'react-bootstrap/Form';
import TagManager from 'react-gtm-module';
import Lottie from 'lottie-react';
import { useHotkeys } from 'react-hotkeys-hook';

import {
  calculateRepeatedRowCount,
  calculateStepCSS,
  injectRepeatedRows
} from '../utils/hydration';
import {
  changeStep,
  formatAllStepFields,
  formatStepFields,
  getAllElements,
  getDefaultFieldValue,
  getFieldError,
  getFieldValue,
  getInlineError,
  getNewStepUrl,
  getOrigin,
  isFieldActuallyRequired,
  lookUpTrigger,
  nextStepKey,
  reactFriendlyKey,
  recurseProgressDepth,
  setFormElementError,
  shouldElementHide,
  textFieldShouldSubmit
} from '../utils/formHelperFunctions';
import {
  initInfo,
  initState,
  initializeIntegrations,
  fieldValues,
  filePathMap,
  setValues
} from '../utils/init';
import { justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';
import { stringifyWithNull } from '../utils/string';
import Elements from '../elements';
import GooglePlaces from './GooglePlaces';
import { sendLoginCode, verifySMSCode } from '../integrations/firebase';
import { getPlaidFieldValues, openPlaidLink } from '../integrations/plaid';
import {
  LINK_ADD_REPEATED_ROW,
  LINK_CUSTOM,
  LINK_REMOVE_REPEATED_ROW,
  LINK_SEND_SMS,
  LINK_SKIP,
  LINK_SUBMIT,
  LINK_TRIGGER_PLAID
} from '../elements/basic/ButtonElement';
import DevNavBar from './DevNavBar';
import Spinner from '../elements/components/Spinner';
import { isObjectEmpty } from '../utils/primitives';
import CallbackQueue from '../utils/callbackQueue';
import { dataURLToFile, isBase64PNG, toBase64 } from '../utils/image';

function Form({
  formKey,
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
  const [shouldScrollToTop, setShouldScrollToTop] = useState(true);
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
  const [repeatChanged, setRepeatChanged] = useState(false);

  const [integrations, setIntegrations] = useState({});
  const [plaidLinked, setPlaidLinked] = useState(false);
  const [hasPlaid, setHasPlaid] = useState(false);
  const [gMapFilled, setGMapFilled] = useState(false);
  const [gMapBlurKey, setGMapBlurKey] = useState('');
  const [gMapTimeoutId, setGMapTimeoutId] = useState(-1);

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

  const formRef = useRef(null);
  const signatureRef = useRef({}).current;
  const callbackRef = useRef(new CallbackQueue(null, setLoaders));
  const hasRedirected = useRef(false);

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

  // Calculate how many repeated rows there are given the current field values
  const repeatedRowCount = useMemo(
    () =>
      rawActiveStep
        ? calculateRepeatedRowCount({
            step: rawActiveStep,
            values: fieldValues
          })
        : null,
    [rawActiveStep, repeatChanged]
  );

  // Create the fully-hydrated activeStep by injecting repeated rows
  // Note: Other hydration transformations can also be included here
  const activeStep = useMemo(() => {
    if (!rawActiveStep) return null;
    return JSON.parse(
      JSON.stringify(
        injectRepeatedRows({
          step: rawActiveStep,
          repeatedRowCount
        })
      )
    );
  }, [rawActiveStep, repeatedRowCount]);

  const [stepCSS, allElements] = useMemo(() => {
    if (!activeStep) return [{}, []];
    return [
      // When the active step changes, recalculate the dimensions of the new step
      calculateStepCSS(activeStep),
      getAllElements(activeStep)
    ];
  }, [activeStep]);

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

  // Logic to run every time step changes
  useEffect(() => {
    if (!activeStep) return;

    activeStep.servar_fields.forEach(async ({ servar: { key, type } }) => {
      if (type !== 'signature') return;

      const signatureFile = await fieldValues[key];
      const base64 = await toBase64(signatureFile);
      signatureRef[key].fromDataURL(base64);
    });

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
    if (isNaN(activeStep.repeat_row_start) || isNaN(activeStep.repeat_row_end))
      return;

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
      const defaultValue = getDefaultFieldValue(field);
      updatedValues[servar.key] =
        newRepeatedValues.length === 0 ? [defaultValue] : newRepeatedValues;
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

  const getCommonCallbackProps = (newStep = activeStep) => {
    return {
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
      stepName: newStep?.key ?? ''
    };
  };

  const getErrorCallback = (props1) => async (props2) => {
    if (typeof onError === 'function') {
      const formattedFields = formatAllStepFields(steps, fieldValues, true);
      await onError({
        fields: formattedFields,
        ...props1,
        ...props2,
        ...getCommonCallbackProps()
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

    if (typeof onLoad === 'function') {
      const formattedFields = formatAllStepFields(steps, fieldValues, true);

      const integrationData = {};
      if (initState.authId) {
        integrationData.firebaseAuthId = initState.authId;
      }
      if (initState.authToken) {
        integrationData.firebaseAuthToken = initState.authToken;
      }
      let stepChanged = false;
      await onLoad({
        ...getCommonCallbackProps(newStep),
        fields: formattedFields,
        stepName: newStep.key,
        previousStepName: activeStep?.key,
        lastStep: steps[newKey].next_conditions.length === 0,
        setStep: (stepKey) => {
          stepChanged = changeStep(stepKey, newKey, steps, history);
        },
        firstStepLoaded: first,
        integrationData
      });
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
      const fetchPromise = clientInstance
        .fetchForm(initialValues)
        .then(([steps, res]) => {
          if (res.fonts?.length)
            WebFont.load({ google: { families: res.fonts } });
          steps = steps.reduce((result, step) => {
            result[step.key] = step;
            return result;
          }, {});
          setSteps(steps);
          setFormSettings({
            redirectUrl: res.redirect_url,
            errorType: res.error_type,
            autocomplete: res.autocomplete ? 'on' : 'off'
          });
          setProductionEnv(res.production);
          return [steps, res];
        });

      // fetch values separately because this request
      // goes to Feathery origin, while the previous
      // request goes to our CDN
      clientInstance
        .fetchSession()
        .then(async (session) => {
          setIntegrations(session.integrations);
          const newSession = await initializeIntegrations(
            session.integrations,
            clientInstance
          );
          if (newSession) session = newSession;

          fetchPromise
            .then(
              async ([
                steps,
                {
                  save_user_location: saveUserLocation,
                  save_user_data: saveUserData
                }
              ]) => {
                const usePrevious =
                  usePreviousUserData === null
                    ? saveUserData
                    : usePreviousUserData;
                if (!usePrevious)
                  clientInstance.setDefaultFormValues({
                    steps: Object.values(steps),
                    override: true
                  });
                if (!isObjectEmpty(initialValues))
                  clientInstance.submitCustom(initialValues);
                const hashKey = decodeURI(location.hash.substr(1));
                const newKey =
                  initialStepId ||
                  (hashKey && hashKey in steps && hashKey) ||
                  (saveUserLocation && session.current_step_key) ||
                  getOrigin(steps).key;
                setFirstStep(newKey);
                history.replace(
                  location.pathname + location.search + `#${newKey}`
                );
              }
            )
            .catch((err) => console.log(err));
        })
        .catch((error) => {
          console.log(error);
          // Go to first step if origin fails
          fetchPromise
            .then(async ([data]) => {
              const newKey = getOrigin(data).key;
              setFirstStep(newKey);
              history.replace(
                location.pathname + location.search + `#${newKey}`
              );
            })
            .catch((err) => console.log(err));
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

  if (!activeStep) return null;
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
      const { value: previousValue } = getFieldValue(field, fieldValues);

      // Add a repeated row if the value went from unset to set
      // And this is the last field in a set of repeated fields
      if (
        index === repeatedRowCount - 1 &&
        previousValue === defaultValue &&
        value !== defaultValue
      )
        repeatRowOperation = 'add';

      // Remove a repeated row if the value went from set to unset
      if (previousValue !== defaultValue && value === defaultValue)
        repeatRowOperation = 'remove';
    }

    if (servar.type === 'integer_field') value = parseInt(value);
    else if (servar.type === 'gmap_line_1' && !value) clearGMaps = true;
    else if (
      servar.type === 'checkbox' &&
      // eslint-disable-next-line camelcase
      servar.metadata?.always_checked
    )
      value = true;

    updateValues[servar.key] =
      index === null
        ? value
        : justInsert(fieldValues[servar.key], value, index);

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
    if (repeatRowOperation === 'add') addRepeatedRow();
    else if (repeatRowOperation === 'remove') removeRepeatedRow(index);
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
      (field) => (servarMap[field.servar.key] = field.servar)
    );
    const formattedFields = formatStepFields(activeStep, fieldValues, false);
    const elementType = metadata.elementType;
    const trigger = {
      ...lookUpTrigger(activeStep, metadata.elementIDs[0], elementType),
      type: elementType,
      action: metadata.trigger
    };

    const newInlineErrors = {};
    Object.entries(formattedFields).map(async ([fieldKey, { value }]) => {
      const servar = servarMap[fieldKey];
      const message = getFieldError(value, servar);
      await setFormElementError({
        formRef,
        errorCallback: getErrorCallback({ trigger }),
        fieldKey,
        message,
        errorType: formSettings.errorType,
        servarType: servar.type,
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
      if (initState.authToken) {
        integrationData.firebaseAuthToken = initState.authToken;
      }

      const allFields = formatAllStepFields(steps, fieldValues, true);
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
      await onSubmit({
        ...getCommonCallbackProps(),
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
        client.registerEvent(eventData, submitPromise);
        setFinished(true);
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
          await onSkip({
            ...getCommonCallbackProps(),
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
        await openPlaidLink(
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
    } else if (link === LINK_CUSTOM) {
      if (typeof onCustomAction === 'function') {
        onCustomAction({
          ...getCommonCallbackProps(),
          trigger: {
            ...lookUpTrigger(activeStep, button.id, 'button'),
            type: 'button',
            action: 'click'
          }
        });
      }
    } else if (link === LINK_SEND_SMS) {
      await setButtonLoader(button);
      await sendLoginCode(
        fieldValues[button.properties.sms_code_field_key],
        null,
        ['phone']
      );
      clearLoaders();
    } else if ([LINK_SUBMIT, LINK_SKIP].includes(link)) {
      await buttonOnSubmit(link === LINK_SUBMIT, button);
    }
  };

  const fieldOnChange = ({ fieldIDs, fieldKeys, elementRepeatIndex = 0 }) => ({
    trigger = 'field',
    submitData = false,
    integrationData = null,
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
      const formattedFields = formatAllStepFields(steps, fieldValues, true);
      callbackRef.current.addCallback(
        onChange({
          ...getCommonCallbackProps(),
          changeKeys: fieldKeys,
          trigger,
          integrationData,
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
            onView({
              ...getCommonCallbackProps(),
              visibilityStatus: { elementId, isVisible }
            }),
            loaders
          );
        }
      : undefined;

  let fieldCounter = 0;
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
          ...style
        }}
      >
        {children}
        {allElements
          .filter(
            ([element]) =>
              !shouldElementHide({
                fields: activeStep.servar_fields,
                values: fieldValues,
                element: element
              })
          )
          .sort(([a], [b]) => {
            if (a.row_index > b.row_index) return 1;
            else if (a.row_index < b.row_index) return -1;
            else if (a.column_index > b.column_index) return 1;
            else if (a.column_index < b.column_index) return -1;
            else return 0;
          })
          .map(([el, type]) => {
            const fieldId = el.servar?.key ?? el.id;
            let onView;
            if (elementOnView && onViewElements.includes(fieldId)) {
              onView = (isVisible) => elementOnView(fieldId, isVisible);
            }

            if (type === 'progress_bar')
              return (
                <Elements.ProgressBarElement
                  key={`pb-${el.column_index}-${el.column_index_end}-${el.row_index}-${el.row_index_end}`}
                  componentOnly={false}
                  element={el}
                  progress={userProgress}
                  curDepth={curDepth}
                  maxDepth={maxDepth}
                  elementProps={elementProps[el.id]}
                  onView={onView}
                />
              );
            else if (type === 'image')
              return (
                <Elements.ImageElement
                  key={reactFriendlyKey(el)}
                  componentOnly={false}
                  element={el}
                  elementProps={elementProps[el.id]}
                  onView={onView}
                />
              );
            else if (type === 'text')
              return (
                <Elements.TextElement
                  key={reactFriendlyKey(el)}
                  componentOnly={false}
                  element={el}
                  values={fieldValues}
                  handleRedirect={handleRedirect}
                  conditions={activeStep.next_conditions}
                  elementProps={elementProps[el.id]}
                  onView={onView}
                />
              );
            else if (type === 'button')
              return (
                <Elements.ButtonElement
                  key={reactFriendlyKey(el)}
                  componentOnly={false}
                  element={el}
                  values={fieldValues}
                  loader={
                    loaders[el.id]?.showOn === 'on_button' &&
                    loaders[el.id]?.loader
                  }
                  handleRedirect={handleRedirect}
                  onClick={() => buttonOnClick(el)}
                  elementProps={elementProps[el.id]}
                  onView={onView}
                />
              );
            else if (type === 'field') {
              fieldCounter++;
              const index = el.repeat ?? null;
              const servar = el.servar;
              const { value: fieldVal } = getFieldValue(el, fieldValues);

              let otherVal = '';
              if (servar.metadata.other) {
                if (
                  servar.type === 'select' &&
                  !servar.metadata.options.includes(fieldVal)
                ) {
                  otherVal = fieldVal;
                } else if (servar.type === 'multiselect') {
                  fieldVal.forEach((val) => {
                    if (!servar.metadata.options.includes(val)) otherVal = val;
                  });
                }
              }

              const onClick = (e, submitData = false) => {
                const metadata = {
                  elementType: 'field',
                  elementIDs: [el.id],
                  trigger: 'click'
                };
                if (submitData) {
                  submit({ metadata, repeat: el.repeat || 0 });
                } else {
                  handleRedirect({ metadata });
                }
              };

              const onChange = fieldOnChange({
                fieldIDs: [el.id],
                fieldKeys: [servar.key],
                elementRepeatIndex: el.repeat || 0
              });

              const inlineErr =
                formSettings.errorType === 'inline' &&
                getInlineError(el, inlineErrors);

              const required = isFieldActuallyRequired(
                el,
                repeatTriggerExists,
                repeatedRowCount
              );

              const fieldProps = {
                key: reactFriendlyKey(el),
                element: el,
                componentOnly: false,
                elementProps: elementProps[servar.key],
                autoComplete: formSettings.autocomplete,
                required,
                onView
              };

              let changeHandler;
              switch (servar.type) {
                case 'signature':
                  return (
                    <Elements.SignatureField
                      {...fieldProps}
                      signatureRef={signatureRef}
                      onEnd={() => {
                        clearFilePathMapEntry(
                          servar.key,
                          servar.repeated ? index : null
                        );
                        const base64Img = signatureRef[servar.key].toDataURL(
                          'image/png'
                        );
                        const newFile = dataURLToFile(
                          base64Img,
                          `${servar.key}.png`
                        );
                        fieldValues[servar.key] = Promise.resolve(newFile);
                        onChange();
                      }}
                    />
                  );
                case 'file_upload':
                  return (
                    <Elements.FileUploadField
                      {...fieldProps}
                      onChange={(e) => {
                        const file = e.target.files[0];
                        clearFilePathMapEntry(
                          servar.key,
                          servar.repeated ? index : null
                        );
                        changeValue(
                          file ? Promise.resolve(file) : file,
                          el,
                          index
                        );
                        onChange({
                          submitData:
                            el.properties.submit_trigger === 'auto' && file
                        });
                      }}
                      onClick={onClick}
                    />
                  );
                case 'rich_file_upload':
                  return (
                    <Elements.RichFileUploadField
                      {...fieldProps}
                      onChange={(files) => {
                        const fileVal = files[0];
                        clearFilePathMapEntry(
                          servar.key,
                          servar.repeated ? index : null
                        );
                        changeValue(fileVal, el, index);
                        onChange({
                          submitData:
                            el.properties.submit_trigger === 'auto' && fileVal
                        });
                      }}
                      onClick={onClick}
                      initialFile={fieldVal}
                    />
                  );
                case 'rich_multi_file_upload':
                  return (
                    <Elements.MultiFileUploadField
                      {...fieldProps}
                      onChange={(files, fieldIndex) => {
                        clearFilePathMapEntry(
                          servar.key,
                          servar.repeated ? index : null
                        );
                        changeValue(files, el, index);
                        onChange({
                          valueRepeatIndex: fieldIndex,
                          submitData: false
                        });
                      }}
                      onClick={onClick}
                      initialFiles={fieldVal}
                    />
                  );
                case 'button_group':
                  return (
                    <Elements.ButtonGroupField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      onClick={(e) => {
                        const fieldKey = e.target.id;
                        activeStep.servar_fields.forEach((field) => {
                          const servar = field.servar;
                          if (servar.key !== fieldKey) return;
                          updateFieldValues({
                            [servar.key]: e.target.textContent
                          });
                        });
                        onClick(e, el.properties.submit_trigger === 'auto');
                      }}
                    />
                  );
                case 'checkbox':
                  return (
                    <Elements.CheckboxField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      onClick={onClick}
                      onChange={(e) => {
                        const val = e.target.checked;
                        changeValue(val, el, index);
                        onChange();
                      }}
                    />
                  );
                case 'dropdown':
                case 'gmap_state':
                  return (
                    <Elements.DropdownField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      onClick={onClick}
                      onChange={(e) => {
                        const val = e.target.value;
                        changeValue(val, el, index);
                        onChange({
                          submitData:
                            el.properties.submit_trigger === 'auto' && val
                        });
                      }}
                      inlineError={inlineErr}
                    />
                  );
                case 'pin_input':
                  return (
                    <Elements.PinInputField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      onClick={onClick}
                      onChange={(val) => {
                        changeValue(val, el, index, false);
                        onChange({
                          submitData:
                            el.properties.submit_trigger === 'auto' &&
                            val.length === el.servar.max_length
                        });
                        onChange();
                      }}
                      inlineError={inlineErr}
                      shouldFocus
                    />
                  );
                case 'multiselect':
                  return (
                    <Elements.CheckboxGroupField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      otherVal={otherVal}
                      onChange={(e) => {
                        handleCheckboxGroupChange(e, servar.key);
                        onChange();
                      }}
                      onOtherChange={(e) => {
                        handleOtherStateChange(otherVal)(e);
                        onChange();
                      }}
                      onClick={onClick}
                    />
                  );
                case 'select':
                  changeHandler = (e, change = true) => {
                    const val = e.target.value;
                    if (change) changeValue(val, el, index);
                    onChange({
                      submitData: el.properties.submit_trigger === 'auto' && val
                    });
                  };
                  return (
                    <Elements.RadioButtonGroupField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      otherVal={otherVal}
                      onChange={changeHandler}
                      onOtherChange={(e) => {
                        handleOtherStateChange(otherVal)(e);
                        changeHandler(e, false);
                      }}
                      onClick={onClick}
                    />
                  );
                case 'hex_color':
                  changeHandler = (color) => {
                    activeStep.servar_fields.forEach((field) => {
                      const iterServar = field.servar;
                      if (iterServar.key !== servar.key) return;
                      updateFieldValues({
                        [iterServar.key]: color
                      });
                    });
                    onChange({
                      submitData:
                        el.properties.submit_trigger === 'auto' && color
                    });
                  };
                  return (
                    <Elements.ColorPickerField
                      {...fieldProps}
                      fieldVal={fieldVal}
                      onChange={changeHandler}
                      onClick={onClick}
                    />
                  );
                default:
                  return (
                    <Elements.TextField
                      {...fieldProps}
                      rawValue={stringifyWithNull(fieldVal)}
                      onBlur={() => {
                        if (servar.type === 'gmap_line_1')
                          setGMapBlurKey(servar.key);
                      }}
                      onClick={onClick}
                      onAccept={(val) => {
                        const change = changeValue(val, el, index, false);
                        if (change) {
                          const submitData =
                            el.properties.submit_trigger === 'auto' &&
                            textFieldShouldSubmit(servar, val);
                          onChange({ submitData });
                        }
                      }}
                      autoFocus={fieldCounter === 1}
                      inlineError={inlineErr}
                    />
                  );
              }
            }
          })}
        {integrations['google-maps'] && (
          <GooglePlaces
            googleKey={integrations['google-maps']}
            activeStep={activeStep}
            steps={steps}
            onChange={fieldOnChange}
            updateFieldValues={updateFieldValues}
          />
        )}
        {!productionEnv && (
          <DevNavBar allSteps={steps} curStep={activeStep} history={history} />
        )}
      </ReactForm>
    </>
  );
}

export default function FormWithRouter(props) {
  return (
    <BrowserRouter>
      <Route path='/'>
        <Form {...props} />
      </Route>
    </BrowserRouter>
  );
}
