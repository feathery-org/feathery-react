import React from 'react';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

const handleButtonGroupChange = (e, step, updateFieldValues) => {
    const fieldKey = e.target.id;

    let newValues = null;
    step.servar_fields.forEach((field) => {
        const servar = field.servar;
        if (servar.key !== fieldKey) return;

        newValues = updateFieldValues({
            [servar.key]: e.target.textContent
        });
    });
    return newValues;
};

function ButtonGroup({
    field,
    fieldLabel,
    fieldVal,
    step,
    onClick,
    updateFieldValues,
    selectCSS,
    hoverCSS
}) {
    const servar = field.servar;
    return (
        <>
            {fieldLabel}
            <div
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    width: '100%',
                    alignItems: field.styles.layout,
                    justifyContent: field.styles.vertical_layout
                }}
            >
                {servar.metadata.options.map((opt) => {
                    return (
                        <div
                            id={servar.key}
                            onClick={(e) => {
                                const vals = handleButtonGroupChange(
                                    e,
                                    step,
                                    updateFieldValues
                                );
                                onClick(e, true, vals);
                            }}
                            key={opt}
                            style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                cursor: 'pointer',
                                height: `${field.styles.height}${field.styles.height_unit}`,
                                width: `${field.styles.width}${field.styles.width_unit}`,
                                backgroundColor: `#${field.styles.background_color}`,
                                boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color}`,
                                borderRadius: field.borderRadius,
                                ...borderStyleFromField(field),
                                ...marginStyleFromField(field)
                            }}
                            css={{
                                '&:active': selectCSS,
                                '&:hover': hoverCSS,
                                ...(fieldVal === opt ? selectCSS : {})
                            }}
                        >
                            {opt}
                        </div>
                    );
                })}
            </div>
        </>
    );
}

export default ButtonGroup;
