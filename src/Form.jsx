import React, { useEffect, useState } from 'react';

import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import ReactForm from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';
import { BrowserRouter, Route, useHistory } from 'react-router-dom';

import { MuiField, MuiProgress } from './components/MaterialUI';
import Client from './utils/client';
import {
    adjustColor,
    calculateDimensionsHelper,
    formatAllStepFields,
    formatStepFields,
    getABVariant,
    getDefaultFieldValues,
    nextStepKey,
    getOrigin,
    recurseDepth
} from './utils/formHelperFunctions';

import './bootstrap-iso.css';

// apiKey and userKey are required if displayStep === null
// totalSteps is required if displayStep !== null
function Form({
    // Public API
    formKey,
    onChange = null,
    onLoad = null,
    onSubmit = null,
    onValidate = null,
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
    const [stepKey, setStepKey] = useState(displayStepKey);
    const [fieldValues, setFieldValues] = useState(initialValues);

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [acceptedFile, setAcceptedFile] = useState(null);
    const [dimensions, setDimensions] = useState({
        width: null,
        rows: [],
        columns: []
    });
    const [curDepth, setCurDepth] = useState(displaySteps ? 1 : 0);
    const [maxDepth, setMaxDepth] = useState(
        displaySteps ? Object.keys(displaySteps).length : 0
    );

    const activeStep = steps ? steps[stepKey] : null;

    const calculateDimensions = calculateDimensionsHelper(
        dimensions,
        setDimensions,
        setFormDimensions
    );

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

    const updateFieldOptions = (stepData) => (newFieldOptions) => {
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

                        let newKey;
                        const hashKey = location.hash.substr(1);
                        if (hashKey in data) newKey = hashKey;
                        else {
                            newKey = getOrigin(data);
                            history.replace(
                                location.pathname +
                                    location.search +
                                    `#${newKey}`
                            );
                        }
                        setStepKey(newKey);

                        return data;
                    })
                    .catch((error) => console.log(error));

                // fetch values separately because this request
                // goes to Feathery origin, while the previous
                // request goes to our CDN
                clientInstance
                    .fetchFormValues()
                    .then((vals) => {
                        fetchPromise.then((data) => {
                            updateFieldValues(
                                vals,
                                getDefaultFieldValues(data)
                            );
                        });
                    })
                    .catch((error) => {
                        // Use default values if origin fails
                        fetchPromise.then((data) => {
                            updateFieldValues(
                                fieldValues,
                                getDefaultFieldValues(data)
                            );
                        });
                        console.log(error);
                    });
            }
        } else if (displaySteps !== steps || displayStepKey !== stepKey) {
            updateFieldValues(getDefaultFieldValues(displaySteps));
            setSteps(displaySteps);
            setStepKey(displayStepKey);
            calculateDimensions(displaySteps[displayStepKey]);
        }
    }, [
        client,
        displayStepKey,
        displaySteps,
        calculateDimensions,
        setClient,
        setSteps,
        setStepKey,
        getDefaultFieldValues,
        updateFieldValues
    ]);

    useEffect(() => {
        if (!steps) return;

        const depth = recurseDepth(steps, getOrigin(steps), stepKey);
        setCurDepth(depth);
        setMaxDepth(depth + recurseDepth(steps, stepKey));
        calculateDimensions(activeStep);

        if (!displaySteps) {
            if (typeof onLoad === 'function') {
                const formattedFields = formatAllStepFields(
                    steps,
                    fieldValues,
                    acceptedFile
                );
                onLoad({
                    fields: formattedFields,
                    stepName: stepKey,
                    lastStep: activeStep.next_conditions.length === 0,
                    setValues: (userVals) =>
                        updateFieldValues(userVals, fieldValues),
                    setOptions: updateFieldOptions(steps)
                });
            }
            client.registerEvent(stepKey, 'load');
        }
    }, [stepKey, displaySteps]);

    useEffect(() => {
        return history.listen(() => {
            const hashKey = location.hash.substr(1);
            if (hashKey in steps) setStepKey(hashKey);
        });
    }, [steps, setStepKey]);

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
        let newValues = null;
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== key) return;

            if (servar.type === 'integer_field') value = parseInt(value);
            newValues = updateFieldValues({ [servar.key]: value });
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

    let elementKey = '';
    const submit = (
        submitData,
        elementType,
        elementKey,
        trigger,
        newValues = null
    ) => {
        let newFieldVals = newValues || fieldValues;
        if (submitData) {
            const formattedFields = formatStepFields(
                activeStep,
                fieldValues,
                acceptedFile
            );

            // Execute user-provided onSubmit function if present
            if (typeof onSubmit === 'function') {
                const allFields = formatAllStepFields(
                    steps,
                    fieldValues,
                    acceptedFile
                );
                onSubmit({
                    fields: allFields,
                    submitFields: formattedFields,
                    stepName: activeStep.key,
                    lastStep: activeStep.next_conditions.length === 0,
                    setValues: (userVals) =>
                        (newFieldVals = updateFieldValues(
                            userVals,
                            newFieldVals
                        )),
                    setOptions: updateFieldOptions(steps)
                });
            }

            const featheryFields = Object.entries(formattedFields)
                .filter(([key, val]) => val.type !== 'file_upload')
                .map(([key, val]) => {
                    return { key, [val.type]: val.value };
                });
            client.submitStep(featheryFields);

            client.registerEvent(stepKey, 'complete');
        }

        const newStepKey = nextStepKey(
            activeStep.next_conditions,
            elementType,
            elementKey,
            trigger,
            steps,
            newFieldVals
        );
        if (!newStepKey) {
            if (elementType === 'button') {
                setFinishConfig({
                    finished: true,
                    redirectURL: activeStep.redirect_url
                });
            }
        } else {
            const newURL =
                location.pathname + location.search + `#${newStepKey}`;
            if (elementType === 'button') history.push(newURL);
            else history.replace(newURL);
            setStepKey(newStepKey);
        }
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
                if (acceptedFile === null) isFilled = false;
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
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();

                const form = event.currentTarget;
                // Execute user-provided checkValidity function if present
                if (typeof onValidate === 'function') {
                    const allFields = formatAllStepFields(
                        steps,
                        fieldValues,
                        acceptedFile
                    );
                    const formattedFields = formatStepFields(
                        activeStep,
                        fieldValues,
                        acceptedFile
                    );
                    const errors = onValidate({
                        fields: allFields,
                        submitFields: formattedFields,
                        stepName: activeStep.key,
                        lastStep: activeStep.next_conditions.length === 0,
                        setValues: updateFieldValues,
                        setOptions: updateFieldOptions(steps)
                    });
                    errors.forEach((err) => {
                        const [fieldKey, message] = err;
                        const element = form.elements[fieldKey];
                        if (element) element.setCustomValidity(message);
                    });
                    form.reportValidity();
                }
                if (form.checkValidity())
                    submit(true, 'button', elementKey, 'click');
            }}
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
            {activeStep.text_fields.map((field, i) => (
                <div
                    key={i.toString() + ':' + stepKey.toString()}
                    css={{
                        gridColumnStart: field.column_index + 1,
                        gridRowStart: field.row_index + 1,
                        gridColumnEnd: field.column_index_end + 2,
                        gridRowEnd: field.row_index_end + 2,
                        paddingBottom: `${field.padding_bottom}px`,
                        paddingTop: `${field.padding_top}px`,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: field.layout,
                        justifyContent: field.vertical_layout
                    }}
                >
                    {field.is_button ? (
                        <Button
                            style={{
                                cursor: field.link ? 'pointer' : 'default',
                                color: `#${field.font_color}`,
                                fontStyle: field.font_italic
                                    ? 'italic'
                                    : 'normal',
                                fontWeight: field.font_weight,
                                fontFamily: field.font_family,
                                fontSize: `${field.font_size}px`,
                                borderRadius: `${field.border_radius}px`,
                                borderColor: `#${field.border_color}`,
                                backgroundColor: `#${field.button_color}`,
                                boxShadow: 'none',
                                height: `${field.button_height}${field.button_height_unit}`,
                                width: `${field.button_width}${field.button_width_unit}`,
                                maxWidth: '100%'
                            }}
                            css={{
                                '&:disabled': { cursor: 'default !important' },
                                '&:hover:enabled': field.link
                                    ? {
                                          backgroundColor: `${adjustColor(
                                              field.button_color,
                                              -30
                                          )} !important`,
                                          borderColor: `${adjustColor(
                                              field.button_color,
                                              -30
                                          )} !important`,
                                          transition:
                                              'background 0.3s !important'
                                      }
                                    : {}
                            }}
                            disabled={
                                field.link === 'none' ||
                                (field.link === 'submit' && !isFilled)
                            }
                            type={
                                !displaySteps && field.link === 'submit'
                                    ? 'submit'
                                    : undefined
                            }
                            onClick={() => {
                                elementKey = field.text;
                                if (!displaySteps && field.link === 'skip') {
                                    submit(
                                        false,
                                        'button',
                                        elementKey,
                                        'click'
                                    );
                                }
                            }}
                            dangerouslySetInnerHTML={{
                                __html: field.text
                            }}
                        />
                    ) : (
                        <div
                            css={{
                                color: `#${field.font_color}`,
                                fontStyle: field.font_italic
                                    ? 'italic'
                                    : 'normal',
                                fontWeight: field.font_weight,
                                fontFamily: field.font_family,
                                fontSize: `${field.font_size}px`
                            }}
                            dangerouslySetInnerHTML={{
                                __html: field.text
                            }}
                        />
                    )}
                </div>
            ))}
            {activeStep.servar_fields.map((field, i) => {
                const servar = field.servar;
                const fieldVal = fieldValues[servar.key];
                const metadata = field.metadata;

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
                const onClick = () =>
                    submit(false, 'field', servar.key, 'click');
                const fieldOnChange = (newValues) => {
                    if (typeof onChange === 'function') {
                        const formattedFields = formatAllStepFields(
                            steps,
                            newValues,
                            acceptedFile
                        );
                        onChange({
                            changeKey: servar.key,
                            fields: formattedFields,
                            stepName: activeStep.key,
                            lastStep: activeStep.next_conditions.length === 0,
                            setValues: (userVals) =>
                                (newValues = updateFieldValues(
                                    userVals,
                                    newValues
                                )),
                            setOptions: updateFieldOptions(steps)
                        });
                    }
                    submit(false, 'field', servar.key, 'change', newValues);
                };

                let controlElement;
                switch (servar.type) {
                    case 'file_upload':
                        controlElement = (
                            <>
                                {fieldLabel}
                                <ReactForm.File
                                    id={servar.key}
                                    accept='image/*'
                                    required={servar.required}
                                    onChange={(e) => {
                                        setAcceptedFile(e.target.files[0]);
                                        fieldOnChange();
                                    }}
                                    onClick={onClick}
                                    style={{
                                        cursor: 'pointer'
                                    }}
                                />
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
                                        fieldOnChange(handleChange(e));
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
                                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                        fontSize: `${field.font_size}px`
                                    }}
                                    css={{
                                        '&:focus': {
                                            boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                        }
                                    }}
                                    as='select'
                                    id={servar.key}
                                    value={fieldVal}
                                    required={servar.required}
                                    onChange={(e) => {
                                        fieldOnChange(handleChange(e));
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
                                        {metadata.placeholder || 'Select...'}
                                    </option>
                                    {servar.metadata.options.map((option) => (
                                        <option key={option}>{option}</option>
                                    ))}
                                </ReactForm.Control>
                            </>
                        );
                        break;
                    case 'email':
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        type='email'
                                        pattern="^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$"
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${metadata.placeholder_color} !important`,
                                                fontSize: `${field.font_size}px`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic !important'
                                                    : 'normal !important'
                                            },
                                            '&:focus': {
                                                boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                            }
                                        }}
                                        id={servar.key}
                                        value={fieldVal}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(handleChange(e));
                                        }}
                                        onClick={onClick}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='email'
                                    onChange={(e) => {
                                        fieldOnChange(handleChange(e));
                                    }}
                                    onClick={onClick}
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
                                            id={servar.key}
                                            name={opt}
                                            key={opt}
                                            label={opt}
                                            checked={fieldVal.includes(opt)}
                                            onChange={(e) => {
                                                const newValues = handleMultiselectChange(
                                                    servar.key
                                                )(e);
                                                fieldOnChange(newValues);
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
                                            id={servar.key}
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
                                                fieldOnChange(newValues);
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
                                                    field.font_size + 4
                                                }px`,
                                                backgroundColor: `#${field.background_color}`,
                                                borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                                color: `#${field.font_color}`,
                                                fontStyle: field.font_italic
                                                    ? 'italic'
                                                    : 'normal',
                                                fontWeight: field.font_weight,
                                                fontFamily: field.font_family,
                                                fontSize: `${field.font_size}px`
                                            }}
                                            css={{
                                                '&:focus': {
                                                    boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                                }
                                            }}
                                            id={servar.key}
                                            value={otherVal}
                                            onChange={(e) => {
                                                const newValues = handleOtherStateChange(
                                                    otherVal
                                                )(e);
                                                fieldOnChange(newValues);
                                            }}
                                            onClick={onClick}
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
                                            id={servar.key}
                                            label={opt}
                                            checked={fieldVal === opt}
                                            required={servar.required}
                                            onChange={(e) => {
                                                fieldOnChange(handleChange(e));
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
                                            id={servar.key}
                                            label='Other'
                                            checked={fieldVal === otherVal}
                                            onChange={(e) => {
                                                fieldOnChange(handleChange(e));
                                            }}
                                            onClick={onClick}
                                            value={otherVal}
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
                                                    field.font_size + 4
                                                }px`,
                                                backgroundColor: `#${field.background_color}`,
                                                borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                                color: `#${field.font_color}`,
                                                fontStyle: field.font_italic
                                                    ? 'italic'
                                                    : 'normal',
                                                fontWeight: field.font_weight,
                                                fontFamily: field.font_family,
                                                fontSize: `${field.font_size}px`
                                            }}
                                            css={{
                                                '&:focus': {
                                                    boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                                }
                                            }}
                                            id={servar.key}
                                            value={otherVal}
                                            onChange={(e) => {
                                                const newValues = handleOtherStateChange(
                                                    otherVal
                                                )(e);
                                                fieldOnChange(newValues);
                                            }}
                                            onClick={onClick}
                                        />
                                    </div>
                                )}
                            </>
                        );
                        break;
                    case 'integer_field':
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        type='number'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${metadata.placeholder_color} !important`,
                                                fontSize: `${field.font_size}px`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic !important'
                                                    : 'normal !important'
                                            },
                                            '&:focus': {
                                                boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                            }
                                        }}
                                        id={servar.key}
                                        value={fieldVal}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(handleChange(e));
                                        }}
                                        onClick={onClick}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='number'
                                    onChange={(e) => {
                                        fieldOnChange(handleChange(e));
                                    }}
                                    onClick={onClick}
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
                                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                    }}
                                    onClick={(e) => {
                                        onClick(e);
                                        handleColorPickerClick(servar.key)();
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
                                                fieldOnChange(newValues);
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
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        as='textarea'
                                        rows={metadata.num_rows}
                                        id={servar.key}
                                        value={fieldVal}
                                        onChange={(e) => {
                                            fieldOnChange(handleChange(e));
                                        }}
                                        onClick={onClick}
                                        placeholder={metadata.placeholder || ''}
                                        required={servar.required}
                                        style={{
                                            resize: 'none',
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${metadata.placeholder_color} !important`,
                                                fontSize: `${field.font_size}px`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic !important'
                                                    : 'normal !important'
                                            },
                                            '&:focus': {
                                                boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                            }
                                        }}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='text'
                                    onChange={(e) => {
                                        fieldOnChange(handleChange(e));
                                    }}
                                    onClick={onClick}
                                    multiline
                                />
                            );
                        break;
                    case 'url':
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        type='url'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${metadata.placeholder_color} !important`,
                                                fontSize: `${field.font_size}px`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic !important'
                                                    : 'normal !important'
                                            },
                                            '&:focus': {
                                                boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                            }
                                        }}
                                        id={servar.key}
                                        value={fieldVal}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(handleChange(e));
                                        }}
                                        onClick={onClick}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='url'
                                    onChange={(e) => {
                                        fieldOnChange(handleChange(e));
                                    }}
                                    onClick={onClick}
                                />
                            );
                        break;
                    default:
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    {fieldLabel}
                                    <ReactForm.Control
                                        type='text'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            backgroundColor: `#${field.background_color}`,
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${metadata.placeholder_color} !important`,
                                                fontSize: `${field.font_size}px`,
                                                fontStyle: metadata.placeholder_italic
                                                    ? 'italic !important'
                                                    : 'normal !important'
                                            },
                                            '&:focus': {
                                                boxShadow: `0 0 0 0.2rem #${field.focus_color} !important`
                                            }
                                        }}
                                        id={servar.key}
                                        value={fieldVal || ''}
                                        required={servar.required}
                                        onChange={(e) => {
                                            fieldOnChange(handleChange(e));
                                        }}
                                        onClick={onClick}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='text'
                                    onChange={(e) => {
                                        fieldOnChange(handleChange(e));
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
                            paddingBottom: `${field.padding_bottom}px`,
                            paddingTop: `${field.padding_top}px`,
                            alignItems: field.layout,
                            color: `#${field.font_color}`,
                            fontStyle: field.font_italic ? 'italic' : 'normal',
                            fontWeight: field.font_weight,
                            fontFamily: field.font_family,
                            fontSize: `${field.font_size}px`,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: field.vertical_layout,
                            width: '100%'
                        }}
                        key={i}
                    >
                        {controlElement}
                    </div>
                );
            })}
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
