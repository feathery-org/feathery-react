import ReactForm from 'react-bootstrap/Form';
import React from 'react';
import { IMaskMixin } from 'react-imask';
import { reactFriendlyKey } from '../utils/formHelperFunctions';

function BootstrapField({
    label,
    field,
    selectStyle,
    hoverStyle,
    type,
    fieldValue,
    onChange,
    onClick,
    pattern,
    rows,
    ...props
}) {
    const metadata = field.metadata;
    const servar = field.servar;

    if (rows) props = { ...props, rows, as: type };
    else props = { ...props, type };

    if (props.inputRef) {
        props.ref = props.inputRef;
        delete props.inputRef;
    } else {
        props.value = fieldValue || '';
    }
    return (
        <>
            {label}
            <ReactForm.Control
                key={reactFriendlyKey(field)}
                pattern={pattern}
                style={{
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxWidth: '100%',
                    backgroundColor: `#${field.background_color}`,
                    border: `${field.border_width}px solid`,
                    borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                    boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                    fontSize: `${field.font_size}px`,
                    color: `#${field.font_color}`
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
                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color} !important`,
                        ...selectStyle
                    },
                    '&:hover': hoverStyle
                }}
                maxLength={servar.max_length}
                minLength={servar.min_length}
                id={servar.key}
                required={servar.required}
                onChange={onChange}
                onClick={onClick}
                placeholder={metadata.placeholder || ''}
                {...props}
            />
        </>
    );
}

const MaskedBootstrapField = IMaskMixin((props) => (
    <BootstrapField {...props} />
));

export { BootstrapField, MaskedBootstrapField };
