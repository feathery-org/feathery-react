import ReactForm from 'react-bootstrap/Form';
import React from 'react';
import { IMaskMixin } from 'react-imask';

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

    if (rows) {
        props.rows = rows;
        props.as = type;
    } else props.type = type;

    if (props.inputRef) {
        props.ref = props.inputRef;
        delete props.inputRef;
    } else props.value = fieldValue || '';

    let placeholderCSS = { display: 'none' };
    const placeholderActiveCSS = {};
    const inputPlaceholderCSS = {};
    if (metadata.placeholder_transition === 'shrink_top') {
        const minFontSize = Math.min(field.font_size, 10);
        placeholderCSS = {
            top: 0,
            marginTop: `${minFontSize / 2}px`,
            fontSize: `${minFontSize}px`
        };
        if (metadata.selected_placeholder_color) {
            placeholderActiveCSS.color = `#${metadata.selected_placeholder_color}`;
        }
        inputPlaceholderCSS.paddingTop = `${field.field_height / 3}${
            field.field_height_unit
        }`;
    }

    return (
        <>
            {label}
            <div
                style={{
                    position: 'relative',
                    height: `${field.field_height}${field.field_height_unit}`,
                    width: `${field.field_width}${field.field_width_unit}`,
                    maxWidth: '100%'
                }}
            >
                <ReactForm.Control
                    pattern={pattern}
                    style={{
                        height: `${field.field_height}${field.field_height_unit}`,
                        width: `${field.field_width}${field.field_width_unit}`,
                        maxWidth: '100%',
                        backgroundColor: `#${field.background_color}`,
                        border: `${field.border_width}px solid`,
                        borderColor: `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`,
                        borderRadius: `${field.border_radius}px`,
                        boxShadow: `${field.shadow_x_offset}px ${field.shadow_y_offset}px ${field.shadow_blur_radius}px #${field.shadow_color}`,
                        fontSize: `${field.font_size}px`,
                        color: `#${field.font_color}`,
                        ...inputPlaceholderCSS
                    }}
                    css={{
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
                    autoComplete={servar.metadata.autocomplete || 'on'}
                    {...props}
                />
                <span
                    css={{
                        position: 'absolute',
                        pointerEvents: 'none',
                        left: '13px',
                        top: '50%',
                        marginTop: `-${field.font_size / 2}px`,
                        transition: '0.2s ease all',
                        color: `#${metadata.placeholder_color}`,
                        fontSize: `${field.font_size}px`,
                        lineHeight: `${field.font_size}px`,
                        fontStyle: metadata.placeholder_italic
                            ? 'italic'
                            : 'normal',
                        ...(fieldValue ? placeholderCSS : {}),
                        'input:focus + &': {
                            ...placeholderCSS,
                            ...placeholderActiveCSS
                        }
                    }}
                >
                    {metadata.placeholder || ''}
                </span>
            </div>
        </>
    );
}

const MaskedBootstrapField = IMaskMixin((props) => (
    <BootstrapField {...props} />
));

export { BootstrapField, MaskedBootstrapField };
