import ReactForm from 'react-bootstrap/Form';
import React from 'react';
import { IMaskMixin } from 'react-imask';

function BootstrapField({
    label,
    field,
    selectStyle,
    hoverStyle,
    type,
    fieldMask,
    fieldValue,
    onChange,
    onClick,
    pattern,
    rows,
    inlineError,
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

    const borderColor = inlineError
        ? '#F42525'
        : `#${field.border_top_color} #${field.border_right_color} #${field.border_bottom_color} #${field.border_left_color}`;
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
                    id={servar.key}
                    pattern={pattern}
                    style={{
                        maxWidth: '100%',
                        borderColor,
                        borderWidth: `${field.border_width}px`,
                        height: `${field.field_height}${field.field_height_unit}`,
                        width: `${field.field_width}${field.field_width_unit}`,
                        backgroundColor: `#${field.background_color}`,
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
                    required={servar.required}
                    onChange={onChange}
                    onClick={onClick}
                    autoComplete={servar.metadata.autocomplete || 'on'}
                    placeholder=''
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
                        ...(fieldValue || fieldMask ? placeholderCSS : {}),
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

function getMaskProps(servar, value) {
    switch (servar.type) {
        case 'login':
            return {
                mask: servar.metadata.login_methods.map((method) => {
                    return {
                        method,
                        mask: method === 'phone' ? '(000) 000-0000' : /.+/
                    };
                }),
                value
            };
        case 'phone_number':
            return { mask: '+1 (000) 000-0000', value };
        case 'ssn':
            return { mask: '000 - 00 - 0000', value };
        case 'integer_field':
            return {
                mask: servar.format === 'currency' ? '$num' : 'num',
                blocks: {
                    num: {
                        mask: Number,
                        thousandsSeparator: ',',
                        scale: 0,
                        signed: false
                    }
                },
                value: value.toString()
            };
        default:
            return {
                mask: servar.metadata.only_alpha ? /^[a-z0-9]*$/i : /.*/,
                value
            };
    }
}

const MaskedBootstrapField = IMaskMixin((props) => (
    <BootstrapField {...props} />
));

export { BootstrapField, MaskedBootstrapField, getMaskProps };
