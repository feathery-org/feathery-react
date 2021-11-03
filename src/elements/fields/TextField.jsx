import React, { useState, useRef, memo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import {
    emailPatternStr,
    generateRegexString
} from '../../utils/formHelperFunctions';

import format from 'string-format';
format.extend(String.prototype, {
    defaultDigit: (s, index) => (s === '' ? '0' : s),
    defaultChar: (s) => (s === '' ? 'a' : s),
    defaultMaskChar: (s) => (s === '' ? '_' : s),
    defaultMaskDigit: (s) => (s === '' ? '_' : s)
});

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
                as: 'textarea',
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

function getFieldMaskMeta(fieldMask) {
    if (fieldMask === '' || fieldMask === undefined || fieldMask === null)
        return {
            fieldMaskRegex: '',
            fieldMaskComparisionString: '',
            fieldMaskString: '',
            deterministicPattern: true
        };

    const [
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern
    ] = generateRegexString(fieldMask);

    return {
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern
    };
}

const validateNewFieldValue = (
    event,
    rawFieldValue,
    rawCaretPos,
    maskedCaretPos,
    regexFieldMask,
    patternFieldMask,
    deterministicPattern,
    setRawFieldValue
) => {
    const anyCharRegex = '^\\w$';
    let tempRawValue = rawFieldValue;

    if (event.key.search(anyCharRegex) === 0) {
        tempRawValue =
            tempRawValue.substring(0, rawCaretPos.current) +
            event.key +
            tempRawValue.substring(rawCaretPos.current + 1);

        const newPatternFieldMask = patternFieldMask.current.format(
            ...tempRawValue
        );

        if (newPatternFieldMask.search(regexFieldMask) === 0) {
            setRawFieldValue(tempRawValue);
            rawCaretPos.current += 1;
            maskedCaretPos.current += 1;
        }
    } else if (event.key === 'Backspace') {
        tempRawValue =
            tempRawValue.slice(0, rawCaretPos.current - 1) +
            tempRawValue.slice(rawCaretPos.current);

        const newPatternFieldMask = patternFieldMask.current.format(
            ...tempRawValue
        );

        if (newPatternFieldMask.search(regexFieldMask) === 0) {
            setRawFieldValue(tempRawValue);
            rawCaretPos.current -= 1;
            maskedCaretPos.current -= 1;
        }
    } else if (event.key === 'Delete') {
        tempRawValue =
            tempRawValue.slice(0, rawCaretPos.current - 1) +
            tempRawValue.slice(rawCaretPos.current + 1);
        const newPatternFieldMask = patternFieldMask.current.format(
            ...tempRawValue
        );

        if (newPatternFieldMask.search(regexFieldMask) === 0) {
            setRawFieldValue(tempRawValue);
        }
    }
};

function TextField({
    element,
    applyStyles,
    fieldLabel,
    required = false,
    fieldValue = '',
    onChange = () => {},
    onClick = () => {},
    inlineError,
    inputRef,
    ...fieldProps
}) {
    const servar = element.servar;
    const {
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern
    } = getFieldMaskMeta('$ {{ \\d{4} }} / year');

    const [rawFieldValue, setRawFieldValue] = useState('');
    const fieldValueComparisionMask = useRef(fieldMaskComparisionString);
    const fieldValueMask = useRef(fieldMaskString);
    const rawCaretPos = useRef(0);
    const maskedCaretPos = useRef(4);

    const inputType = fieldProps.as === 'textarea' ? 'textarea' : 'input';
    return (
        <div
            css={{
                maxWidth: '100%',
                ...applyStyles.getTarget('fc')
            }}
        >
            {fieldLabel}
            <div
                css={{
                    position: 'relative',
                    width: '100%',
                    ...(inputType === 'textarea'
                        ? {}
                        : {
                              whiteSpace: 'nowrap',
                              overflowX: 'hidden'
                          }),
                    ...applyStyles.getTarget('sub-fc')
                }}
            >
                <ReactForm.Control
                    id={servar.key}
                    css={{
                        height: '100%',
                        width: '100%',
                        ...bootstrapStyles,
                        ...applyStyles.getTarget('field'),
                        ...(inlineError ? { borderColor: '#F42525' } : {}),
                        '&:focus': applyStyles.getTarget('active'),
                        '&:hover': applyStyles.getTarget('hover'),
                        '&:not(:focus)':
                            fieldValue || !element.placeholder
                                ? {}
                                : { color: 'transparent' }
                    }}
                    maxLength={servar.max_length}
                    minLength={servar.min_length}
                    required={required}
                    onChange={onChange}
                    onClick={onClick}
                    onKeyDown={(e) => {
                        validateNewFieldValue(
                            e,
                            rawFieldValue,
                            rawCaretPos,
                            maskedCaretPos,
                            fieldMaskRegex,
                            fieldValueComparisionMask,
                            deterministicPattern,
                            setRawFieldValue
                        );
                        if (e.key === 'Enter' && inputType === 'textarea')
                            e.stopPropagation();
                    }}
                    autoComplete={servar.metadata.autocomplete || 'on'}
                    data-rawvalue={rawFieldValue}
                    ref={inputRef}
                    placeholder=''
                    {...fieldProps}
                    value={
                        fieldValueMask.current.format(...rawFieldValue) ||
                        rawFieldValue
                    }
                />
                <span
                    css={{
                        position: 'absolute',
                        pointerEvents: 'none',
                        left: '0.75rem',
                        transition: '0.2s ease all',
                        top: inputType === 'textarea' ? '0.375rem' : '50%',
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
                    {fieldValueMask.current.format(...rawFieldValue) ||
                        rawFieldValue}
                </span>
                {element.tooltipText && (
                    <InlineTooltip
                        id={`tooltip-${element.id}`}
                        text={element.tooltipText}
                        applyStyles={applyStyles}
                    />
                )}
            </div>
        </div>
    );
}

const MaskedPropsTextField = ({ element, fieldValue = '', ...props }) => {
    const servar = element.servar;
    const fieldProps = getTextFieldProps(servar, element.styles, fieldValue);

    return (
        <TextField
            element={element}
            fieldValue={fieldValue}
            {...props}
            {...fieldProps}
        />
    );
};

export default memo(MaskedPropsTextField);
