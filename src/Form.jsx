import {
    BootstrapField,
    MaskedBootstrapField,
    getMaskProps
} from './elements/fields/TextField';
import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import {
    ButtonElement,
    ButtonGroup,
    CheckboxGroup,
    Dropdown,
    ImageElement,
    MultiFileUploader,
    PinInput,
    RadioButtonGroup,
    RichFileUploader,
    TextElement,
    ProgressBarElement
} from './elements';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { applyStepStyles } from './utils/styles';
import {
    calculateDimensions,
    calculateRepeatedRowCount,
    injectRepeatedRows
} from './utils/hydration';
import {
    convertFilesToFilePromises,
    emailPattern,
    emailPatternStr,
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
    lookupElementKey,
    nextStepKey,
    objectMap,
    phonePattern,
    reactFriendlyKey,
    recurseDepth,
    setFormElementError,
    shouldElementHide
} from './utils/formHelperFunctions';
import { initializeIntegrations, initInfo, initState } from './utils/init';
import { justInsert, justRemove } from './utils/array';

import Client from './utils/client';
import GooglePlaces from './components/GooglePlaces';
import ReactForm from 'react-bootstrap/Form';
import SignatureCanvas from 'react-signature-canvas';
import { SketchPicker } from 'react-color';
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
    const [fieldValues, setFieldValues] = useState(initialValues);
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
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [curDepth, setCurDepth] = useState(0);
    const [maxDepth, setMaxDepth] = useState(0);
    const [integrations, setIntegrations] = useState({});
    const [noChange, setNoChange] = useState(false);
    const [stepSequence, setStepSequence] = useState([]);
    const [sequenceIndex, setSequenceIndex] = useState(0);
    const [errType, setErrType] = useState('html5');
    const [inlineErrors, setInlineErrors] = useState({});

    const submitRef = useRef(null);
    const formRef = useRef(null);
    const signatureRef = useRef({}).current;
    const maskedRef = useRef({}).current;

    const repeatedRowCount = useMemo(
        () =>
            calculateRepeatedRowCount({
                step: rawActiveStep,
                values: fieldValues
            }),
        [rawActiveStep, fieldValues]
    );

    // Create the fully-hydrated activeStep by injecting repeated rows
    // and pre-calculating styles.
    // Note: Other hydration transformations can also be included here
    const activeStep = useMemo(() => {
        if (!rawActiveStep) return null;
        const stepCopy = JSON.parse(JSON.stringify(rawActiveStep));
        applyStepStyles(stepCopy);
        return injectRepeatedRows({ step: stepCopy, repeatedRowCount });
    }, [rawActiveStep, repeatedRowCount]);

    // When the active step changes, recalculate the dimensions of the new step
    const dimensions = useMemo(() => calculateDimensions(activeStep), [
        activeStep
    ]);

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

    function addRepeatedRow({ values = fieldValues }) {
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
                ...values[servar.key],
                getDefaultFieldValue(field)
            ];
            fieldIDs.push(field.id);
            fieldKeys.push(servar.key);
        });

        return {
            values: updateFieldValues(updatedValues),
            fieldIDs,
            fieldKeys
        };
    }

    function removeRepeatedRow({ index, values = fieldValues }) {
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
            const newRepeatedValues = justRemove(values[servar.key], index);
            const defaultValue = getDefaultFieldValue(field);
            updatedValues[servar.key] =
                newRepeatedValues.length === 0
                    ? [defaultValue]
                    : newRepeatedValues;
            fieldIDs.push(field.id);
            fieldKeys.push(servar.key);
        });

        return {
            values: updateFieldValues(updatedValues),
            fieldIDs,
            fieldKeys
        };
    }

    const updateFieldValues = (newFieldValues, baseFieldValues = null) => {
        let newValues;
        if (baseFieldValues) {
            newValues = {
                ...baseFieldValues,
                ...fieldValues,
                ...newFieldValues
            };
        } else {
            newValues = { ...fieldValues, ...newFieldValues };
        }
        setFieldValues(newValues);
        return newValues;
    };

    function updateSessionValues(session, fieldVals) {
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
        return updateFieldValues(
            { ...session.field_values, ...filePromises },
            fieldVals
        );
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

    const getNewStep = async (newKey, stepsArg, fieldValsArg) => {
        stepsArg = stepsArg || steps;
        fieldValsArg = fieldValsArg || fieldValues;

        let newStep = stepsArg[newKey];
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
                newStep = stepsArg[newKey];
            } else break;
        }
        newStep = JSON.parse(JSON.stringify(newStep));

        const [curDepth, maxDepth] = recurseDepth(
            stepsArg,
            getOrigin(stepsArg),
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
            const formattedFields = formatAllStepFields(stepsArg, fieldValsArg);
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
                lastStep: stepsArg[newKey].next_conditions.length === 0,
                setValues: (userVals) => {
                    const values = convertFilesToFilePromises(
                        userVals,
                        fileServarKeys
                    );
                    updateFieldValues(values, fieldValsArg);
                    client.submitCustom(values);
                },
                setOptions: updateFieldOptions(stepsArg, newStep),
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
                        updateSessionValues(
                            session,
                            getDefaultFieldValues(data)
                        );
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
                        updateFieldValues(
                            fieldValues,
                            getDefaultFieldValues(data)
                        );
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
        getNewStep,
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
    const handleChange = (e, index = null) => {
        const target = e.target;
        let value = target.type === 'checkbox' ? target.checked : target.value;
        const key = target.id;
        const updateValues = {};
        let clearGMaps = false;
        let repeatRowOperation;

        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (
                servar.key !== key ||
                (index !== null && field.repeat !== index)
            )
                return;

            if (servar.repeat_trigger === 'set_value') {
                const defaultValue = getDefaultFieldValue(field);
                const { value: previousValue } = getFieldValue(
                    field,
                    fieldValues
                );

                // Add a repeated row if the value went from unset to set
                if (previousValue === defaultValue && value !== defaultValue)
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
        });
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

        let newValues = updateFieldValues(updateValues);
        if (repeatRowOperation === 'add') {
            newValues = addRepeatedRow({ values: newValues }).values;
        } else if (repeatRowOperation === 'remove') {
            newValues = removeRepeatedRow({ index, values: newValues }).values;
        }

        return newValues;
    };

    const handleValueChange = (value, id, index = null) => {
        return handleChange({ target: { type: '', value, id } }, index);
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
        return updateFieldValues({ [target.id]: curFieldVal });
    };

    const handleColorChange = (servarKey) => (color) => {
        let newValues = null;
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return;
            newValues = updateFieldValues({
                [servar.key]: color.hex.substr(1, 6)
            });
        });
        return newValues;
    };

    const handleColorPickerClick = (servarKey) => () => {
        const curVal = displayColorPicker[servarKey];
        setDisplayColorPicker({
            ...displayColorPicker,
            [servarKey]: !curVal
        });
    };

    const submit = async (
        submitData,
        metadata,
        repeat = 0,
        newValues = null
    ) => {
        let newFieldVals = newValues || fieldValues;
        if (submitData) {
            const servarMap = {};
            activeStep.servar_fields.forEach(
                (field) => (servarMap[field.servar.key] = field.servar)
            );
            const formattedFields = formatStepFields(
                activeStep,
                newFieldVals,
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

            let errorMessage, errorField;
            ({ newFieldVals, errorMessage, errorField } = await handleActions(
                formattedFields,
                metadata,
                newFieldVals
            ));
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

                const allFields = formatAllStepFields(steps, newFieldVals);
                const { newStepKey } = nextStepKey(
                    activeStep.next_conditions,
                    metadata,
                    steps,
                    newFieldVals,
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
                        newFieldVals = updateFieldValues(values, newFieldVals);
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
                    setInlineErrors(
                        JSON.parse(JSON.stringify(newInlineErrors))
                    );
                    const invalid = Object.values(newInlineErrors).find(
                        (data) => data.message
                    );
                    if (invalid) return;
                }

                // async execution after user's onSubmit
                return handleSubmitRedirect({
                    metadata,
                    newFieldVals,
                    submitData,
                    formattedFields
                });
            } else {
                return handleSubmitRedirect({
                    metadata,
                    newFieldVals,
                    submitData,
                    formattedFields
                });
            }
        } else {
            return handleRedirect({
                metadata,
                newFieldVals,
                submitData
            });
        }
    };

    async function handleActions(formattedFields, metadata, newFieldVals) {
        for (let i = 0; i < activeStep.servar_fields.length; i++) {
            const servar = activeStep.servar_fields[i].servar;
            const fieldVal = newFieldVals[servar.key];
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
                            return { newFieldVals };
                        })
                        .catch((error) => {
                            // Error; SMS not sent. Reset Recaptcha
                            window.firebaseRecaptchaVerifier
                                .render()
                                .then(function (widgetId) {
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
                            return { newFieldVals };
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
                                    newFieldVals = updateSessionValues(
                                        session,
                                        newFieldVals
                                    );
                                    return { newFieldVals };
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
        return { newFieldVals };
    }

    function handleSubmitRedirect({
        metadata,
        newFieldVals,
        submitData,
        formattedFields
    }) {
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
            newFieldVals,
            submitData,
            submitPromise
        });
    }

    function handleRedirect({
        metadata,
        newFieldVals,
        submitData,
        submitPromise = null
    }) {
        const { newStepKey, newSequence, newSequenceIndex } = nextStepKey(
            activeStep.next_conditions,
            metadata,
            steps,
            newFieldVals,
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
        newValues,
        trigger = 'field',
        integrationData = null,
        // Multi-file upload is not a repeated row but a repeated field
        valueRepeatIndex = null
    }) => {
        if (noChange) {
            return;
        }

        if (typeof onChange === 'function') {
            const formattedFields = formatAllStepFields(steps, newValues);
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
                    newValues = updateFieldValues(values, newValues);
                    client.submitCustom(values);
                },
                setOptions: updateFieldOptions(steps)
            });
        }
        submit(
            false,
            {
                elementType: 'field',
                elementIDs: fieldIDs,
                trigger: 'change'
            },
            elementRepeatIndex,
            newValues
        );
    };

    const pb = activeStep.progress_bar;
    const ddw = dimensions.desktop.definiteWidth;
    const dmw = dimensions.mobile.definiteWidth;
    const stepCSS = {
        backgroundColor: `#${activeStep.default_background_color}`,
        display: 'grid',
        maxWidth: '100%',
        gridTemplateRows: dimensions.desktop.relativeRows.join(' '),
        width: dimensions.desktop.relativeWidth,
        gridTemplateColumns: dimensions.desktop.definiteColumns.join(' '),
        ...style
    };
    // If checks to prevent media query collisions
    if (ddw !== '478px' && ddw !== dmw) {
        stepCSS[`@media (max-width: ${ddw})`] = {
            width: ddw,
            gridTemplateColumns: dimensions.desktop.relativeColumns.join(' ')
        };
    }
    if (dmw !== '478px') {
        stepCSS['@media (max-width: 478px)'] = {
            width: dimensions.mobile.relativeWidth,
            gridTemplateRows: dimensions.mobile.relativeRows.join(' '),
            gridTemplateColumns: dimensions.mobile.definiteColumns.join(' ')
        };
    }
    stepCSS[`@media (max-width: ${dmw})`] = {
        width: dmw,
        gridTemplateColumns: dimensions.mobile.relativeColumns.join(' ')
    };

    return (
        <ReactForm
            className={className}
            ref={formRef}
            css={stepCSS}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // eslint-disable-next-line no-unused-expressions
                submitRef?.current();
            }}
        >
            {children}
            {pb &&
                !shouldElementHide({
                    fields: activeStep.servar_fields,
                    values: fieldValues,
                    element: pb
                }) && (
                    <ProgressBarElement
                        element={pb}
                        curDepth={curDepth}
                        maxDepth={maxDepth}
                    />
                )}
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
                    <ImageElement key={`${element.id}`} element={element} />
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
                    <TextElement
                        key={`${element.id}`}
                        element={element}
                        values={fieldValues}
                        conditions={activeStep.next_conditions}
                        submit={submit}
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
                    <ButtonElement
                        key={`${element.id}`}
                        element={element}
                        values={fieldValues}
                        submit={submit}
                        onRepeatClick={() => {
                            let data;
                            if (element.link === 'add_repeated_row') {
                                data = addRepeatedRow({});
                            } else if (element.link === 'remove_repeated_row') {
                                data = removeRepeatedRow({
                                    index: element.repeat
                                });
                            }
                            if (data.fieldKeys.length > 0) {
                                fieldOnChange({
                                    fieldIds: data.fieldIDs,
                                    fieldKeys: data.fieldKeys,
                                    elementRepeatIndex: element.repeat
                                })({ newValues: data.values });
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
                .map((field) => ({ field, index: field.repeat ?? null }))
                .map(({ field, index }) => {
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

                    const fieldLabel = servar.name ? (
                        <label
                            htmlFor={servar.key}
                            style={{
                                marginBottom: '10px',
                                display: 'inline-block'
                            }}
                        >
                            {servar.name}
                        </label>
                    ) : null;
                    const onClick = (
                        e,
                        submitData = false,
                        fieldValues = null
                    ) =>
                        submit(
                            submitData,
                            {
                                elementType: 'field',
                                elementIDs: [field.id],
                                trigger: 'click'
                            },
                            field.repeat || 0,
                            fieldValues
                        );
                    const onChange = fieldOnChange({
                        fieldIDs: [field.id],
                        fieldKeys: [servar.key],
                        elementRepeatIndex: field.repeat || 0
                    });

                    const inlineErr =
                        errType === 'inline' &&
                        getInlineError(field, inlineErrors);

                    const styles = field.styles;

                    let controlElement;
                    switch (servar.type) {
                        case 'signature':
                            controlElement = (
                                <div
                                    css={{
                                        ...field.applyStyles.getTarget('fc'),
                                        maxWidth: '100%'
                                    }}
                                >
                                    {fieldLabel}
                                    <SignatureCanvas
                                        penColor='black'
                                        canvasProps={{
                                            id: servar.key,
                                            width: styles.width,
                                            height: styles.height,
                                            style: field.applyStyles.getTarget(
                                                'field'
                                            )
                                        }}
                                        ref={(ref) => {
                                            signatureRef[servar.key] = ref;
                                        }}
                                    />
                                </div>
                            );
                            break;
                        case 'file_upload':
                            controlElement = (
                                <div css={field.applyStyles.getTarget('fc')}>
                                    {fieldLabel}
                                    <ReactForm.File
                                        id={servar.key}
                                        required={servar.required}
                                        onChange={(e) => {
                                            const file = e.target.files[0];
                                            onChange({
                                                newValues: handleValueChange(
                                                    file
                                                        ? Promise.resolve(file)
                                                        : file,
                                                    servar.key,
                                                    index
                                                )
                                            });
                                        }}
                                        onClick={onClick}
                                        style={{
                                            cursor: 'pointer'
                                        }}
                                    />
                                </div>
                            );
                            break;
                        case 'rich_file_upload':
                            controlElement = (
                                <RichFileUploader
                                    field={field}
                                    onChange={(e) => {
                                        onChange({
                                            newValues: handleValueChange(
                                                e.target.files[0],
                                                servar.key,
                                                index
                                            )
                                        });
                                    }}
                                    onClick={onClick}
                                    initialFile={fieldVal}
                                />
                            );
                            break;
                        case 'rich_multi_file_upload':
                            controlElement = (
                                <MultiFileUploader
                                    field={field}
                                    onChange={(files, fieldIndex) => {
                                        onChange({
                                            newValues: handleValueChange(
                                                files,
                                                servar.key,
                                                index
                                            ),
                                            valueRepeatIndex: fieldIndex
                                        });
                                    }}
                                    onClick={onClick}
                                    initialFiles={fieldVal}
                                />
                            );
                            break;
                        case 'button_group':
                            controlElement = (
                                <ButtonGroup
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    step={activeStep}
                                    onClick={onClick}
                                    updateFieldValues={updateFieldValues}
                                />
                            );
                            break;
                        case 'checkbox':
                            controlElement = (
                                <div css={field.applyStyles.getTarget('fc')}>
                                    {fieldLabel}
                                    <ReactForm.Check
                                        type='checkbox'
                                        id={servar.key}
                                        checked={fieldVal}
                                        onChange={(e) => {
                                            onChange({
                                                newValues: handleChange(
                                                    e,
                                                    index
                                                )
                                            });
                                        }}
                                        onClick={onClick}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}
                                        css={{
                                            'input[type="checkbox"]': {
                                                marginTop: 0,
                                                marginBottom: 0
                                            }
                                        }}
                                    />
                                </div>
                            );
                            break;
                        case 'dropdown':
                            controlElement = (
                                <Dropdown
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    onClick={onClick}
                                    onChange={(e) => {
                                        onChange({
                                            newValues: handleChange(e, index)
                                        });
                                    }}
                                    inlineError={inlineErr}
                                />
                            );
                            break;
                        case 'gmap_state':
                            controlElement = (
                                <Dropdown
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    onClick={onClick}
                                    onChange={(e) => {
                                        onChange({
                                            newValues: handleChange(e, index)
                                        });
                                    }}
                                    inlineError={inlineErr}
                                    type='states'
                                />
                            );
                            break;
                        case 'email':
                            controlElement = (
                                <BootstrapField
                                    label={fieldLabel}
                                    field={field}
                                    type='email'
                                    fieldValue={fieldVal}
                                    onChange={(e) => {
                                        onChange({
                                            newValues: handleChange(e, index)
                                        });
                                    }}
                                    onClick={onClick}
                                    pattern={emailPatternStr}
                                    inlineError={inlineErr}
                                />
                            );
                            break;
                        case 'pin_input':
                            controlElement = (
                                <PinInput
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    onClick={onClick}
                                    onChange={(val) => {
                                        onChange({
                                            newValues: handleValueChange(
                                                val,
                                                servar.key,
                                                index
                                            )
                                        });
                                    }}
                                    inlineError={inlineErr}
                                />
                            );
                            break;
                        case 'multiselect':
                            controlElement = (
                                <CheckboxGroup
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    otherVal={otherVal}
                                    step={activeStep}
                                    fieldValues={fieldValues}
                                    updateFieldValues={updateFieldValues}
                                    onChange={onChange}
                                    handleOtherStateChange={
                                        handleOtherStateChange
                                    }
                                    onClick={onClick}
                                />
                            );
                            break;
                        case 'select':
                            controlElement = (
                                <RadioButtonGroup
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    otherVal={otherVal}
                                    onChange={(e, newVals = null) => {
                                        onChange({
                                            newValues:
                                                newVals ||
                                                handleValueChange(
                                                    e.target.value,
                                                    servar.key,
                                                    index
                                                )
                                        });
                                    }}
                                    handleOtherStateChange={
                                        handleOtherStateChange
                                    }
                                    onClick={onClick}
                                />
                            );
                            break;
                        case 'hex_color':
                            controlElement = (
                                <div css={field.applyStyles.getTarget('fc')}>
                                    {fieldLabel}
                                    <div
                                        css={{
                                            width: '36px',
                                            height: '36px',
                                            background: `#${fieldVal}`,
                                            cursor: 'pointer',
                                            ...field.applyStyles.getTarget(
                                                'field'
                                            )
                                        }}
                                        onClick={(e) => {
                                            onClick(e);
                                            handleColorPickerClick(
                                                servar.key
                                            )();
                                        }}
                                    />
                                    {displayColorPicker[servar.key] ? (
                                        <div
                                            css={{
                                                position: 'absolute',
                                                zIndex: 2
                                            }}
                                        >
                                            <div
                                                css={{
                                                    position: 'fixed',
                                                    top: '0px',
                                                    right: '0px',
                                                    bottom: '0px',
                                                    left: '0px'
                                                }}
                                                onClick={handleColorPickerClick(
                                                    servar.key
                                                )}
                                            />
                                            <SketchPicker
                                                color={`#${fieldVal}`}
                                                onChange={(color) => {
                                                    const newValues = handleColorChange(
                                                        servar.key
                                                    )(color);
                                                    onChange({ newValues });
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            );
                            break;
                        case 'text_area':
                            controlElement = (
                                <BootstrapField
                                    label={fieldLabel}
                                    field={field}
                                    type='textarea'
                                    fieldValue={fieldVal}
                                    onChange={(e) => {
                                        onChange({
                                            newValues: handleChange(e, index)
                                        });
                                    }}
                                    onClick={onClick}
                                    rows={styles.num_rows}
                                    inlineError={inlineErr}
                                />
                            );
                            break;
                        case 'url':
                            controlElement = (
                                <BootstrapField
                                    label={fieldLabel}
                                    field={field}
                                    type='url'
                                    fieldValue={fieldVal}
                                    onChange={(e) => {
                                        onChange({
                                            newValues: handleChange(e, index)
                                        });
                                    }}
                                    onClick={onClick}
                                    inlineError={inlineErr}
                                />
                            );
                            break;
                        default:
                            controlElement = (
                                <MaskedBootstrapField
                                    {...getMaskProps(servar, fieldVal)}
                                    unmask
                                    fieldValue={fieldVal}
                                    onClick={onClick}
                                    onAccept={(value) => {
                                        onChange({
                                            newValues: handleValueChange(
                                                value,
                                                servar.key,
                                                index
                                            )
                                        });
                                    }}
                                    label={fieldLabel}
                                    field={field}
                                    type='text'
                                    ref={(r) => (maskedRef[servar.key] = r)}
                                    fieldMask={
                                        maskedRef[servar.key]?.maskRef?._value
                                    }
                                    inlineError={inlineErr}
                                />
                            );
                    }
                    return (
                        <div
                            css={{
                                display: 'flex',
                                flexDirection: 'column',
                                width: '100%',
                                ...field.applyStyles.getLayout(),
                                ...field.applyStyles.getTarget('container')
                            }}
                            key={reactFriendlyKey(field)}
                        >
                            {controlElement}
                        </div>
                    );
                })}
            {
                <GooglePlaces
                    googleKey={integrations['google-maps']}
                    activeStep={activeStep}
                    steps={steps}
                    setFieldValues={setFieldValues}
                    onChange={fieldOnChange}
                    setNoChange={setNoChange}
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
