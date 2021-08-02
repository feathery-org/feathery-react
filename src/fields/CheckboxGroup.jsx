import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { getFieldValue } from '../utils/formHelperFunctions';
import { justInsert } from '../utils/array';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

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
        <div style={marginStyleFromField(field)}>
            {fieldLabel}
            {servar.metadata.options.map((opt, i) => {
                return (
                    <ReactForm.Check
                        type='checkbox'
                        id={`${servar.key}-${i}`}
                        key={`${servar.key}-${i}`}
                        name={opt}
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
                            fieldOnChange([field.id], [servar.key], newValues);
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
                        key={`${servar.key}-`}
                        name={otherVal}
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
                            fieldOnChange([field.id], [servar.key], newValues);
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
                            height: `${parseInt(field.styles.font_size) + 4}px`,
                            backgroundColor: `#${field.styles.background_color}`,
                            boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color}`,
                            color: `#${field.styles.font_color}`,
                            fontStyle: field.styles.font_italic
                                ? 'italic'
                                : 'normal',
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
                            fieldOnChange([field.id], [servar.key], newValues);
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

export default CheckboxGroup;
