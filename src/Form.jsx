import React, { useEffect, useState } from 'react';

import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import ReactForm from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';

import { MuiField, MuiProgress } from './components/MaterialUI';
import Client from './utils/client';
import {
    adjustColor,
    arrayFormatFields,
    calculateDimensionsHelper,
    getABVariant,
    getDefaultFieldValues,
    setConditionalIndex
} from './utils/formHelperFunctions';

import './bootstrap-iso.css';

// apiKey and userKey are required if displayStep === null
// totalSteps is required if displayStep !== null
export default function Form({
    // Public API
    formKey,
    onLoad = null,
    onSubmit = null,
    onValidate = null,
    initialValues = {},
    style = {},
    className = '',
    children,

    // Internal
    displaySteps = null,
    displayStepIndex = 0,
    setFormDimensions = () => {}
}) {
    const [client, setClient] = useState(null);

    const [stepCache, setStepCache] = useState(null);
    const [stepIndexCache, setStepIndexCache] = useState(displayStepIndex);
    const [steps, setSteps] = useState(displaySteps);
    const [stepIndex, setStepIndex] = useState(displayStepIndex);
    const [fieldValues, setFieldValues] = useState(initialValues);

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [otherVals, setOtherVals] = useState({});
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [acceptedFile, setAcceptedFile] = useState(null);
    const [dimensions, setDimensions] = useState({
        width: null,
        rows: [],
        columns: []
    });

    let activeStep = steps && steps.length > 0 ? steps[stepIndex] : null;

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

    const setInitialOtherState = (step) => {
        const newOtherVals = {};
        step.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.metadata.other) {
                let otherVal = '';
                const fieldVal = fieldValues[servar.key];
                if (servar.type === 'multiselect') {
                    const newFieldVal = fieldVal.map((selectedVal) => {
                        if (!servar.metadata.options.includes(selectedVal)) {
                            otherVal = selectedVal;
                            return '';
                        } else return selectedVal;
                    });
                    updateFieldValues({ [servar.key]: newFieldVal });
                } else if (servar.type === 'select') {
                    if (
                        fieldVal !== null &&
                        !servar.metadata.options.includes(fieldVal)
                    ) {
                        otherVal = fieldVal;
                        updateFieldValues({ [servar.key]: '' });
                    }
                }
                newOtherVals[field.servar.key] = otherVal;
            }
        });
        setOtherVals(newOtherVals);
        return newOtherVals;
    };

    const updateNewIndex = (newIndex, data = null) => {
        data = data || steps;
        if (newIndex >= data.length) {
            setFinishConfig({
                finished: true,
                redirectURL: activeStep.redirect_url
            });
        } else {
            activeStep = data[newIndex];
            setInitialOtherState(activeStep);
            calculateDimensions(activeStep);
            setStepIndex(newIndex);
        }
    };

    useEffect(() => {
        if (displaySteps === null) {
            if (client === null) {
                const clientInstance = new Client(formKey);
                setClient(clientInstance);

                const fetchPromise = clientInstance
                    .fetchForm()
                    .then((stepsResponse) => {
                        const data = getABVariant(stepsResponse);
                        if (data.length === 0) {
                            setFinishConfig({
                                finished: true,
                                redirectURL: stepsResponse.redirect_url
                            });
                        } else {
                            // render form without values first for speed
                            setSteps(data);

                            // register that form was loaded
                            clientInstance.registerEvent(0, 'load');

                            updateFieldValues(
                                fieldValues,
                                getDefaultFieldValues(data)
                            );
                            setInitialOtherState(data[stepIndex]);
                            calculateDimensions(data[stepIndex]);
                        }
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
                            const newFieldValues = updateFieldValues(
                                vals,
                                getDefaultFieldValues(data)
                            );
                            const newIndex = setConditionalIndex(
                                stepIndex,
                                vals,
                                data,
                                clientInstance
                            );
                            updateNewIndex(newIndex, data);
                            if (newIndex < data.length) {
                                const newStep = data[newIndex];
                                const newOtherVals = setInitialOtherState(
                                    newStep
                                );
                                calculateDimensions(newStep);
                                if (typeof onLoad === 'function') {
                                    const arrayFields = arrayFormatFields(
                                        newStep,
                                        newFieldValues,
                                        newOtherVals,
                                        acceptedFile
                                    );
                                    onLoad({
                                        fields: arrayFields,
                                        stepName: newStep.key,
                                        stepNumber: newIndex,
                                        lastStep: newIndex === data.length - 1,
                                        setValues: (userVals) =>
                                            updateFieldValues(
                                                userVals,
                                                newFieldValues
                                            )
                                    });
                                }
                            }
                        });
                    })
                    .catch((error) => console.log(error));
            }
        } else if (
            JSON.stringify(displaySteps) !== JSON.stringify(stepCache) ||
            displayStepIndex !== stepIndexCache
        ) {
            updateFieldValues(getDefaultFieldValues(displaySteps));
            const newStep = displaySteps[displayStepIndex];
            setInitialOtherState(newStep);
            setStepCache(JSON.parse(JSON.stringify(displaySteps)));
            setSteps(displaySteps);
            setStepIndexCache(displayStepIndex);
            setStepIndex(displayStepIndex);
            calculateDimensions(newStep);
        }
    }, [
        client,
        displayStepIndex,
        displaySteps,
        stepCache,
        stepIndexCache,
        calculateDimensions,
        setInitialOtherState,
        setClient,
        setStepCache,
        setSteps,
        setStepIndexCache,
        setStepIndex,
        getDefaultFieldValues,
        updateFieldValues
    ]);

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
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== key) return;

            if (servar.type === 'integer_field') value = parseInt(value);
            updateFieldValues({ [servar.key]: value });
        });
    };

    const handleOtherStateChange = (e) => {
        const target = e.target;
        setOtherVals({ ...otherVals, [target.id]: target.value });
    };

    const handleMultiselectChange = (servarKey) => (e) => {
        const target = e.target;
        const opt = target.name;
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return;

            let val = fieldValues[servar.key];
            if (target.checked) val.push(opt);
            else val = val.filter((val) => val !== opt);
            updateFieldValues({ [servar.key]: val });
        });
    };

    const handleColorChange = (servarKey) => (color) => {
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return;
            updateFieldValues({ [servar.key]: color.hex.substr(1, 6) });
        });
    };

    const handleColorPickerClick = (servarKey) => () => {
        const curVal = displayColorPicker[servarKey];
        setDisplayColorPicker({
            ...displayColorPicker,
            [servarKey]: !curVal
        });
    };

    const submit = (action) => {
        if (!action) return;

        const arrayFields = arrayFormatFields(
            activeStep,
            fieldValues,
            otherVals,
            acceptedFile
        );
        const noFileFields = arrayFields.filter(
            (field) => field.type !== 'file_upload'
        );
        const featheryFields = noFileFields.map((field) => {
            return { key: field.key, [field.type]: field.value };
        });

        if (['next', 'skip'].includes(action)) {
            if (action === 'next') {
                // Execute user-provided onSubmit function if present
                if (typeof onSubmit === 'function') {
                    onSubmit({
                        fields: arrayFields,
                        stepName: activeStep.key,
                        stepNumber: stepIndex,
                        lastStep: stepIndex === steps.length - 1,
                        setValues: updateFieldValues
                    });
                }
                client.submitStep(featheryFields);
                client.registerEvent(stepIndex, 'complete');
            } else client.registerEvent(stepIndex, 'user_skip');

            const newIndex = setConditionalIndex(
                stepIndex + 1,
                fieldValues,
                steps,
                client
            );
            updateNewIndex(newIndex);
            if (typeof onLoad === 'function' && newIndex < steps.length) {
                onLoad({
                    fields: arrayFields,
                    stepName: activeStep.key,
                    stepNumber: newIndex,
                    lastStep: newIndex === steps.length - 1,
                    setValues: updateFieldValues
                });
            }
        } else if (action === 'back') {
            updateNewIndex(stepIndex - 1);
        }
    };

    if (!activeStep) return null;

    let isFilled = true;
    for (const field of activeStep.servar_fields) {
        const servar = field.servar;
        if (!servar.required) continue;
        const value = fieldValues[servar.key];
        switch (servar.type) {
            case 'email':
                if (value === '') isFilled = false;
                break;
            case 'text_area':
                if (value === '') isFilled = false;
                break;
            case 'text_field':
                if (value === '') isFilled = false;
                break;
            case 'select':
                if (value === null || (value === '' && !otherVals[servar.key]))
                    isFilled = false;
                break;
            case 'dropdown':
                if (value === '') isFilled = false;
                break;
            case 'file_upload':
                if (acceptedFile === null) isFilled = false;
                break;
            case 'url':
                if (value === '') isFilled = false;
                break;
            default:
                break;
        }
    }

    let progressBarElements = null;
    if (activeStep.progress_bar) {
        if (activeStep.component_type === 'bootstrap') {
            progressBarElements = [
                <ProgressBar
                    key='progress'
                    style={{
                        height: '0.4rem',
                        width: `${activeStep.progress_bar.bar_width}%`,
                        maxWidth: '100%'
                    }}
                    css={{
                        '.progress-bar': {
                            margin: '0 0 0 0 !important',
                            backgroundColor: `#${activeStep.progress_bar.bar_color} !important`
                        }
                    }}
                    now={(stepIndex / steps.length) * 100}
                />
            ];
            const completionPercentage = `${Math.round(
                (stepIndex / steps.length) * 100
            )}% completed`;
            if (activeStep.progress_bar.percent_text_layout === 'top') {
                progressBarElements.splice(0, 0, completionPercentage);
            } else if (
                activeStep.progress_bar.percent_text_layout === 'bottom'
            ) {
                progressBarElements.splice(1, 0, completionPercentage);
            }
        } else {
            progressBarElements = [
                <MuiProgress
                    key='progress'
                    curStep={stepIndex}
                    maxStep={steps.length}
                    progressBar={activeStep.progress_bar}
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
                    const arrayFields = arrayFormatFields(
                        activeStep,
                        fieldValues,
                        otherVals,
                        acceptedFile
                    );
                    const errors = onValidate({
                        fields: arrayFields,
                        stepName: activeStep.key,
                        stepNumber: stepIndex,
                        lastStep: stepIndex === steps.length - 1,
                        setValues: updateFieldValues
                    });
                    errors.forEach((err) => {
                        const [fieldKey, message] = err;
                        const element = form.elements[fieldKey];
                        if (element) element.setCustomValidity(message);
                    });
                    form.reportValidity();
                }
                if (form.checkValidity()) submit('next');
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
                    key={i.toString() + ':' + stepIndex.toString()}
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
                                borderColor: `#${field.button_color}`,
                                backgroundColor: `#${field.button_color}`,
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
                            disabled={field.link === 'next' && !isFilled}
                            type={
                                !displaySteps && field.link === 'next'
                                    ? 'submit'
                                    : undefined
                            }
                            onClick={() => {
                                if (!displaySteps && field.link !== 'next')
                                    submit(field.link);
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
                        >
                            {field.text}
                        </div>
                    )}
                </div>
            ))}
            {activeStep.servar_fields.map((field, i) => {
                const servar = field.servar;
                const fieldVal = fieldValues[servar.key];
                const metadata = field.metadata;
                let controlElement;

                switch (servar.type) {
                    case 'file_upload':
                        controlElement = (
                            <>
                                <label
                                    htmlFor={servar.key}
                                    style={{
                                        marginBottom: '10px'
                                    }}
                                >
                                    {servar.name}
                                </label>
                                <ReactForm.File
                                    id={servar.key}
                                    accept='image/*'
                                    required={servar.required}
                                    onChange={(e) => {
                                        setAcceptedFile(e.target.files[0]);
                                    }}
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
                                <label
                                    htmlFor={servar.key}
                                    style={{
                                        marginBottom: '10px'
                                    }}
                                >
                                    {servar.name}
                                </label>
                                <ReactForm.Check
                                    type='checkbox'
                                    id={servar.key}
                                    checked={fieldVal}
                                    onChange={handleChange}
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
                                <label
                                    htmlFor={servar.key}
                                    style={{
                                        marginBottom: '10px'
                                    }}
                                >
                                    {servar.name}
                                </label>
                                <ReactForm.Control
                                    style={{
                                        height: `${field.field_height}${field.field_height_unit}`,
                                        width: `${field.field_width}${field.field_width_unit}`,
                                        maxWidth: '100%',
                                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                    }}
                                    as='select'
                                    id={servar.key}
                                    value={fieldVal}
                                    required={servar.required}
                                    onChange={handleChange}
                                    custom
                                >
                                    <option key='' value='' disabled>
                                        Select...
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
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                    <ReactForm.Control
                                        type='email'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${field.metadata.placeholder_color} !important`,
                                                fontStyle: field.metadata
                                                    .placeholder_italic
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
                                        onChange={handleChange}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='email'
                                    onChange={handleChange}
                                />
                            );
                        break;
                    case 'multiselect':
                        controlElement = (
                            <>
                                <label
                                    htmlFor={servar.key}
                                    style={{
                                        marginBottom: '10px'
                                    }}
                                >
                                    {servar.name}
                                </label>
                                {servar.metadata.options.map((opt) => {
                                    return (
                                        <ReactForm.Check
                                            type='checkbox'
                                            id={servar.key}
                                            name={opt}
                                            key={opt}
                                            label={opt}
                                            checked={fieldVal.includes(opt)}
                                            onChange={handleMultiselectChange(
                                                servar.key
                                            )}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center'
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
                                            name=''
                                            key=''
                                            label='Other'
                                            checked={fieldVal.includes('')}
                                            onChange={handleMultiselectChange(
                                                servar.key
                                            )}
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
                                            value={otherVals[servar.key] || ''}
                                            onChange={handleOtherStateChange}
                                        />
                                    </div>
                                )}
                            </>
                        );
                        break;
                    case 'select':
                        controlElement = (
                            <>
                                <label
                                    htmlFor={servar.key}
                                    style={{
                                        marginBottom: '10px'
                                    }}
                                >
                                    {servar.name}
                                </label>
                                {servar.metadata.options.map((opt) => {
                                    return (
                                        <ReactForm.Check
                                            type='radio'
                                            id={servar.key}
                                            label={opt}
                                            checked={fieldVal === opt}
                                            required={servar.required}
                                            onChange={handleChange}
                                            value={opt}
                                            key={opt}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center'
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
                                            checked={fieldVal === ''}
                                            onChange={handleChange}
                                            value=''
                                            key=''
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
                                            value={otherVals[servar.key] || ''}
                                            onChange={handleOtherStateChange}
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
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                    <ReactForm.Control
                                        type='number'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${field.metadata.placeholder_color} !important`,
                                                fontStyle: field.metadata
                                                    .placeholder_italic
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
                                        onChange={handleChange}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='number'
                                    onChange={handleChange}
                                />
                            );
                        break;
                    case 'hex_color':
                        controlElement = (
                            <>
                                <label
                                    htmlFor={servar.key}
                                    style={{
                                        marginBottom: '10px'
                                    }}
                                >
                                    {servar.name}
                                </label>
                                <div
                                    css={{
                                        width: '36px',
                                        height: '36px',
                                        background: `#${fieldVal}`,
                                        cursor: 'pointer',
                                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                    }}
                                    onClick={handleColorPickerClick(servar.key)}
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
                                            onChange={handleColorChange(
                                                servar.key
                                            )}
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
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                    <ReactForm.Control
                                        as='textarea'
                                        rows={metadata.num_rows}
                                        id={servar.key}
                                        value={fieldVal}
                                        onChange={handleChange}
                                        placeholder={metadata.placeholder || ''}
                                        required={servar.required}
                                        style={{
                                            resize: 'none',
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${field.metadata.placeholder_color} !important`,
                                                fontStyle: field.metadata
                                                    .placeholder_italic
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
                                    onChange={handleChange}
                                    multiline
                                />
                            );
                        break;
                    case 'url':
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                    <ReactForm.Control
                                        type='url'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${field.metadata.placeholder_color} !important`,
                                                fontStyle: field.metadata
                                                    .placeholder_italic
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
                                        onChange={handleChange}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='url'
                                    onChange={handleChange}
                                />
                            );
                        break;
                    default:
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                    <ReactForm.Control
                                        type='text'
                                        style={{
                                            height: `${field.field_height}${field.field_height_unit}`,
                                            width: `${field.field_width}${field.field_width_unit}`,
                                            maxWidth: '100%',
                                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                        }}
                                        css={{
                                            '&::placeholder': {
                                                color: `#${field.metadata.placeholder_color} !important`,
                                                fontStyle: field.metadata
                                                    .placeholder_italic
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
                                        onChange={handleChange}
                                        placeholder={metadata.placeholder || ''}
                                    />
                                </>
                            ) : (
                                <MuiField
                                    servar={servar}
                                    field={field}
                                    type='text'
                                    onChange={handleChange}
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
