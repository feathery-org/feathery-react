import React from 'react';
import ReactForm from 'react-bootstrap/Form';
import { getFieldValue } from '../../utils/formHelperFunctions';
import { justInsert } from '../../utils/array';
import { bootstrapStyles } from '../../utils/styles';

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
    onChange,
    handleOtherStateChange,
    onClick
}) {
    const { servar, applyStyles } = field;
    const otherChecked = fieldVal.includes(otherVal);
    return (
        <div css={applyStyles.getTarget('fc')}>
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
                            onChange(newValues);
                        }}
                        onClick={onClick}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            marginBottom: '5px'
                        }}
                        css={{
                            'input[type="checkbox"]': {
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
                            onChange(newValues);
                        }}
                        onClick={onClick}
                        style={{
                            display: 'flex',
                            alignItems: 'center'
                        }}
                        css={{
                            'input[type="checkbox"]': {
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
                        onChange={(e) => {
                            const newValues = handleOtherStateChange(otherVal)(
                                e
                            );
                            onChange(newValues);
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
