import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  calculateRepeatedRowCount,
  calculateStepCSS,
  injectRepeatedRows
} from '../utils/hydration';
import {
  changeStep,
  convertFilesToFilePromises,
  fetchS3File,
  findServars,
  formatAllStepFields,
  formatStepFields,
  getABVariant,
  getDefaultFieldValue,
  getDefaultFieldValues,
  getFieldError,
  getFieldValue,
  getInlineError,
  getOrigin,
  isFieldActuallyRequired,
  lookupElementKey,
  nextStepKey,
  objectMap,
  reactFriendlyKey,
  recurseDepth,
  setFormElementError,
  shouldElementHide,
  textFieldShouldSubmit
} from '../utils/formHelperFunctions';
import { initInfo, initState, initializeIntegrations } from '../utils/init';
import { justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';
import { stringifyWithNull } from '../utils/string';
import Elements from '../elements';
import GooglePlaces from './GooglePlaces';

import ReactForm from 'react-bootstrap/Form';
import TagManager from 'react-gtm-module';
import { sendLoginCode, verifySMSCode } from '../integrations/firebase';
import { getPlaidFieldValues, openPlaidLink } from '../integrations/plaid';
import Spinner from 'react-bootstrap/Spinner';
import Lottie from 'lottie-react';
import { useHotkeys } from 'react-hotkeys-hook';

const FILE_UPLOADERS = [
  'file_upload',
  'rich_file_upload',
  'rich_multi_file_upload'
];

function Form({
  // Public API
  formKey,
  onChange = null,
  onLoad = null,
  onSubmit = null,
  onSkip = null,
  onError = null,
  onCustomAction = null,
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

  const [steps, setSteps] = useState(null);
  const [rawActiveStep, setRawActiveStep] = useState(null);
  const [stepKey, setStepKey] = useState('');
  const [filePathMap, setFilePathMap] = useState({});
  const [shouldScrollToTop, setShouldScrollToTop] = useState(true);
  const [finished, setFinished] = useState(false);
  const [userProgress, setUserProgress] = useState(null);
  const [curDepth, setCurDepth] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const [redirectUrl, setRedirectUrl] = useState('');
  const [errType, setErrType] = useState('html5');
  const [inlineErrors, setInlineErrors] = useState({});
  const [repeatChanged, setRepeatChanged] = useState(false);
  const [usePreviousData, setUsePreviousData] = useState(usePreviousUserData);

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
  const stepLoader = useMemo(() => {
    const data = Object.values(loaders).find((l) => l?.showOn === 'full_page');
    if (!data) return null;
    return data.type === 'default' ? (
      <div style={{ height: '20vh', width: '20vh' }}>{data.loader}</div>
    ) : (
      data.loader
    );
  }, [loaders]);

  const fileServarKeys = useMemo(
    () =>
      findServars(steps, (s) => FILE_UPLOADERS.includes(s.type)).reduce(
        (keys, servar) => ({ ...keys, [servar.key]: true }),
        {}
      ),
    [steps]
  );

  const fieldValuesRef = useRef(initialValues);
  let fieldValues = fieldValuesRef.current;
  const submitRef = useRef(null);
  const formRef = useRef(null);
  const signatureRef = useRef({}).current;

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
    setHasPlaid(
      !!rawActiveStep.buttons.find((b) => b.properties.link === 'trigger_plaid')
    );
    setPlaidLinked(false);
    setGMapFilled(
      rawActiveStep.servar_fields.find(
        (f) => f.servar.type === 'gmap_line_1' && fieldValues[f.servar.key]
      )
    );
    return JSON.parse(
      JSON.stringify(
        injectRepeatedRows({
          step: rawActiveStep,
          repeatedRowCount
        })
      )
    );
  }, [rawActiveStep, repeatedRowCount]);

  useEffect(() => {
    if (gMapFilled) clearTimeout(gMapTimeoutId);
    else if (gMapBlurKey) {
      // Delay by 0.5 seconds to ensure onChange finishes running first if it needs to
      const timeoutId = setTimeout(
        () =>
          setFormElementError({
            formRef,
            errorCallback,
            fieldKey: gMapBlurKey,
            message: 'An address must be selected',
            errorType: errType,
            setInlineErrors: setInlineErrors,
            triggerErrors: true
          }),
        500
      );
      setGMapBlurKey('');
      setGMapTimeoutId(timeoutId);
    }
  }, [gMapTimeoutId, gMapFilled, gMapBlurKey]);

  // When the active step changes, recalculate the dimensions of the new step
  const stepCSS = useMemo(() => calculateStepCSS(activeStep), [activeStep]);

  useEffect(() => {
    if (!activeStep) return;
    const f = activeStep.servar_fields.find((field) => {
      const servar = field.servar;
      return (
        servar.type === 'login' &&
        servar.metadata.login_methods.includes('phone')
      );
    });
    const b = activeStep.buttons.find((b) => b.properties.link === 'submit');
    if (f && b) {
      window.firebaseRecaptchaVerifier = new global.firebase.auth.RecaptchaVerifier(
        b.id,
        { size: 'invisible' }
      );
    }
  }, [activeStep?.key]);

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
      // Skip 1-input steps by pressing `Enter`
      const submitButton = activeStep.buttons.find(
        (b) => b.properties.link === 'submit'
      );
      if (submitButton && activeStep.servar_fields.length === 1) {
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
  function updateFilePathMap(key, index = null) {
    setFilePathMap((filePathMap) => {
      const newMap = { ...filePathMap };
      if (index !== null) {
        if (!newMap[key]) newMap[key] = [];
        newMap[key][index] = null;
      } else {
        newMap[key] = null;
      }

      return newMap;
    });
  }

  const updateFieldValues = (newFieldValues, rerender = true) => {
    const empty = Object.entries(newFieldValues).some(
      ([key, val]) => !val || !fieldValues[key]
    );
    fieldValuesRef.current = {
      ...fieldValuesRef.current,
      ...newFieldValues
    };
    fieldValues = fieldValuesRef.current;
    // Always rerender from empty state for display purposes
    if (rerender || empty) setRender((render) => !render);
  };

  function updateSessionValues(session, useSessionData) {
    // Don't track previous sessions if toggled
    if (useSessionData === false || usePreviousData === false) return;

    // Convert files of the format { url, path } to Promise<File>
    const filePromises = objectMap(session.file_values, (fileOrFiles) =>
      Array.isArray(fileOrFiles)
        ? fileOrFiles.map((f) => fetchS3File(f.url))
        : fetchS3File(fileOrFiles.url)
    );

    // Create a map of servar keys to S3 paths so we know which files have been uploaded already
    const newFilePathMap = objectMap(session.file_values, (fileOrFiles) =>
      Array.isArray(fileOrFiles) ? fileOrFiles.map((f) => f.path) : fileOrFiles
    );

    setFilePathMap({ ...filePathMap, ...newFilePathMap });
    updateFieldValues({ ...session.field_values, ...filePromises });
  }

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

  const commonCallbackProps = {
    setOptions: updateFieldOptions(steps),
    setValues: (userVals) => {
      const values = convertFilesToFilePromises(userVals, fileServarKeys);
      updateFieldValues(values);
      client.submitCustom(values);
    },
    setProgress: (val) => setUserProgress(val),
    setStep: (stepKey) => {
      changeStep(stepKey, activeStep.key, steps, history);
    },
    userId: initInfo().userKey,
    stepName: activeStep?.key ?? ''
  };
  const errorCallback = async (props) => {
    if (typeof onError === 'function') {
      const formattedFields = formatAllStepFields(steps, fieldValues);
      await onError({
        fields: formattedFields,
        ...props,
        ...commonCallbackProps
      });
    }
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

    const [curDepth, maxDepth] = recurseDepth(steps, getOrigin(steps), newKey);
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
      const formattedFields = formatAllStepFields(steps, fieldValues);

      const integrationData = {};
      if (initState.authId) {
        integrationData.firebaseAuthId = initState.authId;
      }
      if (initState.authToken) {
        integrationData.firebaseAuthToken = initState.authToken;
      }
      let stepChanged = false;
      await onLoad({
        ...commonCallbackProps,
        fields: formattedFields,
        previousStepName: activeStep?.key,
        lastStep: steps[newKey].next_conditions.length === 0,
        setStep: (stepKey) => {
          stepChanged = changeStep(stepKey, newKey, steps, history);
        },
        firstStepLoaded: first,
        integrationData
      });
      if (stepChanged) return;
      setRawActiveStep(newStep);
    } else {
      setRawActiveStep(newStep);
    }
    setLoaders({});

    client.registerEvent({ step_key: newKey, event: 'load' });
  };

  useEffect(() => {
    if (client === null) {
      const clientInstance = new Client(formKey);
      setClient(clientInstance);
      setFirst(true);

      // render form without values first for speed
      const fetchPromise = clientInstance
        .fetchForm()
        .then((stepsResponse) => {
          const data = {};
          getABVariant(stepsResponse).forEach((step) => {
            data[step.key] = step;
          });
          setSteps(data);
          setRedirectUrl(stepsResponse.redirect_url);
          setErrType(stepsResponse.error_type);
          setUsePreviousData((usePreviousData) =>
            usePreviousData === null
              ? stepsResponse.save_user_data
              : usePreviousData
          );
          return [data, stepsResponse];
        })
        .catch((error) => {
          console.log(error);
          return [{}, {}];
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

          fetchPromise.then(
            async ([
              data,
              {
                save_user_location: saveUserLocation,
                save_user_data: saveUserData
              }
            ]) => {
              updateFieldValues(getDefaultFieldValues(data));
              updateSessionValues(session, saveUserData);
              const hashKey = decodeURI(location.hash.substr(1));
              const newKey =
                initialStepId ||
                (hashKey && hashKey in data && hashKey) ||
                (saveUserLocation && session.current_step_key) ||
                getOrigin(data);
              setFirstStep(newKey);
              history.replace(
                location.pathname + location.search + `#${newKey}`
              );
            }
          );
        })
        .catch((error) => {
          console.log(error);
          // Use default values if origin fails
          fetchPromise.then(async ([data]) => {
            updateFieldValues(getDefaultFieldValues(data));
            const newKey = getOrigin(data);
            setFirstStep(newKey);
            history.replace(location.pathname + location.search + `#${newKey}`);
          });
        });
    }
  }, [
    client,
    activeStep,
    setClient,
    setFirst,
    setSteps,
    getDefaultFieldValues,
    updateFieldValues
  ]);

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
    if (redirectUrl) {
      window.location.href = redirectUrl;
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

    updateFieldValues(updateValues, rerender);
    if (repeatRowOperation === 'add') addRepeatedRow();
    else if (repeatRowOperation === 'remove') removeRepeatedRow(index);
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
    const formattedFields = formatStepFields(
      activeStep,
      fieldValues,
      signatureRef
    );

    const newInlineErrors = {};
    Object.entries(formattedFields).map(async ([fieldKey, { value }]) => {
      const servar = servarMap[fieldKey];
      const message = getFieldError(value, servar, signatureRef);
      await setFormElementError({
        formRef,
        errorCallback,
        fieldKey,
        message,
        errorType: errType,
        servarType: servar.type,
        inlineErrors: newInlineErrors
      });
    });
    // do validation check before running user submission function
    // so user does not access invalid data
    const invalid = setFormElementError({
      formRef,
      errorType: errType,
      inlineErrors: newInlineErrors,
      setInlineErrors,
      triggerErrors: true
    });
    if (invalid) return;

    const { loggedIn, errorMessage, errorField } = await handleActions(
      setLoader
    );
    if (errorMessage && errorField) {
      setLoaders({});
      await setFormElementError({
        formRef,
        errorCallback,
        fieldKey: errorField.key,
        message: errorMessage,
        servarType: errorField.type,
        errorType: errType,
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

      const allFields = formatAllStepFields(steps, fieldValues);
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
      const elementType = metadata.elementType;
      await setLoader();
      await onSubmit({
        ...commonCallbackProps,
        submitFields: { ...formattedFields, ...plaidFieldValues },
        elementRepeatIndex: repeat,
        fields: allFields,
        lastStep,
        setErrors: (errors) => {
          if (Object.keys(errors).length > 0) setLoaders({});
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
              errorType: errType,
              inlineErrors: newInlineErrors
            });
          });
        },
        setStep: (stepKey) => {
          stepChanged = changeStep(stepKey, activeStep.key, steps, history);
        },
        triggerKey: lookupElementKey(
          activeStep,
          metadata.elementIDs[0],
          elementType
        ),
        triggerType: elementType,
        triggerAction: metadata.trigger,
        firstStepSubmitted: first,
        integrationData
      });
      if (stepChanged) return;

      // do validation check in case user has manually invalidated the step
      const invalid = setFormElementError({
        formRef,
        errorType: errType,
        inlineErrors: newInlineErrors,
        setInlineErrors,
        triggerErrors: true
      });
      if (invalid) return;

      // async execution after user's onSubmit
      return handleSubmitRedirect({
        metadata,
        formattedFields,
        loggedIn
      });
    } else {
      return handleSubmitRedirect({
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
        return await verifySMSCode(
          fieldVal,
          servar,
          client,
          updateSessionValues
        );
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
      submitPromise = client.submitStep(featheryFields, filePathMap);
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

  function handleRedirect({
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
      const newURL = location.pathname + location.search + `#${redirectKey}`;
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
    if (!bp.loading_icon) {
      loader = (
        <Spinner
          animation='border'
          style={{
            color: 'white',
            border: '0.2em solid currentColor',
            borderRightColor: 'transparent',
            boxSizing: 'border-box',
            width: '100%',
            height: '100%'
          }}
          css={{
            '@-webkit-keyframes spinner-border': {
              to: {
                WebkitTransform: 'rotate(360deg)',
                transform: 'rotate(360deg)'
              }
            },
            '@keyframes spinner-border': {
              to: {
                WebkitTransform: 'rotate(360deg)',
                transform: 'rotate(360deg)'
              }
            },
            '&.spinner-border': {
              borderRadius: '50%',
              animation: '0.75s linear infinite spinner-border'
            }
          }}
        />
      );
    } else if (bp.loading_icon_type === 'image/*') {
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
          setLoader: () => setButtonLoader(button)
        });
      } else {
        if (typeof onSkip === 'function') {
          let stepChanged = false;
          await onSkip({
            ...commonCallbackProps,
            setStep: (stepKey) => {
              stepChanged = changeStep(stepKey, activeStep.key, steps, history);
            },
            triggerKey: lookupElementKey(activeStep, button.id, 'button'),
            triggerType: 'button',
            triggerAction: 'click'
          });
          if (stepChanged) return;
        }
        handleRedirect({ metadata });
      }
    } catch {
      setLoaders({});
    }
  };

  const buttonOnClick = async (button) => {
    if (
      ['add_repeated_row', 'remove_repeated_row'].includes(
        button.properties.link
      )
    ) {
      let data;
      if (button.properties.link === 'add_repeated_row')
        data = addRepeatedRow();
      else if (button.properties.link === 'remove_repeated_row') {
        data = removeRepeatedRow(button.repeat);
      }
      if (data.fieldKeys.length > 0) {
        fieldOnChange({
          fieldIds: data.fieldIDs,
          fieldKeys: data.fieldKeys,
          elementRepeatIndex: button.repeat
        })();
      }
    } else if (button.properties.link === 'trigger_plaid') {
      if (!plaidLinked) {
        await openPlaidLink(
          client,
          async () => {
            setPlaidLinked(true);
            if (activeStep.servar_fields.length === 0)
              await buttonOnSubmit(true, button);
          },
          updateFieldValues
        );
      }
    } else if (button.properties.link === 'custom') {
      if (typeof onCustomAction === 'function') {
        onCustomAction({
          ...commonCallbackProps,
          triggerKey: lookupElementKey(activeStep, button.id, 'button'),
          triggerType: 'button',
          triggerAction: 'click'
        });
      }
    } else if (['submit', 'skip'].includes(button.properties.link)) {
      await buttonOnSubmit(button.properties.link === 'submit', button);
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
          errorType: errType,
          setInlineErrors: setInlineErrors,
          triggerErrors: true
        });
      });
    }
    if (typeof onChange === 'function') {
      const formattedFields = formatAllStepFields(steps, fieldValues);
      onChange({
        ...commonCallbackProps,
        changeKeys: fieldKeys,
        trigger,
        integrationData,
        fields: formattedFields,
        lastStep: activeStep.next_conditions.length === 0,
        elementRepeatIndex,
        valueRepeatIndex
      });
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
        (b) => b.properties.link === 'submit'
      );
      if (submitButton) buttonOnClick(submitButton);
      else submit({ metadata, repeat: elementRepeatIndex });
    } else handleRedirect({ metadata });
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
        className={className}
        ref={formRef}
        css={{
          ...stepCSS,
          ...style
        }}
      >
        {children}
        {activeStep.progress_bars
          .filter(
            (pb) =>
              !shouldElementHide({
                fields: activeStep.servar_fields,
                values: fieldValues,
                element: pb
              })
          )
          .map((pb) => (
            <Elements.ProgressBarElement
              key={`pb-${pb.column_index}-${pb.column_index_end}-${pb.row_index}-${pb.row_index_end}`}
              componentOnly={false}
              element={pb}
              progress={userProgress}
              curDepth={curDepth}
              maxDepth={maxDepth}
              elementProps={elementProps[pb.id]}
            />
          ))}
        {activeStep.images
          .filter(
            (image) =>
              !shouldElementHide({
                fields: activeStep.servar_fields,
                values: fieldValues,
                element: image
              })
          )
          .map((element) => (
            <Elements.ImageElement
              key={reactFriendlyKey(element)}
              componentOnly={false}
              element={element}
              elementProps={elementProps[element.id]}
            />
          ))}
        {activeStep.texts
          .filter(
            (element) =>
              !shouldElementHide({
                fields: activeStep.servar_fields,
                values: fieldValues,
                element
              })
          )
          .map((element) => (
            <Elements.TextElement
              key={reactFriendlyKey(element)}
              componentOnly={false}
              element={element}
              values={fieldValues}
              handleRedirect={handleRedirect}
              conditions={activeStep.next_conditions}
              elementProps={elementProps[element.id]}
            />
          ))}
        {activeStep.buttons
          .filter(
            (button) =>
              !shouldElementHide({
                fields: activeStep.servar_fields,
                values: fieldValues,
                element: button
              })
          )
          .map((element) => (
            <Elements.ButtonElement
              key={reactFriendlyKey(element)}
              componentOnly={false}
              element={element}
              values={fieldValues}
              loader={
                loaders[element.id]?.showOn === 'on_button' &&
                loaders[element.id]?.loader
              }
              handleRedirect={handleRedirect}
              onClick={() => buttonOnClick(element)}
              setSubmitRef={(newRef) => (submitRef.current = newRef)}
              elementProps={elementProps[element.id]}
            />
          ))}
        {activeStep.servar_fields
          .filter(
            (field) =>
              !shouldElementHide({
                fields: activeStep.servar_fields,
                values: fieldValues,
                element: field
              })
          )
          .sort((a, b) => {
            if (a.row_index > b.row_index) return 1;
            else if (a.row_index < b.row_index) return -1;
            else if (a.column_index > b.column_index) return 1;
            else if (a.column_index < b.column_index) return -1;
            else return 0;
          })
          .map((field) => {
            const index = field.repeat ?? null;
            const servar = field.servar;
            const { value: fieldVal } = getFieldValue(field, fieldValues);

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
                elementIDs: [field.id],
                trigger: 'click'
              };
              if (submitData) {
                submit({ metadata, repeat: field.repeat || 0 });
              } else {
                handleRedirect({ metadata });
              }
            };

            const onChange = fieldOnChange({
              fieldIDs: [field.id],
              fieldKeys: [servar.key],
              elementRepeatIndex: field.repeat || 0
            });

            const inlineErr =
              errType === 'inline' && getInlineError(field, inlineErrors);

            const required = isFieldActuallyRequired(
              field,
              repeatTriggerExists,
              repeatedRowCount
            );

            const fieldProps = {
              key: reactFriendlyKey(field),
              element: field,
              componentOnly: false,
              elementProps: elementProps[servar.key],
              required
            };

            let changeHandler;
            switch (servar.type) {
              case 'signature':
                return (
                  <Elements.SignatureField
                    {...fieldProps}
                    signatureRef={signatureRef}
                  />
                );
              case 'file_upload':
                return (
                  <Elements.FileUploadField
                    {...fieldProps}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      changeValue(
                        file ? Promise.resolve(file) : file,
                        field,
                        index
                      );
                      onChange({
                        submitData:
                          field.properties.submit_trigger === 'auto' && file
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
                      updateFilePathMap(
                        servar.key,
                        servar.repeated ? index : null
                      );
                      changeValue(fileVal, field, index);
                      onChange({
                        submitData:
                          field.properties.submit_trigger === 'auto' && fileVal
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
                      updateFilePathMap(
                        servar.key,
                        servar.repeated ? index : null
                      );
                      changeValue(files, field, index);
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
                      onClick(e, field.properties.submit_trigger === 'auto');
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
                      changeValue(val, field, index);
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
                      changeValue(val, field, index);
                      onChange({
                        submitData:
                          field.properties.submit_trigger === 'auto' && val
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
                      changeValue(val, field, index, false);
                      onChange({
                        submitData:
                          field.properties.submit_trigger === 'auto' &&
                          val.length === field.servar.max_length
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
                  if (change) changeValue(val, field, index);
                  onChange({
                    submitData:
                      field.properties.submit_trigger === 'auto' && val
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
                      field.properties.submit_trigger === 'auto' && color
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
                      changeValue(val, field, index, false);
                      const submitData =
                        field.properties.submit_trigger === 'auto' &&
                        textFieldShouldSubmit(servar, val);
                      onChange({ submitData });
                    }}
                    inlineError={inlineErr}
                  />
                );
            }
          })}
        {
          <GooglePlaces
            googleKey={integrations['google-maps']}
            activeStep={activeStep}
            steps={steps}
            onChange={fieldOnChange}
            updateFieldValues={updateFieldValues}
          />
        }
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
