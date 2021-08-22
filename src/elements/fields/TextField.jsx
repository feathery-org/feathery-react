import { bootstrapStyles } from '../../utils/styles';

import { IMaskMixin } from 'react-imask';
import React from 'react';
import ReactForm from 'react-bootstrap/Form';

function BootstrapField({
    label,
    field,
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
    const { servar, applyStyles } = field;

    if (rows) {
        props.rows = rows;
        props.as = type;
    } else props.type = type;

    if (props.inputRef) {
        props.ref = props.inputRef;
        delete props.inputRef;
    } else props.value = fieldValue || '';

    const inputType = rows === undefined ? 'input' : 'textarea';
    return (
        <div
            css={{
                maxWidth: '100%',
                ...applyStyles.getTarget('fc')
            }}
        >
            {label}
            <div
                css={{
                    position: 'relative',
                    width: '100%',
                    ...applyStyles.getTarget('sub-fc')
                }}
            >
                <ReactForm.Control
                    id={servar.key}
                    pattern={pattern}
                    css={{
                        height: '100%',
                        width: '100%',
                        ...bootstrapStyles,
                        ...applyStyles.getTarget('field'),
                        ...(inlineError ? { borderColor: '#F42525' } : {}),
                        '&:focus': applyStyles.getTarget('active'),
                        '&:hover': applyStyles.getTarget('hover')
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
                        top: rows === undefined ? '50%' : '0.375rem',
                        ...applyStyles.getTarget('placeholder'),
                        ...(fieldValue || fieldMask
                            ? applyStyles.getTarget('placeholderFocus')
                            : {}),
                        [`${inputType}:focus + &`]: {
                            ...applyStyles.getTarget('placeholderFocus'),
                            ...applyStyles.getTarget('placeholderActive')
                        }
                    }}
                >
                    {field.placeholder || ''}
                </span>
            </div>
            {inlineError && (
                <span
                    css={{
                        alignSelf: 'flex-start',
                        marginTop: '3px',
                        color: '#F42525',
                        ...applyStyles.getTarget('error')
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
