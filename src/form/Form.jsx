import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Elements from '../elements';
import {
    calculateRepeatedRowCount,
    calculateStepCSS,
    injectRepeatedRows
} from '../utils/hydration';
import {
    convertFilesToFilePromises,
    emailPattern,
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
    phonePattern,
    reactFriendlyKey,
    recurseDepth,
    setFormElementError,
    shouldElementHide,
    textFieldShouldSubmit
} from '../utils/formHelperFunctions';
import { initInfo, initState, initializeIntegrations } from '../utils/init';
import { justInsert, justRemove } from '../utils/array';
import Client from '../utils/client';

import GooglePlaces from './GooglePlaces';
import ReactForm from 'react-bootstrap/Form';
import TagManager from 'react-gtm-module';

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
    initialValues = {},
    style = {},
    className = '',
    children
}) {
    const [client, setClient] = useState(null);
    const history = useHistory();

    const [steps, setSteps] = useState(null);
    const [rawActiveStep, setRawActiveStep] = useState(null);
    const [stepKey, setStepKey] = useState('');
    const [filePathMap, setFilePathMap] = useState({});
    const fileServarKeys = useMemo(
        () =>
            findServars(steps, (s) => FILE_UPLOADERS.includes(s.type)).reduce(
                (keys, servar) => ({ ...keys, [servar.key]: true }),
                {}
            ),
        [steps]
    );

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [curDepth, setCurDepth] = useState(0);
    const [maxDepth, setMaxDepth] = useState(0);
    const [integrations, setIntegrations] = useState({});
    const [stepSequence, setStepSequence] = useState([]);
    const [sequenceIndex, setSequenceIndex] = useState(0);
    const [errType, setErrType] = useState('html5');
    const [inlineErrors, setInlineErrors] = useState({});
    const [repeatChanged, setRepeatChanged] = useState(false);
    // Set to trigger conditional renders on field value updates, no need to use
    // eslint-disable-next-line no-unused-vars
    const [render, setRender] = useState(false);

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
        return JSON.parse(
            JSON.stringify(
                injectRepeatedRows({
                    step: rawActiveStep,
                    repeatedRowCount
                })
            )
        );
    }, [rawActiveStep, repeatedRowCount]);

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
        const b = activeStep.buttons.find((b) => b.link === 'submit');
        if (f && b) {
            window.firebaseRecaptchaVerifier = new global.firebase.auth.RecaptchaVerifier(
                b.id,
                { size: 'invisible' }
            );
        }
    }, [activeStep?.key]);

    function addRepeatedRow() {
        if (
            isNaN(activeStep.repeat_row_start) ||
            isNaN(activeStep.repeat_row_end)
        )
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
            const newRepeatedValues = justRemove(
                fieldValues[servar.key],
                index
            );
            const defaultValue = getDefaultFieldValue(field);
            updatedValues[servar.key] =
                newRepeatedValues.length === 0
                    ? [defaultValue]
                    : newRepeatedValues;
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

    function updateSessionValues(session) {
        // Convert files of the format { url, path } to Promise<File>
        const filePromises = objectMap(session.file_values, (fileOrFiles) =>
            Array.isArray(fileOrFiles)
                ? fileOrFiles.map((f) => fetchS3File(f.url))
                : fetchS3File(fileOrFiles.url)
        );

        // Create a map of servar keys to S3 paths so we know which files have been uploaded already
        const newFilePathMap = objectMap(session.file_values, (fileOrFiles) =>
            Array.isArray(fileOrFiles)
                ? fileOrFiles.map((f) => f.path)
                : fileOrFiles
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

    const getNewStep = async (newKey) => {
        let newStep = steps[newKey];
        while (true) {
            const loadCond = newStep.next_conditions.find((cond) => {
                if (cond.trigger !== 'load' || cond.element_type !== 'step')
                    return false;
                const notAuth =
                    cond.rules.find(
                        (r) => r.comparison === 'not_authenticated'
                    ) &&
                    !initState.authId &&
                    !window.firebaseConfirmationResult;
                const auth =
                    cond.rules.find((r) => r.comparison === 'authenticated') &&
                    initState.authId;
                return notAuth || auth;
            });
            if (loadCond) {
                newKey = loadCond.next_step_key;
                newStep = steps[newKey];
            } else break;
        }
        newStep = JSON.parse(JSON.stringify(newStep));

        const [curDepth, maxDepth] = recurseDepth(
            steps,
            getOrigin(steps),
            newKey
        );
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
            const { userKey } = initInfo();

            const integrationData = {};
            if (initState.authId) {
                integrationData.firebaseAuthId = initState.authId;
            }
            if (initState.authToken) {
                integrationData.firebaseAuthToken = initState.authToken;
            }
            await onLoad({
                fields: formattedFields,
                stepName: newKey,
                previousStepName: activeStep?.key,
                userId: userKey,
                lastStep: steps[newKey].next_conditions.length === 0,
                setValues: (userVals) => {
                    const values = convertFilesToFilePromises(
                        userVals,
                        fileServarKeys
                    );
                    updateFieldValues(values);
                    client.submitCustom(values);
                },
                setOptions: updateFieldOptions(steps, newStep),
                integrationData
            });
            setRawActiveStep(newStep);
        } else {
            setRawActiveStep(newStep);
        }

        const eventData = { step_key: newKey, event: 'load' };
        if (stepSequence.includes(newKey)) {
            const newSequenceIndex = stepSequence.indexOf(newKey) + 1;
            setSequenceIndex(newSequenceIndex);
            eventData.current_sequence_index = newSequenceIndex;
        }
        client.registerEvent(eventData);
    };

    useEffect(() => {
        if (client === null) {
            const clientInstance = new Client(formKey);
            setClient(clientInstance);

            // render form without values first for speed
            const fetchPromise = clientInstance
                .fetchForm()
                .then((stepsResponse) => {
                    const data = {};
                    getABVariant(stepsResponse).forEach((step) => {
                        data[step.key] = step;
                    });
                    setSteps(data);
                    setErrType(stepsResponse.error_type || 'html5');
                    return data;
                })
                .catch((error) => console.log(error));

            // fetch values separately because this request
            // goes to Feathery origin, while the previous
            // request goes to our CDN
            clientInstance
                .fetchSession()
                .then(async (session) => {
                    setStepSequence(session.step_sequence);
                    setSequenceIndex(session.current_sequence_index);
                    setIntegrations(session.integrations);
                    const newSession = await initializeIntegrations(
                        session.integrations,
                        clientInstance
                    );
                    if (newSession) session = newSession;

                    fetchPromise.then(async (data) => {
                        updateFieldValues(getDefaultFieldValues(data));
                        updateSessionValues(session);
                        const newKey =
                            session.current_step_key || getOrigin(data);
                        history.replace(
                            location.pathname + location.search + `#${newKey}`
                        );
                    });
                })
                .catch((error) => {
                    // Use default values if origin fails
                    fetchPromise.then(async (data) => {
                        updateFieldValues(getDefaultFieldValues(data));
                        const newKey = getOrigin(data);
                        history.replace(
                            location.pathname + location.search + `#${newKey}`
                        );
                    });
                    console.log(error);
                });
        }
    }, [
        client,
        activeStep,
        setClient,
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
    if (finishConfig.finished) {
        if (finishConfig.redirectURL) {
            window.location.href = finishConfig.redirectURL;
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
                    [
                        'gmap_line_2',
                        'gmap_city',
                        'gmap_state',
                        'gmap_zip'
                    ].includes(servar.type)
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

    const submit = async (metadata, repeat = 0) => {
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
        Object.entries(formattedFields).map(([fieldKey, { value }]) => {
            const servar = servarMap[fieldKey];
            const err = getFieldError(value, servar, signatureRef);
            if (errType === 'html5') {
                setFormElementError({
                    formRef,
                    fieldKey,
                    message: err,
                    servarType: servar.type
                });
            } else if (errType === 'inline') {
                newInlineErrors[fieldKey] = { message: err };
            }
        });
        // do validation check before running user submission function
        // so user does not access invalid data
        if (errType === 'html5') {
            formRef.current.reportValidity();
            if (!formRef.current.checkValidity()) return;
        } else if (errType === 'inline') {
            setInlineErrors(newInlineErrors);
            const invalid = Object.values(newInlineErrors).find(
                (data) => data.message
            );
            if (invalid) return;
        }

        const { errorMessage, errorField } = await handleActions();
        if (errorMessage && errorField) {
            if (errType === 'html5') {
                setFormElementError({
                    formRef,
                    fieldKey: errorField.key,
                    message: errorMessage,
                    servarType: errorField.type
                });
                formRef.current.reportValidity();
            } else if (errType === 'inline') {
                newInlineErrors[errorField.key] = { message: errorMessage };
                setInlineErrors(newInlineErrors);
            }
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
            const { newStepKey } = nextStepKey(
                activeStep.next_conditions,
                metadata,
                steps,
                fieldValues,
                stepSequence,
                sequenceIndex
            );
            const { userKey } = initInfo();
            const elementType = metadata.elementType;
            await onSubmit({
                submitFields: formattedFields,
                elementRepeatIndex: repeat,
                fields: allFields,
                stepName: activeStep.key,
                userId: userKey,
                lastStep: !newStepKey,
                setValues: (userVals) => {
                    const values = convertFilesToFilePromises(
                        userVals,
                        fileServarKeys
                    );
                    updateFieldValues(values);
                    client.submitCustom(values);
                },
                setOptions: updateFieldOptions(steps),
                setErrors: (errors) => {
                    Object.entries(errors).forEach(([fieldKey, error]) => {
                        let index = null;
                        let message = error;
                        // If the user provided an object for an error then use the specified index and message
                        // This allows users to specify an error on an element in a repeated row
                        if (typeof error === 'object') {
                            index = error.index;
                            message = error.message;
                        }
                        if (errType === 'html5') {
                            setFormElementError({
                                formRef,
                                fieldKey,
                                message,
                                index
                            });
                        } else {
                            newInlineErrors[fieldKey] = { message, index };
                        }
                    });
                },
                triggerKey: lookupElementKey(
                    activeStep,
                    metadata.elementIDs[0],
                    elementType
                ),
                triggerType: elementType,
                triggerAction: metadata.trigger,
                integrationData
            });

            // do validation check in case user has manually invalidated the step
            if (errType === 'html5') {
                formRef.current.reportValidity();
                if (!formRef.current.checkValidity()) return;
            } else if (errType === 'inline') {
                setInlineErrors(JSON.parse(JSON.stringify(newInlineErrors)));
                const invalid = Object.values(newInlineErrors).find(
                    (data) => data.message
                );
                if (invalid) return;
            }

            // async execution after user's onSubmit
            return handleSubmitRedirect({
                metadata,
                formattedFields
            });
        } else {
            return handleSubmitRedirect({
                metadata,
                formattedFields
            });
        }
    };

    async function handleActions() {
        for (let i = 0; i < activeStep.servar_fields.length; i++) {
            const servar = activeStep.servar_fields[i].servar;
            const fieldVal = fieldValues[servar.key];
            const methods = servar.metadata.login_methods;
            if (servar.type === 'login') {
                if (methods.includes('phone') && phonePattern.test(fieldVal)) {
                    return await global.firebase
                        .auth()
                        .signInWithPhoneNumber(
                            `+1${fieldVal}`,
                            window.firebaseRecaptchaVerifier
                        )
                        .then((confirmationResult) => {
                            // SMS sent
                            window.firebaseConfirmationResult = confirmationResult;
                            window.firebasePhoneNumber = fieldVal;
                            return {};
                        })
                        .catch((error) => {
                            // Error; SMS not sent. Reset Recaptcha
                            window.firebaseRecaptchaVerifier
                                .render()
                                .then(function(widgetId) {
                                    // Reset reCaptcha
                                    // eslint-disable-next-line no-undef
                                    grecaptcha.reset(widgetId);
                                });
                            return {
                                errorMessage: error.message,
                                errorField: servar
                            };
                        });
                } else if (
                    methods.includes('email') &&
                    emailPattern.test(fieldVal)
                ) {
                    return await global.firebase
                        .auth()
                        .sendSignInLinkToEmail(fieldVal, {
                            url: window.location.href,
                            handleCodeInApp: true
                        })
                        .then(() => {
                            window.localStorage.setItem(
                                'featheryFirebaseEmail',
                                fieldVal
                            );
                            return {};
                        })
                        .catch((error) => {
                            return {
                                errorMessage: error.message,
                                errorField: servar
                            };
                        });
                } else {
                    return {
                        errorMessage: 'Invalid login',
                        errorField: servar
                    };
                }
            } else if (
                servar.type === 'pin_input' &&
                servar.metadata.verify_sms_code
            ) {
                const fcr = window.firebaseConfirmationResult;
                if (fcr) {
                    return await fcr
                        .confirm(fieldVal)
                        .then(async (result) => {
                            // User signed in successfully.
                            return await client
                                .submitAuthInfo({
                                    authId: result.user.uid,
                                    authToken: await result.user.getIdToken(),
                                    authPhone: window.firebasePhoneNumber
                                })
                                .then((session) => {
                                    updateSessionValues(session);
                                    return {};
                                });
                        })
                        .catch(() => {
                            // User couldn't sign in (bad verification code?)
                            return {
                                errorMessage: 'Invalid code',
                                errorField: servar
                            };
                        });
                } else {
                    return {
                        errorMessage: 'Please refresh and try again',
                        errorField: servar
                    };
                }
            }
        }
        return {};
    }

    function handleSubmitRedirect({ metadata, formattedFields }) {
        const featheryFields = Object.entries(formattedFields).map(
            ([key, val]) => {
                let newVal = val.value;
                newVal = Array.isArray(newVal)
                    ? newVal.filter((v) => v || v === 0)
                    : newVal;
                return {
                    key,
                    [val.type]: newVal
                };
            }
        );
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
            submitData: true,
            submitPromise
        });
    }

    function handleRedirect({
                                metadata,
                                submitData = false,
                                submitPromise = null
                            }) {
        const { newStepKey, newSequence, newSequenceIndex } = nextStepKey(
            activeStep.next_conditions,
            metadata,
            steps,
            fieldValues,
            stepSequence,
            sequenceIndex
        );

        setSequenceIndex(newSequenceIndex);
        setStepSequence(newSequence);

        const eventData = {
            step_key: activeStep.key,
            next_step_key: newStepKey ?? '',
            event: submitData ? 'complete' : 'skip',
            current_sequence_index: newSequenceIndex,
            step_sequence: newSequence
        };

        if (!newStepKey) {
            if (
                submitData ||
                ['button', 'text'].includes(metadata.elementType)
            ) {
                eventData.completed = true;
                client.registerEvent(eventData, submitPromise);
                setFinishConfig({
                    finished: true,
                    redirectURL: activeStep.redirect_url
                });
                return true;
            }
        } else {
            if (steps[newStepKey].next_conditions.length === 0)
                eventData.completed = true;
            client.registerEvent(eventData, submitPromise);
            const newURL =
                location.pathname + location.search + `#${newStepKey}`;
            if (submitData || ['button', 'text'].includes(metadata.elementType))
                history.push(newURL);
            else history.replace(newURL);
            return true;
        }
    }

    const fieldOnChange = ({
                               fieldIDs,
                               fieldKeys,
                               elementRepeatIndex = 0
                           }) => ({
                                      trigger = 'field',
                                      submitData = false,
                                      integrationData = null,
                                      // Multi-file upload is not a repeated row but a repeated field
                                      valueRepeatIndex = null
                                  } = {}) => {
        if (typeof onChange === 'function') {
            const formattedFields = formatAllStepFields(steps, fieldValues);
            const { userKey } = initInfo();
            onChange({
                changeKeys: fieldKeys,
                trigger,
                integrationData,
                fields: formattedFields,
                stepName: activeStep.key,
                userId: userKey,
                lastStep: activeStep.next_conditions.length === 0,
                elementRepeatIndex,
                valueRepeatIndex,
                setValues: (userVals) => {
                    const values = convertFilesToFilePromises(
                        userVals,
                        fileServarKeys
                    );
                    updateFieldValues(values);
                    client.submitCustom(values);
                },
                setOptions: updateFieldOptions(steps)
            });
        }
        const metadata = {
            elementType: 'field',
            elementIDs: fieldIDs,
            trigger: 'change'
        };
        if (submitData) {
            // Simulate button click if available
            if (submitRef.current) submitRef.current();
            else submit(metadata, elementRepeatIndex);
        } else handleRedirect({ metadata });
    };

    return (
        <ReactForm
            className={className}
            ref={formRef}
            css={{
                ...stepCSS,
                ...style
            }}
            onKeyDown={(e) => {
                // Skip 1-input steps by pressing `Enter`
                if (
                    submitRef.current &&
                    e.key === 'Enter' &&
                    activeStep.servar_fields.length === 1
                ) {
                    // Simulate button click if available
                    submitRef.current();
                }
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
                        curDepth={curDepth}
                        maxDepth={maxDepth}
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
                        handleRedirect={handleRedirect}
                        submit={submit}
                        onRepeatClick={() => {
                            let data;
                            if (element.link === 'add_repeated_row') {
                                data = addRepeatedRow();
                            } else if (element.link === 'remove_repeated_row') {
                                data = removeRepeatedRow(element.repeat);
                            }
                            if (data.fieldKeys.length > 0) {
                                fieldOnChange({
                                    fieldIds: data.fieldIDs,
                                    fieldKeys: data.fieldKeys,
                                    elementRepeatIndex: element.repeat
                                })();
                            }
                        }}
                        setSubmitRef={(newRef) => (submitRef.current = newRef)}
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
                    const { value: fieldVal } = getFieldValue(
                        field,
                        fieldValues
                    );

                    let otherVal = '';
                    if (servar.metadata.other) {
                        if (
                            servar.type === 'select' &&
                            !servar.metadata.options.includes(fieldVal)
                        ) {
                            otherVal = fieldVal;
                        } else if (servar.type === 'multiselect') {
                            fieldVal.forEach((val) => {
                                if (!servar.metadata.options.includes(val))
                                    otherVal = val;
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
                            submit(metadata, field.repeat || 0);
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
                        errType === 'inline' &&
                        getInlineError(field, inlineErrors);

                    const required = isFieldActuallyRequired(
                        field,
                        repeatTriggerExists,
                        repeatedRowCount
                    );

                    const fieldProps = {
                        key: reactFriendlyKey(field),
                        element: field,
                        componentOnly: false,
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
                                                field.submit_trigger ===
                                                'auto' && file
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
                                                field.submit_trigger ===
                                                'auto' && fileVal
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
                                        activeStep.servar_fields.forEach(
                                            (field) => {
                                                const servar = field.servar;
                                                if (servar.key !== fieldKey)
                                                    return;
                                                updateFieldValues({
                                                    [servar.key]:
                                                    e.target.textContent
                                                });
                                            }
                                        );
                                        onClick(
                                            e,
                                            field.submit_trigger === 'auto'
                                        );
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
                                                field.submit_trigger ===
                                                'auto' && val
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
                                                field.submit_trigger ===
                                                'auto' &&
                                                val.length ===
                                                field.servar.max_length
                                        });
                                        onChange();
                                    }}
                                    inlineError={inlineErr}
                                />
                            );
                        case 'multiselect':
                            return (
                                <Elements.CheckboxGroupField
                                    {...fieldProps}
                                    fieldVal={fieldVal}
                                    otherVal={otherVal}
                                    onChange={(e) => {
                                        handleCheckboxGroupChange(
                                            e,
                                            servar.key
                                        );
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
                                if (change) {
                                    changeValue(val, field, index);
                                }
                                onChange({
                                    submitData:
                                        field.submit_trigger === 'auto' && val
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
                                        field.submit_trigger === 'auto' && color
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
                                    lazy={false}
                                    unmask
                                    fieldValue={fieldVal}
                                    onClick={onClick}
                                    onAccept={(val) => {
                                        changeValue(val, field, index, false);
                                        const submitData =
                                            field.submit_trigger === 'auto' &&
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
