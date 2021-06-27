import React from 'react';
import ReactForm from 'react-bootstrap/Form';

function Dropdown({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    selectCSS,
    hoverCSS
}) {
    const servar = field.servar;
    return (
        <>
            {fieldLabel}
            <ReactForm.Control
                style={{
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxWidth: '100%',
                    backgroundColor: `#${field.background_color}`,
                    border: `${field.border_width}px solid`,
                    borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                    fontSize: `${field.font_size}px`,
                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`
                }}
                css={{
                    '&:focus': {
                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                        ...selectCSS
                    },
                    '&:hover': hoverCSS
                }}
                as='select'
                id={servar.key}
                value={fieldVal}
                required={servar.required}
                onChange={onChange}
                onClick={onClick}
                custom
            >
                <option
                    key=''
                    value=''
                    disabled
                    style={{
                        color: `#${field.metadata.placeholder_color}`,
                        fontStyle: field.metadata.placeholder_italic
                            ? 'italic'
                            : 'normal'
                    }}
                >
                    {field.metadata.placeholder || 'Select...'}
                </option>
                {servar.metadata.options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </ReactForm.Control>
        </>
    );
}

export default Dropdown;
