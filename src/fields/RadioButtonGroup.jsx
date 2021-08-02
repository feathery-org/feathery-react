import React, { useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

function RadioButtonGroup({
    field,
    fieldLabel,
    fieldVal,
    otherVal,
    onChange,
    handleOtherStateChange,
    onClick,
    selectCSS,
    hoverCSS
}) {
    const [otherSelect, setOtherSelect] = useState({});

    const servar = field.servar;
    const otherChecked =
        (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;
    return (
        <div style={marginStyleFromField(field)}>
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
                    />
                    <ReactForm.Control
                        type='text'
                        style={{
                            marginLeft: '5px',
                            height: `${parseInt(field.styles.font_size) + 4}px`,
                            backgroundColor: `#${field.styles.background_color}`,
                            boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color}`,
                            color: `#${field.styles.font_color}`,
                            fontStyle: field.styles.font_italic ? 'italic' : 'normal',
                            fontWeight: field.styles.font_weight,
                            fontFamily: field.styles.font_family,
                            fontSize: `${field.styles.font_size}px`,
                            borderRadius: field.borderRadius,
                            ...borderStyleFromField(field)
                        }}
                        css={{
                            '&:focus': {
                                boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color} !important`,
                                ...selectCSS
                            },
                            '&:hover': hoverCSS
                        }}
                        id={servar.key}
                        value={otherVal || ''}
                        onChange={(e) => {
                            const newValues = handleOtherStateChange(otherVal)(
                                e
                            );
                            onChange(e, newValues);
                        }}
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

export default RadioButtonGroup;
