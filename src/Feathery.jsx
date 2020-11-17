import React, { useEffect, useState } from 'react';
import FeatheryClient from 'feathery-js-client-sdk';
import { DefaultDropdown, DefaultRadio } from './DefaultComponents';

import { PALETTE } from '@zendeskgarden/react-theming';
import { Button as DefaultButton } from '@zendeskgarden/react-buttons';
import { LG, XXL, Paragraph } from '@zendeskgarden/react-typography';
import { Progress } from '@zendeskgarden/react-loaders';
import {
    Field,
    Input,
    Label,
    Checkbox,
    Range
} from '@zendeskgarden/react-forms';

import Form from 'react-bootstrap/Form';
import { SketchPicker } from 'react-color';
import { useDropzone } from 'react-dropzone';

const uuidV4Regex = /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i;
const angleBracketRegex = /<[^>]*>/g;

export function Feathery({
    sdkKey,
    userKey,
    clientKey = null,
    Button = DefaultButton,
    Radio = DefaultRadio,
    Dropdown = DefaultDropdown,
    redirectURI = null
}) {
    const [featheryClient, setFeatheryClient] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');

    const [servars, setServars] = useState([]);
    const [header, setHeader] = useState('');
    const [actions, setActions] = useState([]);
    const [description, setDescription] = useState('');
    const [stepNum, setStepNum] = useState(0);
    const [maxSteps, setMaxSteps] = useState(0);
    const [finishConfig, setFinishConfig] = useState(false);
    const [displayColorPicker, setDisplayColorPicker] = useState({});

    const { acceptedFiles, getRootProps, getInputProps } = useDropzone({
        accept: 'image/*',
        maxFiles: 1
    });

    let acceptedFileItem = null;
    if (acceptedFiles.length > 0) {
        const acceptedFile = acceptedFiles[0];
        acceptedFileItem = `${acceptedFile.path} - ${acceptedFile.size} bytes`;
    }

    useEffect(() => {
        const clientInstance = new FeatheryClient(sdkKey, userKey);
        setFeatheryClient(clientInstance);
        clientInstance
            .fetchFirstIncompleteStep()
            .then((step) => {
                const stepNumber = step.step_number;
                if (stepNumber === null) setFinishConfig(true);
                else {
                    setStepNum(stepNumber);
                    setMaxSteps(step.total_steps);
                    setServars(fillDefaults(step.servars));
                    if (step.header) setHeader(step.header);
                    if (step.description) setDescription(step.description);
                    if (step.actions) setActions(step.actions);
                }
            })
            .catch((error) => {
                setErrorMessage(error.toString());
            });
    }, [sdkKey, userKey]);

    if (finishConfig && redirectURI) {
        window.location.href = redirectURI;
        return null;
    }

    const fillDefaults = (servars) => {
        const colorPickerDisplays = {};
        const filledServars = servars.map((s) => {
            if (s.value === null) {
                if (s.type === 'checkbox') s.value = false;
                else if (s.type === 'multiselect') s.value = [];
                else if (s.type === 'integer_field') s.value = 0;
                else if (s.type === 'hex_color') {
                    s.value = '000000';
                    colorPickerDisplays[s.id] = false;
                } else s.value = '';
            }
            return s;
        });
        setDisplayColorPicker(colorPickerDisplays);
        return filledServars;
    };

    const handleChange = (e) => {
        const target = e.target;
        const value =
            target.type === 'checkbox' ? target.checked : target.value;
        const name = target.name;
        const newServars = servars.map((s) => {
            if (s.id !== name) return s;
            if (s.type === 'integer_field') {
                s.value = parseInt(value);
            }
            s.value = value;
            return s;
        });
        setServars(newServars);
    };

    const handleDropdownChange = (servarID) => (item) => {
        const newServars = servars.map((s) => {
            if (s.id !== servarID) return s;
            s.value = item;
            return s;
        });
        setServars(newServars);
    };

    const handleMultiselectChange = (servarID) => (e) => {
        const target = e.target;
        const opt = target.name;
        const newServars = servars.map((s) => {
            if (s.id !== servarID) return s;
            if (target.checked) s.value.push(opt);
            else s.value = s.value.filter((val) => val !== opt);
            return s;
        });
        setServars(newServars);
    };

    const handleColorChange = (servarID) => (color) => {
        const newServars = servars.map((s) => {
            if (s.id !== servarID) return s;
            s.value = color.hex.substr(1, 6);
            return s;
        });
        setServars(newServars);
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
        servars.forEach((s) => {
            if (s.type === 'file_upload') {
                if (acceptedFileItem === null) return;
                fileUploadServarID = s.id;
            }
        });

        const submitServars = servars
            .filter((s) => s.type !== 'file_upload')
            .map((s) => {
                return { key: s.key, [s.type]: s.value };
            });
        featheryClient
            .submitStep(stepNum, submitServars)
            .then(async (step) => {
                const servarLookupMap = servars.reduce((map, servar) => {
                    map[servar.id] = servar.value;
                    return map;
                }, {});
                for (const action of actions) {
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
                        body.append(action.form_data_key, acceptedFiles[0]);
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

                if (step.step_number === null) setFinishConfig(true);
                else {
                    setServars(fillDefaults(step.servars));
                    setStepNum(step.step_number);
                    if (step.header) setHeader(step.header);
                    else setHeader('');
                    if (step.description) setDescription(step.description);
                    else setDescription('');
                    if (step.actions) setActions(step.actions);
                    else setActions([]);
                }
            })
            .catch((error) => {
                if (error) setErrorMessage(error.toString());
            });
    };

    if (errorMessage) {
        return <div>{errorMessage}</div>;
    } else if (finishConfig) {
        return <div>Finished</div>;
    } else {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    textAlign: 'left',
                    justifyItems: 'center',
                    alignItems: 'center'
                }}
            >
                {stepNum >= 0 && maxSteps > 0 && (
                    <div style={{ width: '50%', textAlign: 'center' }}>
                        <Paragraph style={{ marginBottom: 10 }}>
                            {Math.round((stepNum / maxSteps) * 100)}% completed
                        </Paragraph>
                        <Progress
                            value={(stepNum / maxSteps) * 100}
                            color={PALETTE.blue[600]}
                        />
                    </div>
                )}
                {header && (
                    // eslint-disable-next-line react/jsx-pascal-case
                    <XXL isBold style={{ marginTop: 20, marginBottom: 30 }}>
                        {header}
                    </XXL>
                )}
                {description && (
                    // eslint-disable-next-line react/jsx-pascal-case
                    <LG
                        style={{
                            marginBottom: 30,
                            overflowWrap: 'break-word',
                            maxWidth: '600px'
                        }}
                        dangerouslySetInnerHTML={{ __html: description }}
                    />
                )}
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-around',
                        alignItems: 'left',
                        minWidth: 400,
                        width: '600px',
                        minHeight: 120 * servars.length
                    }}
                >
                    {servars.map((servar) => {
                        switch (servar.type) {
                            case 'file_upload':
                                return (
                                    <Field>
                                        <Form.Label>{servar.name}</Form.Label>
                                        <section
                                            style={{
                                                flex: 1,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                padding: '20px',
                                                borderWidth: '2px',
                                                borderRadius: '2px',
                                                borderColor: '#eeeeee',
                                                borderStyle: 'dashed',
                                                backgroundColor: '#ffffff',
                                                color: '#bdbdbd',
                                                outline: 'none',
                                                transition:
                                                    'border .24s ease-in-out'
                                            }}
                                            {...getRootProps({
                                                className: 'dropzone'
                                            })}
                                        >
                                            <input {...getInputProps()} />
                                            <em>
                                                {acceptedFileItem ||
                                                    'No image uploaded'}
                                            </em>
                                        </section>
                                    </Field>
                                );
                            case 'checkbox':
                                return (
                                    <Field>
                                        <Checkbox
                                            name={servar.id}
                                            checked={servar.value}
                                            onChange={handleChange}
                                        >
                                            <Form.Label>
                                                {servar.name}
                                            </Form.Label>
                                        </Checkbox>
                                    </Field>
                                );
                            case 'dropdown':
                                return (
                                    <Dropdown
                                        servar={servar}
                                        handleDropdownChange={
                                            handleDropdownChange
                                        }
                                    />
                                );
                            case 'multiselect':
                                return (
                                    <div>
                                        <Form.Label>{servar.name}</Form.Label>
                                        {servar.metadata.options.map((opt) => {
                                            return (
                                                <Field key={opt}>
                                                    <Checkbox
                                                        name={opt}
                                                        checked={servar.value.includes(
                                                            opt
                                                        )}
                                                        onChange={handleMultiselectChange(
                                                            servar.id
                                                        )}
                                                    >
                                                        <Label>{opt}</Label>
                                                    </Checkbox>
                                                </Field>
                                            );
                                        })}
                                    </div>
                                );
                            case 'select':
                                return (
                                    <div>
                                        <Form.Label>{servar.name}</Form.Label>
                                        {servar.metadata.options.map((opt) => {
                                            return (
                                                <Radio
                                                    radioID={servar.id}
                                                    checked={
                                                        servar.value === opt
                                                    }
                                                    onChange={handleChange}
                                                    value={opt}
                                                    key={opt}
                                                />
                                            );
                                        })}
                                    </div>
                                );
                            case 'integer_field':
                                return (
                                    <Field>
                                        <Form.Label>
                                            {servar.name}: <b>{servar.value}</b>
                                        </Form.Label>
                                        <Range
                                            name={servar.id}
                                            type='range'
                                            step={1}
                                            value={servar.value}
                                            onChange={handleChange}
                                        />
                                    </Field>
                                );
                            case 'hex_color':
                                return (
                                    <div>
                                        <Field>
                                            <Form.Label>
                                                {servar.name}
                                            </Form.Label>
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
                                        </Field>
                                    </div>
                                );
                            default:
                                return (
                                    <Field>
                                        <Form.Label>{servar.name}</Form.Label>
                                        <Input
                                            name={servar.id}
                                            type='text'
                                            value={servar.value}
                                            onChange={handleChange}
                                        />
                                    </Field>
                                );
                        }
                    })}
                </div>
                <Button
                    isPrimary
                    onClick={() => submit()}
                    style={{ marginTop: '20px' }}
                >
                    {stepNum + 1 === maxSteps ? 'Finish' : 'Next →'}
                </Button>
            </div>
        );
    }
}

export default React.memo(Feathery);
