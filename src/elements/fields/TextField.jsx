import React, { useState, useRef, memo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import { emailPatternStr } from '../../utils/formHelperFunctions';
import { generateRegexString } from '../../utils/strings';
import { useHotkeys } from 'react-hotkeys-hook';

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
    const defaultSettings = {
        fieldMaskRegex: '',
        fieldMaskComparisionString: '',
        fieldMaskString: '',
        deterministicPattern: true,
        maxRawInputLength: Infinity,
        maskedCaretPos: 0
    };
    if (!fieldMask) return defaultSettings;

    const [
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern,
        maxRawInputLength,
        maskedCaretPos
    ] = generateRegexString(fieldMask, defaultSettings);

    return {
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern,
        maxRawInputLength,
        maskedCaretPos
    };
}

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
        deterministicPattern,
        maxRawInputLength,
        maskedCaretPos: caretPos
    } = getFieldMaskMeta(servar.field_mask);

    const [rawFieldValue, setRawFieldValue] = useState('');
    const patternFieldMask = useRef(fieldMaskComparisionString);
    const fieldValueMask = useRef(fieldMaskString);
    const rawCaretPos = useRef(0);
    const maskedCaretPos = useRef(caretPos);

    const inputType = fieldProps.as === 'textarea' ? 'textarea' : 'input';

    // Most of the following key combinations perform their default operations like delete, paste.
    // We had to include 'v' in this set of hot keys because, the char 'v' can be part of user input as well.
    // So, if we do not handle this case properly, paste operation will be triggered and
    // also the second useHotKeys effect also takes place. So, along with pasting the text,
    // we will see an additional 'v' in the user input.
    useHotkeys(
        'backspace, delete, ctrl+v, command+v, left, right, v, enter',
        (e, handler) => {
            let tempRawValue = '';
            let newPatternFieldMask = '';

            switch (handler.key) {
                case 'v':
                    if (rawFieldValue.length >= maxRawInputLength) return;
                    tempRawValue =
                        rawFieldValue.substring(0, rawCaretPos.current) +
                        e.key +
                        rawFieldValue.substring(rawCaretPos.current + 1);

                    newPatternFieldMask = patternFieldMask.current.format(
                        ...tempRawValue
                    );

                    if (newPatternFieldMask.search(fieldMaskRegex) === 0) {
                        setRawFieldValue(tempRawValue);
                        rawCaretPos.current += 1;
                        maskedCaretPos.current += 1;
                    }
                    break;
                case 'enter':
                    if (inputType === 'textarea') e.stopPropagation();
                    break;
                case 'backspace':
                    tempRawValue =
                        rawFieldValue.slice(0, rawCaretPos.current - 1) +
                        rawFieldValue.slice(rawCaretPos.current);

                    newPatternFieldMask = patternFieldMask.current.format(
                        ...tempRawValue
                    );

                    if (newPatternFieldMask.search(fieldMaskRegex) === 0) {
                        setRawFieldValue(tempRawValue);
                        rawCaretPos.current -= 1;
                        maskedCaretPos.current -= 1;
                    }
                    break;

                case 'delete':
                    tempRawValue =
                        rawFieldValue.slice(0, rawCaretPos.current - 1) +
                        rawFieldValue.slice(rawCaretPos.current + 1);

                    newPatternFieldMask = patternFieldMask.current.format(
                        ...tempRawValue
                    );

                    if (newPatternFieldMask.search(fieldMaskRegex) === 0) {
                        setRawFieldValue(tempRawValue);
                    }
                    break;
                case 'control+v':
                case 'command+v':
                    navigator.clipboard.readText().then((clipboardText) => {
                        console.log(clipboardText);
                        tempRawValue =
                            rawFieldValue.substring(0, rawCaretPos.current) +
                            clipboardText +
                            rawFieldValue.substring(rawCaretPos.current + 1);

                        newPatternFieldMask = patternFieldMask.current.format(
                            ...tempRawValue
                        );

                        if (newPatternFieldMask.search(fieldMaskRegex) === 0) {
                            setRawFieldValue(tempRawValue);
                            rawCaretPos.current = e.target.selectionEnd;
                            maskedCaretPos.current += 1;
                        }
                    });
                    break;
                default:
                    break;
            }
        },
        {
            enableOnTags: ['INPUT', 'TEXTAREA']
        }
    );

    useHotkeys(
        '*',
        (e, handler) => {
            if (rawFieldValue.length >= maxRawInputLength) return;
            const anyCharRegex = '^[vV]$';
            let tempRawValue = '';

            if (e.key.search(anyCharRegex) === -1) {
                tempRawValue =
                    rawFieldValue.substring(0, rawCaretPos.current) +
                    e.key +
                    rawFieldValue.substring(rawCaretPos.current + 1);

                const newPatternFieldMask = patternFieldMask.current.format(
                    ...tempRawValue
                );

                if (newPatternFieldMask.search(fieldMaskRegex) === 0) {
                    setRawFieldValue(tempRawValue);
                    rawCaretPos.current += 1;
                    maskedCaretPos.current += 1;
                }
            }
        },
        {
            enableOnTags: ['INPUT', 'TEXTAREA']
        }
    );

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
