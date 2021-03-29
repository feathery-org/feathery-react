import React, { useEffect, useState } from 'react';

import Button from 'react-bootstrap/Button';
import ProgressBar from 'react-bootstrap/ProgressBar';
import ReactForm from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';

import { MuiField, MuiProgress } from './components/MaterialUI';
import Client from './utils/client';
import { fieldState } from './Fields';

import './bootstrap-iso.css';

function adjustColor(color, amount) {
    return (
        '#' +
        color
            .replace(/^#/, '')
            .replace(/../g, (color) =>
                (
                    '0' +
                    Math.min(
                        255,
                        Math.max(0, parseInt(color, 16) + amount)
                    ).toString(16)
                ).substr(-2)
            )
    );
}

// apiKey and userKey are required if displayStep === null
// totalSteps is required if displayStep !== null
export default function Form({
    // Public API
    formKey,
    onSubmit = null,
    checkValidity = () => [],

    // Default functionality
    style = {},
    className = '',
    children,

    // Internal
    displayStep = null,
    totalSteps = null,
    setFormDimensions = () => {}
}) {
    const [client, setClient] = useState(null);

    const [finishConfig, setFinishConfig] = useState({
        finished: false,
        redirectURL: null
    });
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [acceptedFile, setAcceptedFile] = useState(null);
    const [step, setStep] = useState(displayStep);
    const [dimensions, setDimensions] = useState({
        width: null,
        rows: [],
        columns: []
    });

    const calculateDimensions = (inputStep) => {
        const gridTemplateRows = inputStep.grid_rows.map(
            (row) => `minmax(${row},min-content)`
        );

        let gridTemplateColumns;
        if (window.innerWidth >= 768) {
            gridTemplateColumns = inputStep.grid_columns;
        } else {
            const seenColumns = new Set();
            if (inputStep.progress_bar)
                seenColumns.add(inputStep.progress_bar.column_index);
            inputStep.text_fields.map((field) =>
                seenColumns.add(field.column_index)
            );
            inputStep.servar_fields.map((field) =>
                seenColumns.add(field.column_index)
            );
            gridTemplateColumns = inputStep.grid_columns.map((c, index) =>
                seenColumns.has(index) ? c : '10px'
            );
        }

        let definiteWidth = 0;
        gridTemplateColumns.forEach((column) => {
            if (definiteWidth !== null && column.slice(-2) === 'px') {
                definiteWidth += parseFloat(column);
            } else {
                definiteWidth = null;
            }
        });
        if (definiteWidth) {
            gridTemplateColumns = gridTemplateColumns.map(
                (c) => `${(100 * parseFloat(c)) / definiteWidth}%`
            );
        }

        const newDimensions = {
            width: definiteWidth,
            columns: gridTemplateColumns,
            rows: gridTemplateRows
        };
        if (JSON.stringify(newDimensions) !== JSON.stringify(dimensions)) {
            setDimensions(newDimensions);
            setFormDimensions(
                definiteWidth,
                gridTemplateColumns,
                gridTemplateRows
            );
        }
    };

    useEffect(() => {
        if (displayStep === null) {
            if (client === null) {
                const clientInstance = new Client();
                setClient(clientInstance);
                clientInstance
                    .begin(formKey)
                    .then((stepResponse) => {
                        if (stepResponse.step_number === null) {
                            setFinishConfig({
                                finished: true,
                                redirectURL: stepResponse.redirect_url
                            });
                        } else {
                            setStep(stepResponse);
                            calculateDimensions(stepResponse);
                        }
                    })
                    .catch((error) => console.log(error));
            }
        } else {
            setStep(displayStep);
            calculateDimensions(displayStep);
        }
    }, [client, displayStep, calculateDimensions]);

    if (displayStep === null && finishConfig.finished) {
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
        const newServarFields = step.servar_fields.map((field) => {
            const servar = field.servar;
            if (servar.key !== key) return field;
            if (servar.type === 'integer_field')
                field.servar.value = parseInt(value);
            else field.servar.value = value;
            return field;
        });
        setStep({ ...step, servar_fields: newServarFields });
    };

    const handleMultiselectChange = (servarKey) => (e) => {
        const target = e.target;
        const opt = target.name;
        const newServarFields = step.servar_fields.map((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return field;
            if (target.checked) servar.value.push(opt);
            else servar.value = servar.value.filter((val) => val !== opt);
            return field;
        });
        setStep({ ...step, servar_fields: newServarFields });
    };

    const handleColorChange = (servarKey) => (color) => {
        const newServarFields = step.servar_fields.map((field) => {
            const servar = field.servar;
            if (servar.key !== servarKey) return field;
            servar.value = color.hex.substr(1, 6);
            return field;
        });
        setStep({ ...step, servar_fields: newServarFields });
    };

    const handleColorPickerClick = (servarKey) => () => {
        const curVal = displayColorPicker[servarKey];
        setDisplayColorPicker({
            ...displayColorPicker,
            [servarKey]: !curVal
        });
    };

    const submit = (action, userFields) => {
        if (!action) return;

        const noFileServars = step.servar_fields.filter(
            (field) => field.servar.type !== 'file_upload'
        );
        const featheryServars = noFileServars.map((field) => {
            const servar = field.servar;
            return { key: servar.key, [servar.type]: servar.value };
        });
        client
            .submitStep(formKey, step.step_number, featheryServars, action)
            .then(async (newStep) => {
                const finished = newStep.step_number === null;
                if (action === 'next') {
                    // Set real time field values for programmatic access
                    noFileServars.forEach((field) => {
                        const servar = field.servar;
                        fieldState.realTimeFields[servar.key] = {
                            value: servar.value,
                            displayText: servar.name,
                            type: servar.type
                        };
                    });
                    // Execute user-provided onSubmit function if present
                    if (typeof onSubmit === 'function') {
                        onSubmit(userFields, step.step_number, finished);
                    }
                }

                if (finished) {
                    setFinishConfig({
                        finished: true,
                        redirectURL: newStep.redirect_url
                    });
                } else {
                    setStep(newStep);
                    calculateDimensions(newStep);
                }
            })
            .catch((error) => {
                if (error) console.log(error);
            });
    };

    if (step === null) return null;

    let isFilled = true;
    for (const field of step.servar_fields) {
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
                if (value === '') isFilled = false;
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
    if (step.progress_bar) {
        const maxSteps = displayStep ? totalSteps : step.total_steps;
        if (step.component_type === 'bootstrap') {
            progressBarElements = [
                <ProgressBar
                    key='progress'
                    style={{
                        height: '0.4rem',
                        width: `${step.progress_bar.bar_width}%`,
                        maxWidth: '100%'
                    }}
                    css={{
                        '.progress-bar': {
                            margin: '0 0 0 0 !important',
                            backgroundColor: `#${step.progress_bar.bar_color} !important`
                        }
                    }}
                    now={(step.step_number / maxSteps) * 100}
                />
            ];
            const completionPercentage = `${Math.round(
                (step.step_number / maxSteps) * 100
            )}% completed`;
            if (step.progress_bar.percent_text_layout === 'top') {
                progressBarElements.splice(0, 0, completionPercentage);
            } else if (step.progress_bar.percent_text_layout === 'bottom') {
                progressBarElements.splice(1, 0, completionPercentage);
            }
        } else {
            progressBarElements = [
                <MuiProgress
                    key='progress'
                    curStep={step.step_number}
                    maxStep={maxSteps}
                    progressBar={step.progress_bar}
                />
            ];
        }
    }

    return (
        <ReactForm
            className={
                step.component_type === 'bootstrap'
                    ? `bootstrap-iso ${className}`
                    : className
            }
            onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();

                const userFields = step.servar_fields.map((field) => {
                    const servar = field.servar;
                    const value =
                        servar.type === 'file_upload'
                            ? acceptedFile
                            : servar.value;
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
                backgroundColor: `#${step.default_background_color}`,
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
            {step.progress_bar && (
                <div
                    css={{
                        gridColumnStart: step.progress_bar.column_index + 1,
                        gridRowStart: step.progress_bar.row_index + 1,
                        gridColumnEnd: step.progress_bar.column_index_end + 2,
                        gridRowEnd: step.progress_bar.row_index_end + 2,
                        alignItems: step.progress_bar.layout,
                        justifyContent: step.progress_bar.vertical_layout,
                        paddingBottom: `${step.progress_bar.padding_bottom}px`,
                        paddingTop: `${step.progress_bar.padding_top}px`,
                        color: `#${step.progress_bar.font_color}`,
                        fontStyle: step.progress_bar.font_italic
                            ? 'italic'
                            : 'normal',
                        fontWeight: step.progress_bar.font_weight,
                        fontFamily: step.progress_bar.font_family,
                        fontSize: `${step.progress_bar.font_size}px`,
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {progressBarElements}
                </div>
            )}
            {step.text_fields.map((field, i) => (
                <div
                    key={i.toString() + ':' + step.step_number.toString()}
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
                                !displayStep && field.link === 'next'
                                    ? 'submit'
                                    : undefined
                            }
                            onClick={() => {
                                if (!displayStep && field.link !== 'next')
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
            {step.servar_fields.map((field, i) => {
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
                                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
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
                            step.component_type === 'bootstrap' ? (
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
                                                'box-shadow': `0 0 0 0.2rem #${field.focus_color} !important`
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
                                                borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                            }}
                                        />
                                    );
                                })}
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
                                                borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                                            }}
                                        />
                                    );
                                })}
                            </>
                        );
                        break;
                    case 'integer_field':
                        controlElement =
                            step.component_type === 'bootstrap' ? (
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
                                                'box-shadow': `0 0 0 0.2rem #${field.focus_color} !important`
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
                            step.component_type === 'bootstrap' ? (
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
                                                'box-shadow': `0 0 0 0.2rem #${field.focus_color} !important`
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
                            step.component_type === 'bootstrap' ? (
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
                                                'box-shadow': `0 0 0 0.2rem #${field.focus_color} !important`
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
                            step.component_type === 'bootstrap' ? (
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
                                                'box-shadow': `0 0 0 0.2rem #${field.focus_color} !important`
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
