import {
    borderStyleFromField,
    marginStyleFromField,
    fontStyles,
    bootstrapStyles
} from '../utils/styles';

import { IMaskMixin } from 'react-imask';
import React from 'react';
import ReactForm from 'react-bootstrap/Form';

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
    const { servar, styles } = field;

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
    if (styles.placeholder_transition === 'shrink_top') {
        const minFontSize = Math.min(styles.font_size, 10);
        placeholderCSS = {
            top: 0,
            marginTop: `${minFontSize / 2}px`,
            fontSize: `${minFontSize}px`
        };
        if (styles.selected_placeholder_color) {
            placeholderActiveCSS.color = `#${styles.selected_placeholder_color}`;
        }
        inputPlaceholderCSS.paddingTop = `${styles.height / 3}${
            styles.height_unit
        }`;
    }

    const borderStyle = borderStyleFromField(field);
    if (inlineError) borderStyle.borderColor = '#F42525';
    const inputType = rows === undefined ? 'input' : 'textarea';
    return (
        <div
            style={{
                width: `${styles.width}${styles.width_unit}`,
                maxWidth: '100%',
                ...marginStyleFromField(field)
            }}
        >
            {label}
            <div
                style={{
                    position: 'relative',
                    height: `${styles.height}${styles.height_unit}`,
                    width: '100%'
                }}
            >
                <ReactForm.Control
                    id={servar.key}
                    pattern={pattern}
                    style={{
                        height: '100%',
                        width: '100%',
                        ...bootstrapStyles,
                        backgroundColor: `#${styles.background_color}`,
                        boxShadow: `${styles.shadow_x_offset}px ${styles.shadow_y_offset}px ${styles.shadow_blur_radius}px #${styles.shadow_color}`,
                        borderRadius: field.borderRadius,
                        ...fontStyles(styles),
                        ...borderStyle,
                        ...inputPlaceholderCSS
                    }}
                    css={{
                        '&:focus': {
                            boxShadow: `${styles.shadow_x_offset}px ${styles.shadow_y_offset}px ${styles.shadow_blur_radius}px #${styles.shadow_color} !important`,
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
                        left: '0.75rem',
                        transition: '0.2s ease all',
                        lineHeight: `${styles.font_size}px`,
                        ...fontStyles(styles, true),
                        ...(rows === undefined
                            ? {
                                  top: '50%',
                                  marginTop: `-${styles.font_size / 2}px`
                              }
                            : {
                                  top: '0.375rem'
                              }),
                        ...(fieldValue || fieldMask ? placeholderCSS : {}),
                        [`${inputType}:focus + &`]: {
                            ...placeholderCSS,
                            ...placeholderActiveCSS
                        }
                    }}
                >
                    {styles.placeholder || ''}
                </span>
            </div>
            {inlineError && (
                <span
                    style={{
                        alignSelf: 'flex-start',
                        fontFamily: field.styles.font_family,
                        fontSize: `${field.styles.font_size}px`,
                        marginTop: '3px',
                        color: '#F42525'
                    }}
                >
                    {inlineError}
                </span>
            )}
        </div>
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
