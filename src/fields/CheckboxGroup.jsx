import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { getFieldValue } from '../utils/formHelperFunctions';
import { justInsert } from '../utils/array';

const handleCheckboxGroupChange = (
    e,
    servarKey,
    step,
    fieldValues,
    updateFieldValues
) => {
    const target = e.target;
    const opt = target.name;
    let newValues = null;
    step.servar_fields.forEach((field) => {
        const servar = field.servar;
        if (servar.key !== servarKey) return;

        const fieldValue = getFieldValue(field, fieldValues);
        const { value } = fieldValue;
        const newValue = target.checked
            ? [...value, opt]
            : value.filter((v) => v !== opt);
        if (fieldValue.repeated) {
            const { valueList, index } = fieldValue;
            newValues = updateFieldValues({
                [servar.key]: justInsert(valueList, newValue, index)
            });
        } else {
            newValues = updateFieldValues({ [servar.key]: newValue });
        }
    });
    return newValues;
};

function CheckboxGroup({
    field,
    fieldLabel,
    fieldVal,
    otherVal,
    step,
    fieldValues,
    updateFieldValues,
    fieldOnChange,
    handleOtherStateChange,
    onClick,
    selectCSS,
    hoverCSS
}) {
    const servar = field.servar;
    const otherChecked = fieldVal.includes(otherVal);
    return (
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
                            const newValues = handleCheckboxGroupChange(
                                e,
                                servar.key,
                                step,
                                fieldValues,
                                updateFieldValues
                            );
                            fieldOnChange([servar.key], newValues);
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
                        checked={otherChecked}
                        onChange={(e) => {
                            const newValues = handleCheckboxGroupChange(
                                e,
                                servar.key,
                                step,
                                fieldValues,
                                updateFieldValues
                            );
                            fieldOnChange([servar.key], newValues);
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
                            height: `${parseInt(field.font_size) + 4}px`,
                            backgroundColor: `#${field.background_color}`,
                            border: `${field.border_width}px solid`,
                            borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                            boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                            color: `#${field.font_color}`,
                            fontStyle: field.font_italic ? 'italic' : 'normal',
                            fontWeight: field.font_weight,
                            fontFamily: field.font_family,
                            fontSize: `${field.font_size}px`
                        }}
                        css={{
                            '&:focus': {
                                boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
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
                            fieldOnChange([servar.key], newValues);
                        }}
                        onClick={onClick}
                        maxLength={servar.max_length}
                        minLength={servar.min_length}
                        required={otherChecked}
                    />
                </div>
            )}
        </>
    );
}

export default CheckboxGroup;
