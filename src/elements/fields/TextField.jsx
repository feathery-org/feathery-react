import React, { memo } from 'react';

import { IMaskMixin } from 'react-imask';
import InlineTooltip from '../../components/Tooltip';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../../utils/styles';
import { emailPatternStr } from '../../utils/formHelperFunctions';

const TextField = memo(
    ({
        label,
        required,
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
    }) => {
        const { servar, applyStyles } = field;

        if (rows) {
            props.rows = rows;
            props.as = type;
        } else props.type = type;

        if (props.inputRef) {
            props.ref = props.inputRef;
            delete props.inputRef;
        } else props.defaultValue = fieldValue || '';

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
                            '&:hover': applyStyles.getTarget('hover'),
                            '&:not(:focus)':
                                fieldValue || !field.placeholder
                                    ? {}
                                    : { color: 'transparent' }
                        }}
                        maxLength={servar.max_length}
                        minLength={servar.min_length}
                        required={required}
                        onChange={onChange}
                        onClick={onClick}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && inputType === 'textarea')
                                e.stopPropagation();
                        }}
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
                            ...(fieldValue
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
                    {field.tooltipText && (
                        <InlineTooltip
                            id={field.id}
                            text={field.tooltipText}
                            applyStyles={applyStyles}
                        />
                    )}
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
);

const MaskedTextField = memo(IMaskMixin((props) => <TextField {...props} />));

function textFieldShouldSubmit(servar, value) {
    let methods, onlyPhone;
    switch (servar.type) {
        case 'login':
            methods = servar.metadata.login_methods;
            onlyPhone = methods.length === 1 && methods[0] === 'phone';
            return onlyPhone && value.length === 10;
        case 'phone_number':
            return value.length === 10;
        case 'ssn':
            return value.length === 9;
        default:
            return false;
    }
}

function getTextFieldProps(servar, styles, value) {
    let methods, onlyPhone;
    switch (servar.type) {
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
                value: value.toString(),
                type: 'tel'
            };
        case 'email':
            return {
                mask: /.+/,
                type: 'email',
                pattern: emailPatternStr,
                value
            };
        case 'login':
            methods = servar.metadata.login_methods;
            onlyPhone = methods.length === 1 && methods[0] === 'phone';
            return {
                mask: methods.map((method) => {
                    return {
                        method,
                        mask: method === 'phone' ? '(000) 000-0000' : /.+/
                    };
                }),
                type: onlyPhone ? 'tel' : 'text',
                value
            };
        case 'phone_number':
            return {
                mask: '(000) 000-0000',
                type: 'tel',
                value
            };
        case 'ssn':
            return {
                mask: '000 - 00 - 0000',
                type: 'tel',
                value
            };
        case 'text_area':
            return {
                mask: /.+/,
                type: 'textarea',
                rows: styles.num_rows,
                value
            };
        case 'url':
            return {
                mask: /.+/,
                type: 'url',
                value
            };
        default:
            return {
                mask: servar.metadata.only_alpha ? /^[a-z0-9]*$/i : /.*/,
                value
            };
    }
}

export { MaskedTextField, getTextFieldProps, textFieldShouldSubmit };
