import ReactForm from 'react-bootstrap/Form';
import React from 'react';

export function BootstrapField({
    label,
    field,
    selectStyle,
    hoverStyle,
    type,
    fieldValue,
    onChange,
    onClick,
    pattern,
    rows
}) {
    const metadata = field.metadata;
    const servar = field.servar;

    let props;
    if (rows) props = { rows, as: type };
    else props = { type };

    return (
        <>
            {label}
            <ReactForm.Control
                {...props}
                pattern={pattern}
                style={{
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxWidth: '100%',
                    backgroundColor: `#${field.background_color}`,
                    border: `${field.border_width}px solid`,
                    borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`
                }}
                css={{
                    '&::placeholder': {
                        color: `#${metadata.placeholder_color} !important`,
                        fontSize: `${field.font_size}px`,
                        fontStyle: metadata.placeholder_italic
                            ? 'italic !important'
                            : 'normal !important'
                    },
                    '&:focus': {
                        boxShadow: 'none !important',
                        ...selectStyle
                    },
                    '&:hover': hoverStyle
                }}
                id={servar.key}
                value={fieldValue || ''}
                required={servar.required}
                onChange={onChange}
                onClick={onClick}
                placeholder={metadata.placeholder || ''}
            />
        </>
    );
}
