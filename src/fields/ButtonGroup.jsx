import React from 'react';

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
                    alignItems: field.layout,
                    justifyContent: field.vertical_layout
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
                                height: `${field.field_height}${field.field_height_unit}`,
                                width: `${field.field_width}${field.field_width_unit}`,
                                backgroundColor: `#${field.background_color}`,
                                border: `${field.border_width}px solid`,
                                borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                                borderRadius: `${field.border_radius}px`,
                                marginBottom: `${field.padding_bottom}px`,
                                marginTop: `${field.padding_top}px`,
                                marginLeft: `${field.padding_left}px`,
                                marginRight: `${field.padding_right}px`,
                                boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`
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
