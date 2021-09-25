import React, { useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';

function RadioButtonGroupField({
    element,
    applyStyles,
    fieldLabel,
    fieldVal = '',
    otherVal = '',
    onChange = () => {},
    onOtherChange = () => {},
    onClick = () => {}
}) {
    const servar = element.servar;
    const [otherSelect, setOtherSelect] = useState({});
    const otherChecked =
        (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;
    return (
        <div css={applyStyles.getTarget('fc')}>
            {fieldLabel}
            {servar.metadata.options.map((opt, i) => {
                return (
                    <ReactForm.Check
                        type='radio'
                        id={`${servar.key}-${i}`}
                        key={`${servar.key}-${i}`}
                        label={opt}
                        checked={fieldVal === opt}
                        required={servar.required}
                        onChange={onChange}
                        onClick={onClick}
                        value={opt}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            marginBottom: '5px'
                        }}
                        css={{
                            'input[type="radio"]': {
                                marginTop: 0,
                                marginBottom: 0
                            }
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
                        key={`${servar.key}-`}
                        label='Other'
                        checked={otherChecked}
                        onChange={(e) => {
                            setOtherSelect({
                                ...otherSelect,
                                [servar.key]: true
                            });
                            onChange(e);
                        }}
                        onClick={onClick}
                        value={otherVal || ''}
                        style={{
                            display: 'flex',
                            alignItems: 'center'
                        }}
                        css={{
                            'input[type="radio"]': {
                                marginTop: 0,
                                marginBottom: 0
                            }
                        }}
                    />
                    <ReactForm.Control
                        type='text'
                        css={{
                            marginLeft: '5px',
                            ...bootstrapStyles,
                            ...applyStyles.getTarget('field'),
                            '&:focus': applyStyles.getTarget('active'),
                            '&:hover': applyStyles.getTarget('hover')
                        }}
                        id={servar.key}
                        value={otherVal || ''}
                        onChange={onOtherChange}
                        onClick={onClick}
                        maxLength={servar.max_length}
                        minLength={servar.min_length}
                        required={otherChecked}
                    />
                </div>
            )}
        </div>
    );
}

export default RadioButtonGroupField;
