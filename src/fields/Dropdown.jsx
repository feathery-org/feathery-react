import React from 'react';
import ReactForm from 'react-bootstrap/Form';

function Dropdown({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    selectCSS,
    hoverCSS,
    inlineError
}) {
    const borderColor = inlineError
        ? '#F42525'
        : `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`;
    const servar = field.servar;
    return (
        <>
            {fieldLabel}
            <ReactForm.Control
                style={{
                    borderColor,
                    borderWidth: `${field.border_width}px`,
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxWidth: '100%',
                    backgroundColor: `#${field.background_color}`,
                    borderRadius: `${field.border_radius}px`,
                    fontSize: `${field.font_size}px`,
                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                    color: `#${
                        fieldVal
                            ? field.font_color
                            : field.metadata.placeholder_color
                    }`,
                    fontStyle: field.metadata.placeholder_italic
                        ? 'italic'
                        : 'normal',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
                    backgroundImage:
                        "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='black'/></svg>\")",
                    backgroundRepeat: 'no-repeat',
                    backgroundPositionX: '90%',
                    backgroundPositionY: 'center'
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
            >
                <option key='' value='' disabled>
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
