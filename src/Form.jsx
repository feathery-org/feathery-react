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
    setFieldValues
} from './utils/formHelperFunctions';
import { fieldState } from './Fields';

import './bootstrap-iso.css';

// apiKey and userKey are required if displayStep === null
// totalSteps is required if displayStep !== null
export default function Form({
    // Public API
    formKey,
    onSubmit = null,
    checkValidity = () => [],
    style = {},
    className = '',
    children,

    // Internal
    displaySteps = null,
    displayStepIndex = 0,
    setFormDimensions = () => {}
}) {
    const [client, setClient] = useState(null);

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [otherVals, setOtherVals] = useState({});
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [acceptedFile, setAcceptedFile] = useState(null);
    const [stepCache, setStepCache] = useState(null);
    const [stepIndexCache, setStepIndexCache] = useState(displayStepIndex);
    const [steps, setSteps] = useState(displaySteps);
    const [stepIndex, setStepIndex] = useState(displayStepIndex);
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

    const setInitialOtherState = (step) => {
        const newOtherVals = {};
        step.servar_fields.forEach((field) => {
            const servar = field.servar;
            let val = null;
            if (servar.metadata.other) {
                if (servar.type === 'multiselect') {
                    val = '';
                    field.servar.value = servar.value.map((selectedVal) => {
                        if (!servar.metadata.options.includes(selectedVal)) {
                            val = selectedVal;
                            return '';
                        } else return selectedVal;
                    });
                } else if (servar.type === 'select') {
                    if (servar.metadata.options.includes(servar.value))
                        val = '';
                    else {
                        val = servar.value;
                        field.servar.value = '';
                    }
                }
            }
            if (val !== null) newOtherVals[field.servar.key] = val;
        });
        setOtherVals(newOtherVals);
    };

    useEffect(() => {
        if (displaySteps === null) {
            if (client === null) {
                const clientInstance = new Client();
                setClient(clientInstance);
                clientInstance
                    .fetchForm(formKey)
                    .then((stepsResponse) => {
                        const data = stepsResponse.data;
                        if (data.length === 0) {
                            setFinishConfig({
                                finished: true,
                                redirectURL: stepsResponse.redirect_url
                            });
                        } else {
                            setFieldValues(data);
                            setInitialOtherState(data[stepIndex]);
                            // render default information first for good user
                            // experience
                            setSteps(data);
                            calculateDimensions(data[stepIndex]);

                            // fetch values separately because this request
                            // goes to Feathery origin, while the previous
                            // request will eventually go to our CDN
                            // TODO: issue request parallel to fetching form,
                            //  not serially
                            clientInstance
                                .fetchFormValues(formKey)
                                .then((vals) => {
                                    setFieldValues(data, vals);
                                    setInitialOtherState(data[stepIndex]);
                                    // render actual user state once/if it's
                                    // fetched
                                    setSteps(data);
                                })
                                .catch((error) => console.log(error));
                        }
                    })
                    .catch((error) => console.log(error));
            }
        } else if (
            JSON.stringify(displaySteps) !== JSON.stringify(stepCache) ||
            displayStepIndex !== stepIndexCache
        ) {
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
        setStepIndex
    ]);

    if (finishConfig.finished) {
        if (finishConfig.redirectURL) {
            window.location.href = finishConfig.redirectURL;
        }
        return null;
    }

    const handleChange = (e) => {
        const target = e.target;
        const value =
            target.type === 'checkbox' ? target.checked : target.value;
        const key = target.id;
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== key) return;

            if (servar.type === 'integer_field')
                field.servar.value = parseInt(value);
            else field.servar.value = value;
        });
        const stepsCopy = JSON.parse(JSON.stringify(steps));
        stepsCopy[stepIndex] = activeStep;
        setSteps(stepsCopy);
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

            if (target.checked) servar.value.push(opt);
            else servar.value = servar.value.filter((val) => val !== opt);
        });
        const stepsCopy = JSON.parse(JSON.stringify(steps));
        stepsCopy[stepIndex] = activeStep;
        setSteps(stepsCopy);
    };

    const handleColorChange = (servarKey) => (color) => {
        activeStep.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return;

            servar.value = color.hex.substr(1, 6);
        });
        const stepsCopy = JSON.parse(JSON.stringify(steps));
        stepsCopy[stepIndex] = activeStep;
        setSteps(stepsCopy);
    };

    const handleColorPickerClick = (servarKey) => () => {
        const curVal = displayColorPicker[servarKey];
        setDisplayColorPicker({
            ...displayColorPicker,
            [servarKey]: !curVal
        });
    };

    const updateNewIndex = (newIndex) => {
        activeStep = steps[newIndex];
        setInitialOtherState(activeStep);
        calculateDimensions(activeStep);
        setStepIndex(newIndex);
    };

    const submit = (action, userFields = []) => {
        if (!action) return;

        const noFileFields = userFields.filter(
            (field) => field.type !== 'file_upload'
        );
        const featheryFields = noFileFields.map((field) => {
            return { key: field.key, [field.type]: field.value };
        });

        if (['next', 'skip'].includes(action)) {
            const lastStep = stepIndex === steps.length - 1;
            if (action === 'next') {
                // Execute user-provided onSubmit function if present
                if (typeof onSubmit === 'function') {
                    onSubmit(userFields, stepIndex, lastStep);
                }
                client
                    .submitStep(formKey, stepIndex, featheryFields, action)
                    .catch((error) => {
                        if (error) console.log(error);
                    });

                // Set real time field values for programmatic access
                noFileFields.forEach((field) => {
                    fieldState.realTimeFields[field.key] = {
                        value: field.value,
                        displayText: field.displayText,
                        type: field.type
                    };
                });
            }

            if (lastStep) {
                setFinishConfig({
                    finished: true,
                    redirectURL: activeStep.redirect_url
                });
            } else {
                updateNewIndex(stepIndex + 1);
            }
        } else if (action === 'back') {
            updateNewIndex(stepIndex - 1);
        }
    };

    if (!activeStep) return null;

    let isFilled = true;
    for (const field of activeStep.servar_fields) {
        if (!field.servar.required) continue;
        const value = field.servar.value;
        switch (field.servar.type) {
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
                if (value === '' && !otherVals[field.servar.key])
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

                const userFields = activeStep.servar_fields.map((field) => {
                    const servar = field.servar;
                    let value;
                    switch (servar.type) {
                        case 'file_upload':
                            value = acceptedFile;
                            break;
                        case 'select':
                            value = servar.value || otherVals[servar.key];
                            break;
                        case 'multiselect':
                            value = servar.value.map(
                                (val) => val || otherVals[servar.key]
                            );
                            break;
                        default:
                            value = servar.value;
                    }
                    return {
                        value,
                        type: servar.type,
                        key: servar.key,
                        displayText: servar.name
                    };
                });

                const form = event.currentTarget;
                // Execute user-provided checkValidity function if present
                if (typeof checkValidity === 'function') {
                    const errors = checkValidity(userFields);
                    errors.forEach((err) => {
                        const [fieldKey, message] = err;
                        const element = form.elements[fieldKey];
                        if (element) element.setCustomValidity(message);
                    });
                    form.reportValidity();
                }
                if (form.checkValidity()) submit('next', userFields);
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
                                    checked={servar.value}
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
                                    value={servar.value}
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
                                        value={servar.value}
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
                                            checked={servar.value.includes(opt)}
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
                                            checked={servar.value.includes('')}
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
                                            value={otherVals[servar.key]}
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
                                            checked={servar.value === opt}
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
                                            checked={servar.value === ''}
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
                                            value={otherVals[servar.key]}
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
                                        value={servar.value}
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
                                        background: `#${servar.value}`,
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
                                            color={`#${servar.value}`}
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
                                        value={servar.value}
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
                                        value={servar.value}
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
                                        value={servar.value}
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
