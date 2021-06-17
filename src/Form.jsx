import React, { useEffect, useRef, useState } from 'react';

import ProgressBar from 'react-bootstrap/ProgressBar';
import ReactForm from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';
import TagManager from 'react-gtm-module';
import { BrowserRouter, Route, useHistory } from 'react-router-dom';

import { BootstrapField, MaskedBootstrapField } from './components/Bootstrap';
import { MuiField, MuiProgress } from './components/MaterialUI';
import Client from './utils/client';
import {
    calculateDimensions,
    formatAllStepFields,
    formatStepFields,
    getABVariant,
    getDefaultFieldValues,
    nextStepKey,
    getOrigin,
    recurseDepth,
    states
} from './utils/formHelperFunctions';

import GooglePlaces from './components/GooglePlaces';
import Text from './fields/Text';
import { initInfo } from './utils/init';

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
    const [activeStep, setActiveStep] = useState(
        steps ? steps[displayStepKey] : null
    );
    const [fieldValues, setFieldValues] = useState(initialValues);
    const [otherSelect, setOtherSelect] = useState({});

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [dimensions, setDimensions] = useState({
        width: null,
        rows: [],
        columns: []
    });
    const [curDepth, setCurDepth] = useState(displaySteps ? 1 : 0);
    const [maxDepth, setMaxDepth] = useState(
        displaySteps ? Object.keys(displaySteps).length : 0
    );
    const [integrations, setIntegrations] = useState({});
    const [noChange, setNoChange] = useState(false);
    const [stepSequence, setStepSequence] = useState([]);

    const fieldRefs = useRef({}).current;
    const formRef = useRef(null);

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
                if (
                    servar.metadata.allow_custom_options &&
                    servar.key in newFieldOptions
                ) {
                    servar.metadata.options = newFieldOptions[servar.key];
                }
            });
        });
        setSteps(JSON.parse(JSON.stringify(stepData)));

        const newActiveStep = activeStepData || activeStep;
        newActiveStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (
                servar.metadata.allow_custom_options &&
                servar.key in newFieldOptions
            ) {
                servar.metadata.options = newFieldOptions[servar.key];
            }
        });
        setActiveStep(JSON.parse(JSON.stringify(newActiveStep)));
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

        const [curDepth, maxDepth] = recurseDepth(
            stepsArg,
            getOrigin(stepsArg),
            newKey
        );
        setCurDepth(curDepth);
        setMaxDepth(maxDepth);

        const newStep = JSON.parse(JSON.stringify(stepsArg[newKey]));
        calculateDimensions(
            newStep,
            stepsArg,
            fieldValuesArg,
            dimensions,
            setDimensions,
            setFormDimensions
        );

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
                    userId: userKey,
                    lastStep: stepsArg[newKey].next_conditions.length === 0,
                    setValues: (userVals) => {
                        updateFieldValues(userVals, fieldValuesArg);
                        clientArg.submitCustom(userVals);
                    },
                    setOptions: updateFieldOptions(stepsArg, newStep),
                    integrationData: null
                });
            }
            clientArg.registerEvent({ step_key: newKey, event: 'load' });
        }

        setActiveStep(newStep);
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
                        Object.entries(session.file_urls).forEach(
                            ([fileKey, fileURL]) => {
                                clientInstance
                                    .fetchFile(fileURL)
                                    .then((fileData) => {
                                        setFileFieldValue(fileKey, fileData);
                                    });
                            }
                        );

                        setStepSequence(session.step_sequence);
                        setIntegrations(session.integrations);
                        const gtm = session.integrations['google-tag-manager'];
                        if (gtm) TagManager.initialize({ gtmId: gtm });

                        fetchPromise.then(async (data) => {
                            const newValues = updateFieldValues(
                                session.field_values,
                                getDefaultFieldValues(data)
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

    const handleChange = (e) => {
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
            updateValues[servar.key] = value;
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
                    updateValues[servar.key] = '';
                }
            });
        }
        return updateFieldValues(updateValues);
    };

    const handleValueChange = (value, id) => {
        return handleChange({ target: { type: '', value, id } });
    };

    const handleButtonGroupChange = (e) => {
        const fieldKey = e.target.id;

        let newValues = null;
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== fieldKey) return;

            newValues = updateFieldValues({
                [servar.key]: e.target.textContent
            });
        });
        return newValues;
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

    const handleMultiselectChange = (servarKey) => (e) => {
        const target = e.target;
        const opt = target.name;
        let newValues = null;
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return;

            let val = fieldValues[servar.key];
            if (target.checked) val.push(opt);
            else val = val.filter((val) => val !== opt);
            newValues = updateFieldValues({ [servar.key]: val });
        });
        return newValues;
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
            const formattedFields = formatStepFields(activeStep, newFieldVals);

            Object.entries(formattedFields).map(
                ([fieldKey, { value, type }]) => {
                    const element = formRef.current.elements[fieldKey];
                    if (element) {
                        if (type === 'phone_number' && value.length !== 10) {
                            element.setCustomValidity('Invalid phone number');
                        } else if (type === 'ssn' && value.length !== 9) {
                            element.setCustomValidity(
                                'Invalid social security number'
                            );
                        }
                    }
                }
            );
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
                    stepSequence
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
                        Object.entries(errors).forEach(
                            ([fieldKey, message]) => {
                                const element =
                                    formRef.current.elements[fieldKey];
                                if (element) element.setCustomValidity(message);
                            }
                        );
                    },
                    integrationData: null
                });
            }
            // do validation check in case user has manually invalidated the step
            formRef.current.reportValidity();
            if (!formRef.current.checkValidity()) return;

            const featheryFields = Object.entries(formattedFields).map(
                ([key, val]) => {
                    return { key, [val.type]: val.value };
                }
            );
            client.submitStep(featheryFields);
        }

        const { newStepKey, newSequence } = nextStepKey(
            activeStep.next_conditions,
            metadata,
            steps,
            newFieldVals,
            stepSequence
        );

        const eventData = {
            step_key: activeStep.key,
            next_step_key: newStepKey ?? '',
            event: submitData ? 'complete' : 'skip'
        };
        if (newSequence !== stepSequence) {
            setStepSequence(newSequence);
            eventData.step_sequence = newSequence;
        }
        client.registerEvent(eventData);

        if (!newStepKey) {
            if (
                submitData ||
                ['button', 'text'].includes(metadata.elementType)
            ) {
                setFinishConfig({
                    finished: true,
                    redirectURL: activeStep.redirect_url
                });
            }
        } else {
            const newURL =
                location.pathname + location.search + `#${newStepKey}`;
            if (['button', 'text'].includes(metadata.elementType))
                history.push(newURL);
            else history.replace(newURL);
            await getNewStep(newStepKey, steps, newFieldVals);
        }
    };

    const fieldOnChange = (
        fieldKeys,
        newValues,
        trigger = 'field',
        integrationData = null
    ) => {
        if (noChange) {
            return;
        }

        // For each field that changed, reset its validity
        fieldKeys.forEach((fieldKey) => {
            const element = formRef.current.elements[fieldKey];
            if (element) {
                element.setCustomValidity('');
            }
        });

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

    let isFilled = true;
    for (const field of activeStep.servar_fields) {
        const servar = field.servar;
        if (!servar.required) continue;
        const value = fieldValues[servar.key];
        switch (servar.type) {
            case 'select':
                if (!value) isFilled = false;
                break;
            case 'file_upload':
                if (!value) isFilled = false;
                break;
            case 'checkbox':
                // eslint-disable-next-line camelcase
                if (!value && servar.metadata?.must_check) isFilled = false;
                break;
            default:
                if (value === '') isFilled = false;
                break;
        }
    }

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
            {activeStep.progress_bar && (
                <div
                    css={{
                        gridColumnStart:
                            activeStep.progress_bar.column_index + 1,
                        gridRowStart: activeStep.progress_bar.row_index + 1,
                        gridColumnEnd:
                            activeStep.progress_bar.column_index_end + 2,
                        gridRowEnd: activeStep.progress_bar.row_index_end + 2,
                        alignItems: activeStep.progress_bar.layout,
                        justifyContent: activeStep.progress_bar.vertical_layout,
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
            {activeStep.images.map((image, i) => (
                <div
                    key={`image-${i}`}
                    css={{
                        gridColumnStart: image.column_index + 1,
                        gridRowStart: image.row_index + 1,
                        gridColumnEnd: image.column_index_end + 2,
                        gridRowEnd: image.row_index_end + 2,
                        paddingBottom: `${image.padding_bottom}px`,
                        paddingTop: `${image.padding_top}px`,
                        paddingLeft: `${image.padding_left}px`,
                        paddingRight: `${image.padding_right}px`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: image.layout,
                        justifyContent: image.vertical_layout
                    }}
                >
                    <img src={image.source_url} alt='Form Image' />
                </div>
            ))}
            {activeStep.text_fields.map((field, i) => (
                <Text
                    key={`text-${i}`}
                    field={field}
                    fieldValues={fieldValues}
                    conditions={activeStep.next_conditions}
                    displaySteps={displaySteps}
                    submit={submit}
                    isFilled={isFilled}
                />
            ))}
            {activeStep.servar_fields
                .sort((first, second) => {
                    if (first.row_index > second.row_index) return 1;
                    else if (first.row_index < second.row_index) return -1;
                    else return 0;
                })
                .map((field) => {
                    const servar = field.servar;
                    const fieldVal = fieldValues[servar.key];
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
                                        id={servar.key}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleValueChange(
                                                    e.target.files[0],
                                                    servar.key
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
                        case 'button_group':
                            controlElement = (
                                <>
                                    {fieldLabel}
                                    <div
                                        style={{
                                            display: 'flex',
                                            flexWrap: 'wrap',
                                            width: '100%',
                                            alignItems: field.layout,
                                            justifyContent:
                                                field.vertical_layout
                                        }}
                                    >
                                        {servar.metadata.options.map((opt) => {
                                            return (
                                                <div
                                                    id={servar.key}
                                                    onClick={(e) => {
                                                        const vals = handleButtonGroupChange(
                                                            e
                                                        );
                                                        onClick(e, true, vals);
                                                    }}
                                                    key={opt}
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent:
                                                            'center',
                                                        alignItems: 'center',
                                                        cursor: 'pointer',
                                                        height: `${field.field_height}${field.field_height_unit}`,
                                                        width: `${field.field_width}${field.field_width_unit}`,
                                                        backgroundColor: `#${field.background_color}`,
                                                        border: `${field.border_width}px solid`,
                                                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                                        marginBottom: `${field.padding_bottom}px`,
                                                        marginTop: `${field.padding_top}px`,
                                                        marginLeft: `${field.padding_left}px`,
                                                        marginRight: `${field.padding_right}px`,
                                                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`
                                                    }}
                                                    css={{
                                                        '&:active': select,
                                                        '&:hover': hover,
                                                        ...(fieldVal === opt
                                                            ? select
                                                            : {})
                                                    }}
                                                >
                                                    {opt}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
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
                                                handleChange(e)
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
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            border: `${field.border_width}px solid`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                            fontSize: `${field.font_size}px`,
                                            boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`
                                        }}
                                        css={{
                                            '&:focus': {
                                                boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                                                ...select
                                            },
                                            '&:hover': hover
                                        }}
                                        as='select'
                                        id={servar.key}
                                        value={fieldVal}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e)
                                            );
                                        }}
                                        onClick={onClick}
                                        custom
                                    >
                                        <option
                                            key=''
                                            value=''
                                            disabled
                                            style={{
                                                color: `#${metadata.placeholder_color}`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic'
                                                    : 'normal'
                                            }}
                                        >
                                            {metadata.placeholder ||
                                                'Select...'}
                                        </option>
                                        {servar.metadata.options.map(
                                            (option) => (
                                                <option
                                                    key={option}
                                                    value={option}
                                                >
                                                    {option}
                                                </option>
                                            )
                                        )}
                                    </ReactForm.Control>
                                </>
                            );
                            break;
                        case 'gmap_state':
                            controlElement = (
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            border: `${field.border_width}px solid`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                            fontSize: `${field.font_size}px`,
                                            boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`
                                        }}
                                        css={{
                                            '&:focus': {
                                                boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                                                ...select
                                            },
                                            '&:hover': hover
                                        }}
                                        as='select'
                                        id={servar.key}
                                        value={fieldVal}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(
                                                [servar.key],
                                                handleChange(e)
                                            );
                                        }}
                                        onClick={onClick}
                                        custom
                                    >
                                        <option
                                            key=''
                                            value=''
                                            disabled
                                            style={{
                                                color: `#${metadata.placeholder_color}`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic'
                                                    : 'normal'
                                            }}
                                        >
                                            {metadata.placeholder || 'State'}
                                        </option>
                                        {states.map((state) => (
                                            <option key={state} value={state}>
                                                {state}
                                            </option>
                                        ))}
                                    </ReactForm.Control>
                                </>
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
                                                handleChange(e)
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
                                                handleChange(e)
                                            );
                                        }}
                                        onClick={onClick}
                                        pattern="^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$"
                                    />
                                );
                            break;
                        case 'phone_number':
                            controlElement = (
                                <MaskedBootstrapField
                                    key={servar.key}
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
                                            handleValueChange(value, servar.key)
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
                                    key={servar.key}
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
                                            handleValueChange(value, servar.key)
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
                                <>
                                    {fieldLabel}
                                    {servar.metadata.options.map((opt) => {
                                        return (
                                            <ReactForm.Check
                                                type='checkbox'
                                                id={`${servar.key}-${opt}`}
                                                name={opt}
                                                key={opt}
                                                label={opt}
                                                checked={fieldVal.includes(opt)}
                                                onChange={(e) => {
                                                    const newValues = handleMultiselectChange(
                                                        servar.key
                                                    )(e);
                                                    fieldOnChange(
                                                        [servar.key],
                                                        newValues
                                                    );
                                                }}
                                                onClick={onClick}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    marginBottom: '5px'
                                                }}
                                            />
                                        );
                                    })}
                                    {servar.metadata.other && (
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <ReactForm.Check
                                                type='checkbox'
                                                id={`${servar.key}-`}
                                                name={otherVal}
                                                key={otherVal}
                                                label='Other'
                                                checked={fieldVal.includes(
                                                    otherVal
                                                )}
                                                onChange={(e) => {
                                                    const newValues = handleMultiselectChange(
                                                        servar.key
                                                    )(e);
                                                    fieldOnChange(
                                                        [servar.key],
                                                        newValues
                                                    );
                                                }}
                                                onClick={onClick}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                            />
                                            <ReactForm.Control
                                                type='text'
                                                style={{
                                                    marginLeft: '5px',
                                                    height: `${
                                                        parseInt(
                                                            field.font_size
                                                        ) + 4
                                                    }px`,
                                                    backgroundColor: `#${field.background_color}`,
                                                    border: `${field.border_width}px solid`,
                                                    borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                                                    color: `#${field.font_color}`,
                                                    fontStyle: field.font_italic
                                                        ? 'italic'
                                                        : 'normal',
                                                    fontWeight:
                                                        field.font_weight,
                                                    fontFamily:
                                                        field.font_family,
                                                    fontSize: `${field.font_size}px`
                                                }}
                                                css={{
                                                    '&:focus': {
                                                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                                                        ...select
                                                    },
                                                    '&:hover': hover
                                                }}
                                                id={servar.key}
                                                value={otherVal || ''}
                                                onChange={(e) => {
                                                    const newValues = handleOtherStateChange(
                                                        otherVal
                                                    )(e);
                                                    fieldOnChange(
                                                        [servar.key],
                                                        newValues
                                                    );
                                                }}
                                                onClick={onClick}
                                                maxLength={servar.max_length}
                                                minLength={servar.min_length}
                                            />
                                        </div>
                                    )}
                                </>
                            );
                            break;
                        case 'select':
                            controlElement = (
                                <>
                                    {fieldLabel}
                                    {servar.metadata.options.map((opt) => {
                                        return (
                                            <ReactForm.Check
                                                type='radio'
                                                id={`${servar.key}-${opt}`}
                                                label={opt}
                                                checked={fieldVal === opt}
                                                required={servar.required}
                                                onChange={(e) => {
                                                    fieldOnChange(
                                                        [servar.key],
                                                        handleValueChange(
                                                            e.target.value,
                                                            servar.key
                                                        )
                                                    );
                                                }}
                                                onClick={onClick}
                                                value={opt}
                                                key={opt}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    marginBottom: '5px'
                                                }}
                                            />
                                        );
                                    })}
                                    {servar.metadata.other && (
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <ReactForm.Check
                                                type='radio'
                                                id={`${servar.key}-`}
                                                label='Other'
                                                checked={
                                                    (otherSelect[servar.key] ||
                                                        fieldVal) &&
                                                    fieldVal === otherVal
                                                }
                                                onChange={(e) => {
                                                    setOtherSelect({
                                                        ...otherSelect,
                                                        [servar.key]: true
                                                    });
                                                    fieldOnChange(
                                                        [servar.key],
                                                        handleValueChange(
                                                            e.target.value,
                                                            servar.key
                                                        )
                                                    );
                                                }}
                                                onClick={onClick}
                                                value={otherVal || ''}
                                                key={otherVal}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center'
                                                }}
                                            />
                                            <ReactForm.Control
                                                type='text'
                                                style={{
                                                    marginLeft: '5px',
                                                    height: `${
                                                        parseInt(
                                                            field.font_size
                                                        ) + 4
                                                    }px`,
                                                    backgroundColor: `#${field.background_color}`,
                                                    border: `${field.border_width}px solid`,
                                                    borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                                                    color: `#${field.font_color}`,
                                                    fontStyle: field.font_italic
                                                        ? 'italic'
                                                        : 'normal',
                                                    fontWeight:
                                                        field.font_weight,
                                                    fontFamily:
                                                        field.font_family,
                                                    fontSize: `${field.font_size}px`
                                                }}
                                                css={{
                                                    '&:focus': {
                                                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                                                        ...select
                                                    },
                                                    '&:hover': hover
                                                }}
                                                id={servar.key}
                                                value={otherVal || ''}
                                                onChange={(e) => {
                                                    const newValues = handleOtherStateChange(
                                                        otherVal
                                                    )(e);
                                                    fieldOnChange(
                                                        [servar.key],
                                                        newValues
                                                    );
                                                }}
                                                onClick={onClick}
                                                maxLength={servar.max_length}
                                                minLength={servar.min_length}
                                            />
                                        </div>
                                    )}
                                </>
                            );
                            break;
                        case 'integer_field':
                            controlElement = (
                                <MaskedBootstrapField
                                    key={servar.key}
                                    mask={Number}
                                    scale={0}
                                    signed={false}
                                    thousandsSeparator=','
                                    unmask
                                    value={fieldVal.toString()}
                                    onClick={onClick}
                                    onAccept={(value) => {
                                        fieldOnChange(
                                            [servar.key],
                                            handleValueChange(value, servar.key)
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
                                                handleChange(e)
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
                                                handleChange(e)
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
                                                handleChange(e)
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
                                                handleChange(e)
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
                                        key={servar.key}
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
                                                    servar.key
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
                                                handleChange(e)
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
                            key={servar.key}
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
