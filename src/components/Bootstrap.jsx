import ReactForm from 'react-bootstrap/Form';
import React from 'react';
import { IMaskMixin } from 'react-imask';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

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
        inputPlaceholderCSS.paddingTop = `${styles.field_height / 3}${
            styles.field_height_unit
        }`;
    }

    const borderStyle = borderStyleFromField(field);
    if (inlineError) borderStyle.borderColor = '#F42525';
    return (
        <div
            style={{
                width: `${styles.field_width}${styles.field_width_unit}`,
                maxWidth: '100%',
                ...marginStyleFromField(field)
            }}
        >
            {label}
            <div
                style={{
                    position: 'relative',
                    height: `${styles.field_height}${styles.field_height_unit}`,
                    width: `${styles.field_width}${styles.field_width_unit}`,
                    maxWidth: '100%'
                }}
            >
                <ReactForm.Control
                    id={servar.key}
                    pattern={pattern}
                    style={{
                        maxWidth: '100%',
                        height: `${styles.field_height}${styles.field_height_unit}`,
                        width: `${styles.field_width}${styles.field_width_unit}`,
                        backgroundColor: `#${styles.background_color}`,
                        boxShadow: `${styles.shadow_x_offset}px ${styles.shadow_y_offset}px ${styles.shadow_blur_radius}px #${styles.shadow_color}`,
                        fontSize: `${styles.font_size}px`,
                        color: `#${styles.font_color}`,
                        borderRadius: field.borderRadius,
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
                        left: '13px',
                        top: '50%',
                        marginTop: `-${styles.font_size / 2}px`,
                        transition: '0.2s ease all',
                        color: `#${styles.placeholder_color}`,
                        fontSize: `${styles.font_size}px`,
                        lineHeight: `${styles.font_size}px`,
                        fontStyle: styles.placeholder_italic
                            ? 'italic'
                            : 'normal',
                        ...(fieldValue || fieldMask ? placeholderCSS : {}),
                        'input:focus + &': {
                            ...placeholderCSS,
                            ...placeholderActiveCSS
                        }
                    }}
                >
                    {styles.placeholder || ''}
                </span>
            </div>
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
