import React, { useEffect, useState } from 'react';

import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import ReactForm from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';

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
    prevStepKey,
    getOrigin,
    recurseDepth
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
    displayStepKey = '',
    setFormDimensions = () => {}
}) {
    const [client, setClient] = useState(null);

    const [steps, setSteps] = useState(null);
    const [stepKey, setStepKey] = useState(displayStepKey);
    const [seenStepKeys, setSeenStepKeys] = useState(new Set());
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

    let activeStep = steps ? steps[stepKey] : null;

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

    const updateNewStepKey = (newStepKey, data = null) => {
        data = data || steps;
        activeStep = data[newStepKey];

        calculateDimensions(activeStep);
        setStepKey(newStepKey);
        setSeenStepKeys(new Set([...seenStepKeys, newStepKey]));

        const depth = recurseDepth(data, getOrigin(data), newStepKey);
        setCurDepth(depth);
        setMaxDepth(depth + recurseDepth(data, newStepKey));
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
                        updateFieldValues(
                            fieldValues,
                            getDefaultFieldValues(data)
                        );

                        setSteps(data);
                        const originKey = getOrigin(data);
                        updateNewStepKey(originKey, data);

                        // register that initial form step was loaded
                        clientInstance.registerEvent(originKey, 'load');
                        return [data, originKey];
                    })
                    .catch((error) => console.log(error));

                // fetch values separately because this request
                // goes to Feathery origin, while the previous
                // request goes to our CDN
                clientInstance
                    .fetchFormValues()
                    .then((vals) => {
                        fetchPromise.then(([data, originKey]) => {
                            const newFieldValues = updateFieldValues(
                                vals,
                                getDefaultFieldValues(data)
                            );

                            if (typeof onLoad === 'function') {
                                const formattedFields = formatAllStepFields(
                                    data,
                                    newFieldValues,
                                    acceptedFile
                                );
                                onLoad({
                                    fields: formattedFields,
                                    stepName: originKey,
                                    lastStep:
                                        data[originKey].next_conditions
                                            .length === 0,
                                    setValues: (userVals) =>
                                        updateFieldValues(
                                            userVals,
                                            newFieldValues
                                        ),
                                    setOptions: updateFieldOptions(steps)
                                });
                            }
                        });
                    })
                    .catch((error) => console.log(error));
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

    let linkStep = '';
    const submit = (action) => {
        if (!action) return;

        if (['next', 'skip'].includes(action)) {
            const allFields = formatAllStepFields(
                steps,
                fieldValues,
                acceptedFile
            );

            if (action === 'next') {
                const formattedFields = formatStepFields(
                    activeStep,
                    fieldValues,
                    acceptedFile
                );

                // Execute user-provided onSubmit function if present
                if (typeof onSubmit === 'function') {
                    onSubmit({
                        fields: allFields,
                        submitFields: formattedFields,
                        stepName: activeStep.key,
                        lastStep: activeStep.next_conditions.length === 0,
                        setValues: updateFieldValues,
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
            } else client.registerEvent(stepKey, 'user_skip');

            const newStepKey = nextStepKey(
                activeStep.next_conditions,
                linkStep,
                steps,
                fieldValues,
                acceptedFile,
                client,
                onLoad,
                updateFieldValues,
                updateFieldOptions
            );
            if (!newStepKey) {
                setFinishConfig({
                    finished: true,
                    redirectURL: activeStep.redirect_url
                });
            } else {
                updateNewStepKey(newStepKey);
            }
        } else if (action === 'back') {
            const newKey = prevStepKey(
                activeStep.previous_conditions,
                seenStepKeys
            );
            if (newKey) updateNewStepKey(newKey);
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
                if (!value) isFilled = false;
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
            const percent = Math.round((100 * curDepth) / (maxDepth + 1));
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
                    now={percent}
                />
            ];
            const completionPercentage = `${percent}% completed`;
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
                    curStep={curDepth}
                    maxStep={maxDepth + 1}
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
                if (form.checkValidity()) submit('next', form.linkStep);
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
                            disabled={field.link === 'next' && !isFilled}
                            type={
                                !displaySteps && field.link === 'next'
                                    ? 'submit'
                                    : undefined
                            }
                            onClick={() => {
                                if (!displaySteps) {
                                    if (field.link === 'next')
                                        linkStep = field.link_step;
                                    else submit(field.link);
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

                let controlElement;
                switch (servar.type) {
                    case 'file_upload':
                        controlElement = (
                            <>
                                {servar.name && (
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                )}
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
                                {servar.name && (
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                )}
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
                                {servar.name && (
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                )}
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
                                        '&::placeholder': {
                                            color: `#${metadata.placeholder_color} !important`,
                                            fontStyle: metadata.placeholder_italic
                                                ? 'italic !important'
                                                : 'normal !important'
                                        }
                                    }}
                                    as='select'
                                    id={servar.key}
                                    value={fieldVal}
                                    required={servar.required}
                                    onChange={handleChange}
                                    custom
                                >
                                    <option key='' value='' disabled>
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
                                    {servar.name && (
                                        <label
                                            htmlFor={servar.key}
                                            style={{
                                                marginBottom: '10px'
                                            }}
                                        >
                                            {servar.name}
                                        </label>
                                    )}
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
                                {servar.name && (
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                )}
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
                                            onChange={handleOtherStateChange(
                                                otherVal
                                            )}
                                        />
                                    </div>
                                )}
                            </>
                        );
                        break;
                    case 'select':
                        controlElement = (
                            <>
                                {servar.name && (
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                )}
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
                                            onChange={handleChange}
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
                                            onChange={handleOtherStateChange(
                                                otherVal
                                            )}
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
                                    {servar.name && (
                                        <label
                                            htmlFor={servar.key}
                                            style={{
                                                marginBottom: '10px'
                                            }}
                                        >
                                            {servar.name}
                                        </label>
                                    )}
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
                                {servar.name && (
                                    <label
                                        htmlFor={servar.key}
                                        style={{
                                            marginBottom: '10px'
                                        }}
                                    >
                                        {servar.name}
                                    </label>
                                )}
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
                                    {servar.name && (
                                        <label
                                            htmlFor={servar.key}
                                            style={{
                                                marginBottom: '10px'
                                            }}
                                        >
                                            {servar.name}
                                        </label>
                                    )}
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
                                    onChange={handleChange}
                                    multiline
                                />
                            );
                        break;
                    case 'url':
                        controlElement =
                            activeStep.component_type === 'bootstrap' ? (
                                <>
                                    {servar.name && (
                                        <label
                                            htmlFor={servar.key}
                                            style={{
                                                marginBottom: '10px'
                                            }}
                                        >
                                            {servar.name}
                                        </label>
                                    )}
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
                                    {servar.name && (
                                        <label
                                            htmlFor={servar.key}
                                            style={{
                                                marginBottom: '10px'
                                            }}
                                        >
                                            {servar.name}
                                        </label>
                                    )}
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
