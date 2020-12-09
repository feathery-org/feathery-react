import React, { useEffect, useState } from 'react';
import FeatheryClient from 'feathery-js-client-sdk';

import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import { Progress } from '@zendeskgarden/react-loaders'
import { SketchPicker } from 'react-color';

import 'bootstrap/dist/css/bootstrap.min.css';

const uuidV4Regex = /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
const angleBracketRegex = /<[^>]*>/g;

// sdkKey and userKey are required if displayStep === null
// totalSteps is required if displayStep !== null
function Feathery({
    sdkKey = null,
    userKey = null,
    clientKey = null,
    redirectURI = null,

    displayStep = null,
    showGrid = false,
    totalSteps = null,
    setExternalState = () => {}
}) {
    const [featheryClient, setFeatheryClient] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');

    const [finishConfig, setFinishConfig] = useState(false);
    const [displayColorPicker, setDisplayColorPicker] = useState({});
    const [acceptedFile, setAcceptedFile] = useState(null);
    const [step, setStep] = useState(displayStep);

    useEffect(() => {
        if (displayStep !== null) setStep(displayStep);
    }, [displayStep]);

    useEffect(() => {
        if (displayStep === null) {
            const clientInstance = new FeatheryClient(sdkKey, userKey);
            setFeatheryClient(clientInstance);
            clientInstance
                .fetchFirstIncompleteStep()
                .then((step) => setStep(step))
                .catch((error) => setErrorMessage(error.toString()));
        }
    }, [displayStep, sdkKey, userKey]);

    if (displayStep === null && finishConfig && redirectURI) {
        window.location.href = redirectURI;
        return null;
    }

    const handleChange = (e) => {
        const target = e.target;
        const value =
            target.type === 'checkbox' ? target.checked : target.value;
        const id = target.id;
        const newServarFields = step.servar_fields.map((field) => {
            const servar = field.servar;
            if (servar.id !== id) return field;
            if (servar.type === 'integer_field')
                field.servar.value = parseInt(value);
            else field.servar.value = value;
            return field;
        });
        setStep({ ...step, servar_fields: newServarFields });
    };

    const handleMultiselectChange = (servarID) => (e) => {
        const target = e.target;
        const opt = target.name;
        const newServarFields = step.servar_fields.map((field) => {
            const servar = field.servar;
            if (servar.id !== servarID) return field;
            if (target.checked) servar.value.push(opt);
            else servar.value = servar.value.filter((val) => val !== opt);
            return field;
        });
        setStep({ ...step, servar_fields: newServarFields });
    };

    const handleColorChange = (servarID) => (color) => {
        const newServarFields = step.servar_fields.map((field) => {
            const servar = field.servar;
            if (servar.id !== servarID) return field;
            servar.value = color.hex.substr(1, 6);
            return field;
        });
        setStep({ ...step, servar_fields: newServarFields });
    };

    const handleColorPickerClick = (servarID) => () => {
        const curVal = displayColorPicker[servarID];
        setDisplayColorPicker({
            ...displayColorPicker,
            [servarID]: !curVal
        });
    };

    const replaceRequestParams = (params, servarLookupMap) => {
        if (Array.isArray(params))
            return params.map((p) => replaceRequestParams(p, servarLookupMap));
        else if (typeof params === 'object' && params !== null) {
            const newParams = {};
            for (const key in params) {
                newParams[key] = replaceRequestParams(
                    params[key],
                    servarLookupMap
                );
            }
            return newParams;
        } else if (typeof params === 'string' && params.match(uuidV4Regex))
            return servarLookupMap[params];
        else return params;
    };

    const setResponseParams = (params, response, servarLookupMap) => {
        if (Array.isArray(params)) {
            let promises = [];
            params.forEach((p, index) => {
                promises = promises.concat(
                    setResponseParams(p, response[index], servarLookupMap)
                );
            });
            return promises;
        } else if (typeof params === 'object' && params !== null) {
            let promises = [];
            for (const key in params) {
                promises = promises.concat(
                    setResponseParams(
                        params[key],
                        response[key],
                        servarLookupMap
                    )
                );
            }
            return promises;
        } else if (typeof params === 'string' && params.match(uuidV4Regex)) {
            servarLookupMap[params] = response;
            return [
                fetch(`https://api.feathery.tech/api/servar/fuser/`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Token ${sdkKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fuser_key: userKey,
                        servar_id: params,
                        value: response
                    })
                }).catch((e) => console.log(e))
            ];
        }
    };

    const replaceURLParams = (url, servarLookupMap) => {
        return url.replace(angleBracketRegex, (match) => {
            const val = match.substring(1, match.length - 1);
            if (val in servarLookupMap) return servarLookupMap[val];
            return match;
        });
    };

    /**
     * Timeout function
     * @param {Integer} time (milliseconds)
     * @param {Promise} promise
     */
    const timeout = (time, promise) => {
        return new Promise(function (resolve, reject) {
            setTimeout(() => {
                reject(new Error('Request timed out.'));
            }, time);
            promise.then(resolve, reject);
        });
    };

    const submit = () => {
        let fileUploadServarID = '';
        step.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.type === 'file_upload') {
                if (acceptedFile === null) return;
                fileUploadServarID = servar.id;
            }
        });

        const submitServars = step.servar_fields
            .filter((field) => field.servar.type !== 'file_upload')
            .map((field) => {
                const servar = field.servar;
                return { key: servar.key, [servar.type]: servar.value };
            });
        featheryClient
            .submitStep(step.step_number, submitServars)
            .then(async (newStep) => {
                const servarLookupMap = step.servar_fields.reduce(
                    (map, field) => {
                        const servar = field.servar;
                        map[servar.id] = servar.value;
                        return map;
                    },
                    {}
                );
                for (const action of step.actions) {
                    const options = {
                        method: action.method.toUpperCase(),
                        headers: { Authorization: `Bearer ${clientKey}` }
                    };

                    if (action.body_type === 'application/json') {
                        options.headers['Content-Type'] = action.body_type;
                        options.body = JSON.stringify(
                            replaceRequestParams(action.params, servarLookupMap)
                        );
                    } else if (action.body_type === 'multipart/form-data') {
                        if (action.form_data_servar !== fileUploadServarID) {
                            console.log('Invalid file upload action');
                            return;
                        }
                        const body = new FormData();
                        body.append(action.form_data_key, acceptedFile);
                        options.body = body;
                    }

                    const url = replaceURLParams(action.url, servarLookupMap);
                    const promise = fetch(url, options)
                        .then((r) => r.json())
                        .then(async (d) => {
                            const promises = setResponseParams(
                                action.response_params,
                                d,
                                servarLookupMap
                            );
                            if (promises) await Promise.all(promises);
                        })
                        .catch((e) => console.log(e));
                    if (action.response_params) await timeout(1000, promise);
                }

                if (newStep.step_number === null) setFinishConfig(true);
                else setStep(newStep);
            })
            .catch((error) => {
                if (error) setErrorMessage(error.toString());
            });
    };

    if (finishConfig) {
        return <div>Finished</div>;
    } else if (step === null) {
        return null;
    } else {
        const maxSteps = displayStep ? totalSteps : step.total_steps;
        return (
            <div>
                {errorMessage && <div>{errorMessage}</div>}
                <div
                    style={{
                        height: '100%',
                        minHeight: '100%',
                        backgroundColor: '#F7F8FA',
                        backgroundSize: '100% 100%',
                        display: 'grid',
                        overflow: 'hidden',
                        gridTemplateColumns: step.grid_columns
                            .map((c) => `${c}fr`)
                            .join(' '),
                        gridTemplateRows: step.grid_rows
                            .map((c) => `${c}fr`)
                            .join(' '),
                        ...(step.background_image
                            ? {
                                  backgroundImage: `url(${step.background_image})`
                              }
                            : {})
                    }}
                >
                    {showGrid &&
                        Array.from(
                            { length: step.grid_columns.length - 1 },
                            (_, i) => (
                                <div
                                    style={{
                                        gridColumn: i + 1,
                                        gridRowStart: 1,
                                        gridRowEnd: -1,
                                        borderRight: '3px dashed #DEDFE2'
                                    }}
                                />
                            )
                        )}
                    {showGrid &&
                        Array.from(
                            { length: step.grid_rows.length - 1 },
                            (_, i) => (
                                <div
                                    style={{
                                        gridRowStart: i + 1,
                                        gridColumnStart: 1,
                                        gridColumnEnd: -1,
                                        borderBottom: '3px dashed #DEDFE2'
                                    }}
                                />
                            )
                        )}
                    {step.progress_bar && (
                        <div
                            style={{
                                gridColumn: step.progress_bar.column_index + 1,
                                gridRow: step.progress_bar.row_index + 1,
                                alignItems: step.progress_bar.layout,
                                fontStyle: step.progress_bar.font_italic
                                    ? 'italic'
                                    : 'normal',
                                fontWeight: step.progress_bar.font_weight,
                                fontFamily: step.progress_bar.font_family,
                                fontSize: `${step.progress_bar.font_size}px`,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                ...(displayStep ? { cursor: 'pointer' } : {})
                            }}
                            onClick={() =>
                                setExternalState('progressBar', true)
                            }
                        >
                            {Math.round((step.step_number / maxSteps) * 100)}%
                            completed
                            <Progress
                                style={{ width: '100%' }}
                                color='#007bff'
                                value={(step.step_number / maxSteps) * 100}
                            />
                        </div>
                    )}
                    {step.text_fields.map((field, i) => (
                        <div
                            key={i}
                            style={{
                                gridColumn: field.column_index + 1,
                                gridRow: field.row_index + 1,
                                alignItems: field.layout,
                                fontStyle: field.font_italic
                                    ? 'italic'
                                    : 'normal',
                                fontWeight: field.font_weight,
                                fontFamily: field.font_family,
                                fontSize: `${field.font_size}px`,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                ...(displayStep ? { cursor: 'pointer' } : {})
                            }}
                            onClick={() => setExternalState('text', i)}
                        >
                            {field.is_button ? (
                                <Button
                                    onClick={() => {
                                        if (
                                            displayStep !== null ||
                                            field.link === null
                                        )
                                            return;
                                        submit();
                                    }}
                                    dangerouslySetInnerHTML={{
                                        __html: field.text
                                    }}
                                />
                            ) : (
                                <div
                                    onClick={() => {
                                        if (
                                            displayStep !== null ||
                                            field.link === null
                                        )
                                            return;
                                        submit();
                                    }}
                                    style={{
                                        ...(field.link === null
                                            ? {}
                                            : { cursor: 'pointer' })
                                    }}
                                    dangerouslySetInnerHTML={{
                                        __html: field.text
                                    }}
                                />
                            )}
                        </div>
                    ))}
                    {step.servar_fields.map((field, i) => {
                        const servar = field.servar;
                        let servarComponent;

                        switch (servar.type) {
                            case 'file_upload':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>{servar.name}</Form.Label>
                                        <Form.File
                                            id={servar.id}
                                            accept='image/*'
                                            onChange={(e) => {
                                                setAcceptedFile(
                                                    e.target.files[0]
                                                );
                                            }}
                                        />
                                    </Form.Group>
                                );
                                break;
                            case 'checkbox':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Check
                                            type='checkbox'
                                            id={servar.id}
                                            label={servar.name}
                                            checked={servar.value}
                                            onChange={handleChange}
                                        />
                                    </Form.Group>
                                );
                                break;
                            case 'dropdown':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>{servar.name}</Form.Label>
                                        <Form.Control
                                            as='select'
                                            id={servar.id}
                                            value={servar.value}
                                            onChange={handleChange}
                                        >
                                            <option key='' value='' disabled>
                                                Select an option
                                            </option>
                                            {servar.metadata.options.map(
                                                (option) => (
                                                    <option key={option}>
                                                        {option}
                                                    </option>
                                                )
                                            )}
                                        </Form.Control>
                                    </Form.Group>
                                );
                                break;
                            case 'multiselect':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>{servar.name}</Form.Label>
                                        {servar.metadata.options.map((opt) => {
                                            return (
                                                <Form.Check
                                                    type='checkbox'
                                                    name={opt}
                                                    key={opt}
                                                    label={opt}
                                                    checked={servar.value.includes(
                                                        opt
                                                    )}
                                                    onChange={handleMultiselectChange(
                                                        servar.id
                                                    )}
                                                />
                                            );
                                        })}
                                    </Form.Group>
                                );
                                break;
                            case 'select':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>{servar.name}</Form.Label>
                                        {servar.metadata.options.map((opt) => {
                                            return (
                                                <Form.Check
                                                    type='radio'
                                                    id={servar.id}
                                                    label={opt}
                                                    checked={
                                                        servar.value === opt
                                                    }
                                                    onChange={handleChange}
                                                    value={opt}
                                                    key={opt}
                                                />
                                            );
                                        })}
                                    </Form.Group>
                                );
                                break;
                            case 'integer_field':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>
                                            {servar.name}: <b>0</b>
                                        </Form.Label>
                                        <Form.Control
                                            id={servar.id}
                                            type='range'
                                            step={1}
                                            value={servar.value}
                                            onChange={handleChange}
                                        />
                                    </Form.Group>
                                );
                                break;
                            case 'hex_color':
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>{servar.name}</Form.Label>
                                        <div
                                            style={{
                                                width: '36px',
                                                height: '36px',
                                                background: `#${servar.value}`,
                                                cursor: 'pointer'
                                            }}
                                            onClick={handleColorPickerClick(
                                                servar.id
                                            )}
                                        />
                                        {displayColorPicker[servar.id] ? (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    zIndex: 2
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        position: 'fixed',
                                                        top: '0px',
                                                        right: '0px',
                                                        bottom: '0px',
                                                        left: '0px'
                                                    }}
                                                    onClick={handleColorPickerClick(
                                                        servar.id
                                                    )}
                                                />
                                                <SketchPicker
                                                    color={`#${servar.value}`}
                                                    onChange={handleColorChange(
                                                        servar.id
                                                    )}
                                                />
                                            </div>
                                        ) : null}
                                    </Form.Group>
                                );
                                break;
                            default:
                                servarComponent = (
                                    <Form.Group>
                                        <Form.Label>{servar.name}</Form.Label>
                                        <Form.Control
                                            as='textarea'
                                            id={servar.id}
                                            value={servar.value}
                                            onChange={handleChange}
                                        />
                                    </Form.Group>
                                );
                        }
                        return (
                            <div
                                style={{
                                    gridColumn: field.column_index + 1,
                                    gridRow: field.row_index + 1,
                                    alignItems: field.layout,
                                    fontStyle: field.font_italic
                                        ? 'italic'
                                        : 'normal',
                                    fontWeight: field.font_weight,
                                    fontFamily: field.font_family,
                                    fontSize: `${field.font_size}px`,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    cursor: 'pointer'
                                }}
                                onClick={() => setExternalState('servar', i)}
                                key={i}
                            >
                                {servarComponent}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
}

export { Feathery };
