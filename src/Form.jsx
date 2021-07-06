import React, { useEffect, useRef, useState, useMemo } from 'react';

import ProgressBar from 'react-bootstrap/ProgressBar';
import ReactForm from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';
import TagManager from 'react-gtm-module';
import { BrowserRouter, Route, useHistory } from 'react-router-dom';
import firebase from 'firebase/app';
import 'firebase/auth';

import { BootstrapField, MaskedBootstrapField } from './components/Bootstrap';
import { MuiField, MuiProgress } from './components/MaterialUI';
import Client from './utils/client';
import {
    formatAllStepFields,
    formatStepFields,
    getABVariant,
    getDefaultFieldValues,
    nextStepKey,
    getOrigin,
    recurseDepth,
    reactFriendlyKey,
    getFieldValue,
    setFormElementError,
    getDefaultFieldValue,
    getFieldError,
    shouldElementHide
} from './utils/formHelperFunctions';
import { justInsert, justRemove } from './utils/array';
import {
    calculateDimensions,
    calculateRepeatedRowCount,
    injectRepeatedRows
} from './utils/hydration';

import GooglePlaces from './components/GooglePlaces';
import {
    ButtonGroup,
    CheckboxGroup,
    Dropdown,
    GMapsStateDropdown,
    MultiFileUploader,
    PinInput,
    RadioButtonGroup,
    RichFileUploader,
    TextElement,
    ButtonElement
} from './fields';
import { initInfo, initState } from './utils/init';

import './bootstrap-iso.css';

// apiKey and userKey are required if displayStep === null
// totalSteps is required if displayStep !== null
function Form({
    // Public API
    formKey,
    onChange = null,
    onLoad = null,
    onSubmit = null,
    initialValues = {},
    style = {},
    className = '',
    children,

    // Internal
    displaySteps = null,
    displayStepKey = '',
    setFormDimensions = () => {}
}) {
    const [client, setClient] = useState(null);
    const history = useHistory();

    const [steps, setSteps] = useState(null);
    const [rawActiveStep, setRawActiveStep] = useState(
        steps ? steps[displayStepKey] : null
    );
    const [fieldValues, setFieldValues] = useState(initialValues);

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [curDepth, setCurDepth] = useState(displaySteps ? 1 : 0);
    const [maxDepth, setMaxDepth] = useState(
        displaySteps ? Object.keys(displaySteps).length : 0
    );
    const [integrations, setIntegrations] = useState({});
    const [noChange, setNoChange] = useState(false);
    const [stepSequence, setStepSequence] = useState([]);
    const [sequenceIndex, setSequenceIndex] = useState(0);

    const fieldRefs = useRef({}).current;
    const formRef = useRef(null);

    const repeatedRowCount = useMemo(
        () =>
            calculateRepeatedRowCount({
                step: rawActiveStep,
                values: fieldValues
            }),
        [rawActiveStep, fieldValues]
    );

    // Create the fully-hydrated activeStep by injecting repeated rows
    // Note: Other hydration transformations can also be included here
    const activeStep = useMemo(() => {
        return injectRepeatedRows({ step: rawActiveStep, repeatedRowCount });
    }, [rawActiveStep, repeatedRowCount]);

    // When the active step changes, recalculate the dimensions of the new step
    const dimensions = useMemo(() => calculateDimensions(activeStep), [
        activeStep
    ]);

    useEffect(() => {
        setFormDimensions(
            dimensions.width,
            dimensions.columns,
            dimensions.rows
        );
    }, [dimensions]);

    function addRepeatedRow() {
        if (
            isNaN(activeStep.repeat_row_start) ||
            isNaN(activeStep.repeat_row_end)
        )
            return;

        // Collect a list of all repeated fields
        const repeatedServarFields = rawActiveStep.servar_fields.filter(
            (field) => field.servar.repeated
        );

        // Update the values by appending a default value for each field
        const updatedValues = {};
        repeatedServarFields.forEach((field) => {
            const { servar } = field;
            updatedValues[servar.key] = [
                ...fieldValues[servar.key],
                getDefaultFieldValue(field)
            ];
        });

        updateFieldValues(updatedValues);
    }

    function removeRepeatedRow(repeatRowIndex) {
        if (isNaN(repeatRowIndex)) return;

        // Collect a list of all repeated fields
        const repeatedServarFields = rawActiveStep.servar_fields.filter(
            (field) => field.servar.repeated
        );

        // Update the values by removing the specified index from each field
        const updatedValues = {};
        repeatedServarFields.forEach((field) => {
            const { servar } = field;
            updatedValues[servar.key] = justRemove(
                fieldValues[servar.key],
                repeatRowIndex
            );
        });

        updateFieldValues(updatedValues);
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

    const setFileFieldValue = (fileKey, file) => {
        setFieldValues((fieldValues) => {
            return { ...fieldValues, [fileKey]: file };
        });
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

    const initializeIntegrations = (integrations) => {
        setIntegrations(integrations);

        const gtm = integrations['google-tag-manager'];
        if (gtm) TagManager.initialize({ gtmId: gtm });

        const fb = integrations.firebase;
        if (fb) {
            firebase.initializeApp({
                apiKey: fb.api_key,
                authDomain: `${fb.metadata.project_id}.firebaseapp.com`,
                databaseURL: `https://${fb.metadata.project_id}.firebaseio.com`,
                projectId: fb.metadata.project_id,
                storageBucket: `${fb.metadata.project_id}.appspot.com`,
                messagingSenderId: fb.metadata.sender_id,
                appId: fb.metadata.app_id
            });
        }
    };

    const getNewStep = async (
        newKey,
        stepsArg = null,
        fieldValuesArg = null,
        clientArg = null
    ) => {
        stepsArg = stepsArg || steps;
        fieldValuesArg = fieldValuesArg || fieldValues;
        clientArg = clientArg || client;

        let newStep;
        while (true) {
            newStep = JSON.parse(JSON.stringify(stepsArg[newKey]));
            const loadCond = newStep.next_conditions.find(
                (cond) =>
                    cond.trigger === 'load' &&
                    cond.element_type === 'step' &&
                    cond.rules.find((r) => r.comparison === 'not_authenticated')
            );
            if (
                loadCond &&
                !initState.authId &&
                !window.firebaseConfirmationResult
            )
                newKey = loadCond.next_step_key;
            else break;
        }

        let curDepth = 0;
        let maxDepth = 0;
        if (!displaySteps) {
            [curDepth, maxDepth] = recurseDepth(
                stepsArg,
                getOrigin(stepsArg),
                newKey
            );
        }

        setCurDepth(curDepth);
        setMaxDepth(maxDepth);

        if (!displaySteps) {
            if (typeof onLoad === 'function') {
                const formattedFields = formatAllStepFields(
                    stepsArg,
                    fieldValuesArg
                );
                const { userKey } = initInfo();

                await onLoad({
                    fields: formattedFields,
                    stepName: newKey,
                    previousStepName: activeStep?.key,
                    userId: userKey,
                    lastStep: stepsArg[newKey].next_conditions.length === 0,
                    setValues: (userVals) => {
                        fieldValuesArg = updateFieldValues(
                            userVals,
                            fieldValuesArg
                        );
                        clientArg.submitCustom(userVals);
                    },
                    setOptions: updateFieldOptions(stepsArg, newStep),
                    integrationData: null
                });
                setRawActiveStep(newStep);
            } else {
                setRawActiveStep(newStep);
            }

            newStep.servar_fields.forEach((field) => {
                const servar = field.servar;
                if (
                    servar.type === 'phone_number' &&
                    servar.metadata.send_sms_code
                ) {
                    const b = newStep.buttons.find((b) => b.link === 'submit');
                    if (b) {
                        window.firebaseRecaptchaVerifier = new firebase.auth.RecaptchaVerifier(
                            b.id,
                            { size: 'invisible' }
                        );
                    }
                }
            });

            const eventData = { step_key: newKey, event: 'load' };
            if (stepSequence.includes(newKey)) {
                const newSequenceIndex = stepSequence.indexOf(newKey) + 1;
                setSequenceIndex(newSequenceIndex);
                eventData.current_sequence_index = newSequenceIndex;
            }
            clientArg.registerEvent(eventData);
        } else {
            setRawActiveStep(newStep);
        }
    };

    useEffect(() => {
        if (displaySteps === null) {
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
                        return data;
                    })
                    .catch((error) => console.log(error));

                // fetch values separately because this request
                // goes to Feathery origin, while the previous
                // request goes to our CDN
                clientInstance
                    .fetchSession()
                    .then((session) => {
                        setStepSequence(session.step_sequence);
                        setSequenceIndex(session.current_sequence_index);
                        initializeIntegrations(session.integrations);

                        fetchPromise.then(async (data) => {
                            const newValues = updateFieldValues(
                                session.field_values,
                                getDefaultFieldValues(data)
                            );
                            Object.entries(session.file_values).forEach(
                                ([fileKey, fileOrFiles]) => {
                                    setFileFieldValue(fileKey, fileOrFiles);
                                }
                            );
                            const newKey =
                                session.current_step_key || getOrigin(data);
                            history.replace(
                                location.pathname +
                                    location.search +
                                    `#${newKey}`
                            );
                            getNewStep(newKey, data, newValues, clientInstance);
                        });
                    })
                    .catch((error) => {
                        // Use default values if origin fails
                        fetchPromise.then(async (data) => {
                            const newValues = updateFieldValues(
                                fieldValues,
                                getDefaultFieldValues(data)
                            );
                            const newKey = getOrigin(data);
                            history.replace(
                                location.pathname +
                                    location.search +
                                    `#${newKey}`
                            );
                            getNewStep(newKey, data, newValues, clientInstance);
                        });
                        console.log(error);
                    });
            }
        } else if (
            !activeStep ||
            displaySteps !== steps ||
            displayStepKey !== activeStep.key
        ) {
            const fieldVals = updateFieldValues(
                getDefaultFieldValues(displaySteps)
            );
            setSteps(displaySteps);
            getNewStep(displayStepKey, displaySteps, fieldVals);
        }
    }, [
        client,
        displayStepKey,
        displaySteps,
        activeStep,
        setClient,
        setSteps,
        getNewStep,
        getDefaultFieldValues,
        updateFieldValues
    ]);

    useEffect(() => {
        return history.listen(async () => {
            const hashKey = location.hash.substr(1);
            if (hashKey in steps) await getNewStep(hashKey);
        });
    }, [steps, getNewStep]);

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
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== key) return;

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

        return updateFieldValues(updateValues);
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
        if (displaySteps) return;

        let newFieldVals = newValues || fieldValues;
        if (submitData) {
            const servarMap = {};
            activeStep.servar_fields.forEach(
                (field) => (servarMap[field.servar.key] = field.servar)
            );
            const formattedFields = formatStepFields(activeStep, newFieldVals);

            Object.entries(formattedFields).map(([fieldKey, { value }]) => {
                const servar = servarMap[fieldKey];
                const err = getFieldError(value, servar);
                setFormElementError({
                    formRef,
                    fieldKey,
                    message: err,
                    servarType: servar.type
                });
            });
            // do validation check before running user submission function
            // so user does not access invalid data
            formRef.current.reportValidity();
            if (!formRef.current.checkValidity()) return;

            // Execute user-provided onSubmit function if present
            if (typeof onSubmit === 'function') {
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
                await onSubmit({
                    submitFields: formattedFields,
                    repeatIndex: repeat,
                    fields: allFields,
                    stepName: activeStep.key,
                    userId: userKey,
                    lastStep: !newStepKey,
                    setValues: (userVals) => {
                        newFieldVals = updateFieldValues(
                            userVals,
                            newFieldVals
                        );
                        client.submitCustom(userVals);
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
                            setFormElementError({
                                formRef,
                                fieldKey,
                                message,
                                index
                            });
                        });
                    },
                    integrationData: null
                });

                // do validation check in case user has manually invalidated the step
                formRef.current.reportValidity();
                if (formRef.current.checkValidity()) {
                    // async execution after user's onSubmit
                    return handleActionSubmitRedirect(
                        formattedFields,
                        metadata,
                        newFieldVals,
                        submitData
                    );
                }
            } else {
                return handleActionSubmitRedirect(
                    formattedFields,
                    metadata,
                    newFieldVals,
                    submitData
                );
            }
        } else {
            return handleRedirect({
                metadata,
                newFieldVals,
                submitData
            });
        }
    };

    async function handleActionSubmitRedirect(
        formattedFields,
        metadata,
        newFieldVals,
        submitData
    ) {
        let defaultRedirect = true;
        // Perform actions
        for (let i = 0; i < activeStep.servar_fields.length; i++) {
            const servar = activeStep.servar_fields[i].servar;
            if (
                servar.type === 'phone_number' &&
                servar.metadata.send_sms_code
            ) {
                defaultRedirect = false;
                return await firebase
                    .auth()
                    .signInWithPhoneNumber(
                        `+1${newFieldVals[servar.key]}`,
                        window.firebaseRecaptchaVerifier
                    )
                    .then((confirmationResult) => {
                        // SMS sent
                        window.firebaseConfirmationResult = confirmationResult;
                        window.firebasePhoneNumber = newFieldVals[servar.key];
                        return handleSubmitRedirect({
                            metadata,
                            newFieldVals,
                            submitData,
                            formattedFields
                        });
                    })
                    .catch((error) => {
                        // Error; SMS not sent. Reset Recaptcha
                        window.firebaseRecaptchaVerifier
                            .render()
                            .then(function (widgetId) {
                                // eslint-disable-next-line no-undef
                                grecaptcha.reset(widgetId);
                            });
                        setFormElementError({
                            formRef,
                            fieldKey: servar.key,
                            message: error.message
                        });
                        formRef.current.reportValidity();
                    });
            } else if (
                servar.type === 'pin_input' &&
                servar.metadata.verify_sms_code
            ) {
                defaultRedirect = false;
                const fcr = window.firebaseConfirmationResult;
                if (fcr) {
                    return await fcr
                        .confirm(newFieldVals[servar.key])
                        .then(async (result) => {
                            // User signed in successfully.
                            await client
                                .submitAuthInfo(
                                    result.user.uid,
                                    window.firebasePhoneNumber
                                )
                                .then((session) => {
                                    updateFieldValues(
                                        session.field_values,
                                        newFieldVals
                                    );
                                    Object.entries(session.file_values).forEach(
                                        ([fileKey, fileOrFiles]) => {
                                            setFileFieldValue(
                                                fileKey,
                                                fileOrFiles
                                            );
                                        }
                                    );
                                });
                            initState.authId = result.user.uid;
                            initState.authPhoneNumber =
                                window.firebasePhoneNumber;

                            return handleSubmitRedirect({
                                metadata,
                                newFieldVals,
                                submitData,
                                formattedFields
                            });
                        })
                        .catch(() => {
                            // User couldn't sign in (bad verification code?)
                            setFormElementError({
                                formRef,
                                fieldKey: servar.key,
                                message: 'Invalid code',
                                servarType: servar.type
                            });
                            formRef.current.reportValidity();
                        });
                } else {
                    setFormElementError({
                        formRef,
                        fieldKey: servar.key,
                        message: 'Please refresh and try again.',
                        servarType: servar.type
                    });
                    formRef.current.reportValidity();
                }
            }
        }
        if (defaultRedirect) {
            return handleSubmitRedirect({
                metadata,
                newFieldVals,
                submitData,
                formattedFields
            });
        }
    }

    function handleSubmitRedirect({
        metadata,
        newFieldVals,
        submitData,
        formattedFields
    }) {
        const featheryFields = Object.entries(formattedFields).map(
            ([key, val]) => ({
                key,
                [val.type]: val.value
            })
        );
        client.submitStep(featheryFields);

        return handleRedirect({
            metadata,
            newFieldVals,
            submitData
        });
    }

    function handleRedirect({ metadata, newFieldVals, submitData }) {
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
                client.registerEvent(eventData);
                setFinishConfig({
                    finished: true,
                    redirectURL: activeStep.redirect_url
                });
                return true;
            }
        } else {
            client.registerEvent(eventData);
            const newURL =
                location.pathname + location.search + `#${newStepKey}`;
            if (submitData || ['button', 'text'].includes(metadata.elementType))
                history.push(newURL);
            else history.replace(newURL);
            getNewStep(newStepKey, steps, newFieldVals);
            return true;
        }
    }

    const fieldOnChange = (
        fieldKeys,
        newValues,
        trigger = 'field',
        integrationData = null
    ) => {
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
                setValues: (userVals) => {
                    newValues = updateFieldValues(userVals, newValues);
                    client.submitCustom(userVals);
                },
                setOptions: updateFieldOptions(steps)
            });
        }
        submit(
            false,
            { elementType: 'field', elementKeys: fieldKeys, trigger: 'change' },
            0,
            newValues
        );
    };

    let progressBarElements = null;
    if (activeStep.progress_bar) {
        const pb = activeStep.progress_bar;
        if (activeStep.component_type === 'bootstrap') {
            const percent =
                pb.progress || Math.round((100 * curDepth) / (maxDepth + 1));
            progressBarElements = [
                <ProgressBar
                    key='progress'
                    style={{
                        height: '0.4rem',
                        width: `${pb.bar_width}%`,
                        maxWidth: '100%'
                    }}
                    css={{
                        '.progress-bar': {
                            margin: '0 0 0 0 !important',
                            backgroundColor: `#${pb.bar_color} !important`
                        }
                    }}
                    now={percent}
                />
            ];
            const completionPercentage = `${percent}% completed`;
            if (pb.percent_text_layout === 'top') {
                progressBarElements.splice(0, 0, completionPercentage);
            } else if (pb.percent_text_layout === 'bottom') {
                progressBarElements.splice(1, 0, completionPercentage);
            }
        } else {
            progressBarElements = [
                <MuiProgress
                    key='progress'
                    curStep={curDepth}
                    maxStep={maxDepth + 1}
                    progressBar={pb}
                />
            ];
        }
    }

    return (
        <ReactForm
            className={
                activeStep.component_type === 'bootstrap'
                    ? `bootstrap-iso ${className}`
                    : className
            }
            ref={formRef}
            style={{
                backgroundColor: `#${activeStep.default_background_color}`,
                display: 'grid',
                justifyContent: 'center',
                maxWidth: '100%',
                gridTemplateColumns: dimensions.columns.join(' '),
                gridTemplateRows: dimensions.rows.join(' '),
                width: dimensions.width ? `${dimensions.width}px` : '100%',
                ...style
            }}
        >
            {children}
            {activeStep.progress_bar &&
                (displaySteps ||
                    !shouldElementHide({
                        fields: activeStep.servar_fields,
                        values: fieldValues,
                        element: activeStep.progress_bar
                    })) && (
                    <div
                        key='progress-bar'
                        css={{
                            gridColumnStart:
                                activeStep.progress_bar.column_index + 1,
                            gridRowStart: activeStep.progress_bar.row_index + 1,
                            gridColumnEnd:
                                activeStep.progress_bar.column_index_end + 2,
                            gridRowEnd:
                                activeStep.progress_bar.row_index_end + 2,
                            alignItems: activeStep.progress_bar.layout,
                            justifyContent:
                                activeStep.progress_bar.vertical_layout,
                            paddingBottom: `${activeStep.progress_bar.padding_bottom}px`,
                            paddingTop: `${activeStep.progress_bar.padding_top}px`,
                            paddingLeft: `${activeStep.progress_bar.padding_left}px`,
                            paddingRight: `${activeStep.progress_bar.padding_right}px`,
                            color: `#${activeStep.progress_bar.font_color}`,
                            fontStyle: activeStep.progress_bar.font_italic
                                ? 'italic'
                                : 'normal',
                            fontWeight: activeStep.progress_bar.font_weight,
                            fontFamily: activeStep.progress_bar.font_family,
                            fontSize: `${activeStep.progress_bar.font_size}px`,
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        {progressBarElements}
                    </div>
                )}
            {activeStep.images
                .filter(
                    (image) =>
                        displaySteps ||
                        !shouldElementHide({
                            fields: activeStep.servar_fields,
                            values: fieldValues,
                            element: image
                        })
                )
                .map((image, i) => (
                    <div
                        key={`${activeStep.key}-image-${i}`}
                        style={{
                            gridColumnStart: image.column_index + 1,
                            gridRowStart: image.row_index + 1,
                            gridColumnEnd: image.column_index_end + 2,
                            gridRowEnd: image.row_index_end + 2,
                            display: 'flex',
                            alignItems: image.vertical_layout,
                            justifyContent: image.layout
                        }}
                    >
                        <img
                            src={image.source_url}
                            alt='Form Image'
                            style={{
                                paddingBottom: `${image.padding_bottom}px`,
                                paddingTop: `${image.padding_top}px`,
                                paddingLeft: `${image.padding_left}px`,
                                paddingRight: `${image.padding_right}px`,
                                width: `${image.image_width}${image.image_width_unit}`,
                                objectFit: 'contain'
                            }}
                        />
                    </div>
                ))}
            {activeStep.texts
                .filter(
                    (text) =>
                        displaySteps ||
                        !shouldElementHide({
                            fields: activeStep.servar_fields,
                            values: fieldValues,
                            element: text
                        })
                )
                .map((field, i) => (
                    <TextElement
                        key={`${activeStep.key}-text-${i}`}
                        field={field}
                        fieldValues={fieldValues}
                        conditions={activeStep.next_conditions}
                        submit={submit}
                    />
                ))}
            {activeStep.buttons
                .filter(
                    (button) =>
                        displaySteps ||
                        !shouldElementHide({
                            fields: activeStep.servar_fields,
                            values: fieldValues,
                            element: button
                        })
                )
                .map((field, i) => (
                    <ButtonElement
                        key={`${activeStep.key}-button-${i}`}
                        field={field}
                        fieldValues={fieldValues}
                        displaySteps={displaySteps}
                        submit={submit}
                        addRepeatedRow={addRepeatedRow}
                        removeRepeatedRow={removeRepeatedRow}
                    />
                ))}

            {activeStep.servar_fields
                .filter(
                    (field) =>
                        displaySteps ||
                        !shouldElementHide({
                            fields: activeStep.servar_fields,
                            values: fieldValues,
                            element: field
                        })
                )
                .sort((first, second) => {
                    if (first.row_index > second.row_index) return 1;
                    else if (first.row_index < second.row_index) return -1;
                    else return 0;
                })
                .map((field) => ({ field, index: field.repeat ?? null }))
                .map(({ field, index }) => {
                    const servar = field.servar;
                    const { value: fieldVal } = getFieldValue(
                        field,
                        fieldValues
                    );
                    const metadata = field.metadata;

                    const hover = {};
                    const select = {};
                    if (field.hover_border_color)
                        hover.borderColor = `#${field.hover_border_color} !important`;
                    if (field.hover_background_color)
                        hover.backgroundColor = `#${field.hover_background_color} !important`;
                    if (field.hover_font_color)
                        hover.color = `#${field.hover_font_color} !important`;
                    if (field.selected_border_color)
                        select.borderColor = `#${field.selected_border_color} !important`;
                    if (field.selected_background_color)
                        select.backgroundColor = `#${field.selected_background_color} !important`;
                    if (field.selected_font_color)
                        select.color = `#${field.selected_font_color} !important`;

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
                                marginBottom: '10px'
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
                                elementKeys: [servar.key],
                                trigger: 'click'
                            },
                            field.repeat || 0,
                            fieldValues
                        );

                    let controlElement;
                    switch (servar.type) {
                        case 'file_upload':
                            controlElement = (
                                <>
                                    {fieldLabel}
                                    <ReactForm.File
                                        id={reactFriendlyKey(field)}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleValueChange(
                                                    e.target.files[0],
                                                    servar.key,
                                                    index
                                                )
                                            );
                                        }}
                                        onClick={onClick}
                                        style={{
                                            cursor: 'pointer'
                                        }}
                                    />
                                </>
                            );
                            break;
                        case 'rich_file_upload':
                            controlElement = (
                                <RichFileUploader
                                    field={field}
                                    onChange={(e) => {
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(
                                                e.target.files[0],
                                                servar.key,
                                                index
                                            )
                                        );
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
                                    onChange={(e) => {
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(
                                                e.target.files,
                                                servar.key,
                                                index
                                            )
                                        );
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
                                    selectCSS={select}
                                    hoverCSS={hover}
                                />
                            );
                            break;
                        case 'checkbox':
                            controlElement = (
                                <>
                                    {fieldLabel}
                                    <ReactForm.Check
                                        type='checkbox'
                                        id={servar.key}
                                        checked={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center'
                                        }}
                                    />
                                </>
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
                                        fieldOnChange(
                                            [servar.key],
                                            handleChange(e, index)
                                        );
                                    }}
                                    selectCSS={select}
                                    hoverCSS={hover}
                                />
                            );
                            break;
                        case 'gmap_state':
                            controlElement = (
                                <GMapsStateDropdown
                                    field={field}
                                    fieldLabel={fieldLabel}
                                    fieldVal={fieldVal}
                                    onClick={onClick}
                                    onChange={(e) => {
                                        fieldOnChange(
                                            [servar.key],
                                            handleChange(e, index)
                                        );
                                    }}
                                    selectCSS={select}
                                    hoverCSS={hover}
                                />
                            );
                            break;
                        case 'email':
                            controlElement =
                                activeStep.component_type === 'bootstrap' ? (
                                    <BootstrapField
                                        label={fieldLabel}
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='email'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                        pattern="^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$"
                                    />
                                ) : (
                                    <MuiField
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='email'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                        pattern="^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$"
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
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(
                                                val,
                                                servar.key,
                                                index
                                            )
                                        );
                                    }}
                                    selectCSS={select}
                                    hoverCSS={hover}
                                />
                            );
                            break;
                        case 'phone_number':
                            controlElement = (
                                <MaskedBootstrapField
                                    key={reactFriendlyKey(field)}
                                    mask='+1 (000) 000-0000'
                                    unmask
                                    value={fieldVal}
                                    onClick={onClick}
                                    onAccept={(value) => {
                                        fieldRefs[servar.key].setCustomValidity(
                                            ''
                                        );
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(
                                                value,
                                                servar.key,
                                                index
                                            )
                                        );
                                    }}
                                    inputRef={(el) =>
                                        (fieldRefs[servar.key] = el)
                                    }
                                    label={fieldLabel}
                                    field={field}
                                    selectStyle={select}
                                    hoverStyle={hover}
                                    type='text'
                                />
                            );
                            break;
                        case 'ssn':
                            controlElement = (
                                <MaskedBootstrapField
                                    key={reactFriendlyKey(field)}
                                    mask='000 - 00 - 0000'
                                    unmask
                                    value={fieldVal}
                                    onClick={onClick}
                                    onAccept={(value) => {
                                        fieldRefs[servar.key].setCustomValidity(
                                            ''
                                        );
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(
                                                value,
                                                servar.key,
                                                index
                                            )
                                        );
                                    }}
                                    inputRef={(el) =>
                                        (fieldRefs[servar.key] = el)
                                    }
                                    label={fieldLabel}
                                    field={field}
                                    selectStyle={select}
                                    hoverStyle={hover}
                                    type='text'
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
                                    fieldOnChange={fieldOnChange}
                                    handleOtherStateChange={
                                        handleOtherStateChange
                                    }
                                    onClick={onClick}
                                    selectCSS={select}
                                    hoverCSS={hover}
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
                                        fieldOnChange(
                                            [servar.key],
                                            newVals ||
                                                handleValueChange(
                                                    e.target.value,
                                                    servar.key,
                                                    index
                                                )
                                        );
                                    }}
                                    handleOtherStateChange={
                                        handleOtherStateChange
                                    }
                                    onClick={onClick}
                                    selectCSS={select}
                                    hoverCSS={hover}
                                />
                            );
                            break;
                        case 'integer_field':
                            controlElement = (
                                <MaskedBootstrapField
                                    key={reactFriendlyKey(field)}
                                    mask={
                                        servar.format === 'currency'
                                            ? '$num'
                                            : 'num'
                                    }
                                    blocks={{
                                        num: {
                                            mask: Number,
                                            thousandsSeparator: ','
                                        }
                                    }}
                                    scale={0}
                                    signed={false}
                                    thousandsSeparator=','
                                    unmask
                                    value={fieldVal.toString()}
                                    onClick={onClick}
                                    onAccept={(value) => {
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(
                                                value,
                                                servar.key,
                                                index
                                            )
                                        );
                                    }}
                                    inputRef={(el) =>
                                        (fieldRefs[servar.key] = el)
                                    }
                                    label={fieldLabel}
                                    field={field}
                                    selectStyle={select}
                                    hoverStyle={hover}
                                    type='text'
                                />
                            );
                            break;
                        case 'hex_color':
                            controlElement = (
                                <>
                                    {fieldLabel}
                                    <div
                                        css={{
                                            width: '36px',
                                            height: '36px',
                                            background: `#${fieldVal}`,
                                            cursor: 'pointer',
                                            border: `${field.border_width}px solid`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
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
                                                    fieldOnChange(
                                                        [servar.key],
                                                        newValues
                                                    );
                                                }}
                                            />
                                        </div>
                                    ) : null}
                                </>
                            );
                            break;
                        case 'text_area':
                            controlElement =
                                activeStep.component_type === 'bootstrap' ? (
                                    <BootstrapField
                                        label={fieldLabel}
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='textarea'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                        rows={metadata.num_rows}
                                    />
                                ) : (
                                    <MuiField
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='text'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                        multiline
                                    />
                                );
                            break;
                        case 'url':
                            controlElement =
                                activeStep.component_type === 'bootstrap' ? (
                                    <BootstrapField
                                        label={fieldLabel}
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='url'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                    />
                                ) : (
                                    <MuiField
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='url'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                    />
                                );
                            break;
                        default:
                            controlElement =
                                activeStep.component_type === 'bootstrap' ? (
                                    <MaskedBootstrapField
                                        id={servar.key}
                                        key={reactFriendlyKey(field)}
                                        mask={
                                            servar.metadata.only_alpha
                                                ? /^[a-z0-9]*$/i
                                                : /.*/
                                        }
                                        unmask
                                        value={fieldVal}
                                        onClick={onClick}
                                        onAccept={(value) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleValueChange(
                                                    value,
                                                    servar.key,
                                                    index
                                                )
                                            );
                                        }}
                                        inputRef={(el) =>
                                            (fieldRefs[servar.key] = el)
                                        }
                                        label={fieldLabel}
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='text'
                                    />
                                ) : (
                                    <MuiField
                                        field={field}
                                        selectStyle={select}
                                        hoverStyle={hover}
                                        type='text'
                                        fieldValue={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e, index)
                                            );
                                        }}
                                        onClick={onClick}
                                    />
                                );
                    }
                    return (
                        <div
                            style={{
                                gridColumnStart: field.column_index + 1,
                                gridRowStart: field.row_index + 1,
                                gridColumnEnd: field.column_index_end + 2,
                                gridRowEnd: field.row_index_end + 2,
                                alignItems: field.layout,
                                color: `#${field.font_color}`,
                                fontStyle: field.font_italic
                                    ? 'italic'
                                    : 'normal',
                                fontWeight: field.font_weight,
                                fontFamily: field.font_family,
                                fontSize: `${field.font_size}px`,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: field.vertical_layout,
                                width: '100%',
                                ...(servar.type !== 'button_group'
                                    ? {
                                          paddingBottom: `${field.padding_bottom}px`,
                                          paddingTop: `${field.padding_top}px`,
                                          paddingLeft: `${field.padding_left}px`,
                                          paddingRight: `${field.padding_right}px`
                                      }
                                    : {})
                            }}
                            key={reactFriendlyKey(field)}
                        >
                            {controlElement}
                        </div>
                    );
                })}
            {!displaySteps && (
                <GooglePlaces
                    googleKey={integrations['google-maps']}
                    activeStep={activeStep}
                    steps={steps}
                    setFieldValues={setFieldValues}
                    onChange={fieldOnChange}
                    setNoChange={setNoChange}
                />
            )}
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
