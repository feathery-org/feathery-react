import React, {
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    memo
} from 'react';
import ReactForm from 'react-bootstrap/Form';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import { emailPatternStr } from '../../utils/formHelperFunctions';
import {
    calculateCaretPosition,
    calculateArrowNavigatonCaretPos,
    generateRegexString,
    partialMatchRegex
} from '../../utils/strings';
import { useHotkeys } from 'react-hotkeys-hook';

import format from 'string-format';
format.extend(String.prototype, {
    defaultDigit: (s) => (s === '' ? '0' : s),
    defaultChar: (s) => (s === '' ? 'a' : s),
    defaultMaskChar: (s) => (s === '' ? '_' : s),
    defaultMaskDigit: (s) => (s === '' ? '_' : s)
});

// Extending RegExp module to support partial matches.
// This is needed for evaluating non-deterministic patterns.
RegExp.prototype.toPartialMatchRegex = partialMatchRegex;

const REGEX_FULL_MATCH = 1;
const REGEX_PARTIAL_MATCH = 0;
const REGEX_NO_MATCH = -1;

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
        identifiedRegex: '',
        fieldMaskRegex: '',
        fieldMaskComparisionString: '',
        fieldMaskString: '',
        deterministicPattern: true,
        maxRawInputLength: Infinity,
        adjustedIndices: [0]
    };
    if (!fieldMask) return defaultSettings;

    const [
        identifiedRegex,
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern,
        maxRawInputLength,
        adjustedIndices
    ] = generateRegexString(fieldMask, defaultSettings);

    return {
        identifiedRegex,
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern,
        maxRawInputLength,
        adjustedIndices
    };
}

function validateNewRawValue(
    rawValue,
    identifiedRegex,
    fieldMaskRegex,
    fieldMaskPattern,
    deterministicPattern
) {
    if (deterministicPattern) {
        const newfieldMaskPattern = fieldMaskPattern.format(...rawValue);

        if (newfieldMaskPattern.search(fieldMaskRegex) === 0) return true;
        return false;
    } else {
        const regex = new RegExp(identifiedRegex);
        let partialMatchRegex = regex.toPartialMatchRegex();
        let result = partialMatchRegex.exec(rawValue);

        let matchType = regex.exec(rawValue)
            ? REGEX_FULL_MATCH
            : result && result[0]
            ? REGEX_PARTIAL_MATCH
            : REGEX_NO_MATCH;

        if (matchType === REGEX_FULL_MATCH || matchType === REGEX_PARTIAL_MATCH)
            return true;
        return false;
    }
}

function TextField({
    element,
    applyStyles,
    fieldLabel,
    fieldMaskProps,
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
        identifiedRegex,
        fieldMaskRegex,
        fieldMaskComparisionString,
        fieldMaskString,
        deterministicPattern,
        maxRawInputLength,
        adjustedIndices: validIndices
    } = fieldMaskProps;

    const [rawFieldValue, setRawFieldValue] = useState('');
    const rawCaretPos = useRef(0);
    const isComplete = useRef(false);
    const textFieldRef = useRef(null);

    const fieldMaskValue = fieldMaskString;
    const fieldMaskPattern = fieldMaskComparisionString;
    const inputType = fieldProps.as === 'textarea' ? 'textarea' : 'input';

    let maskedCaretPos = deterministicPattern
        ? validIndices[rawCaretPos.current]
        : validIndices[0] + rawCaretPos.current;
    if (deterministicPattern && rawCaretPos.current >= validIndices.length) {
        maskedCaretPos = validIndices.at(-1) + 1;
    } else if (rawCaretPos.current <= 0) maskedCaretPos = validIndices[0];

    useEffect(() => {
        setTimeout(
            () =>
                textFieldRef.current.setSelectionRange(
                    maskedCaretPos,
                    maskedCaretPos
                ),
            0
        );
        // textFieldRef.current.setSelectionRange(maskedCaretPos, maskedCaretPos);
    }, [rawFieldValue]);

    // Most of the following key combinations perform their default operations like delete, paste.
    // We had to include 'v' in this set of hot keys because, the char 'v' can be part of user input as well.
    // So, if we do not handle this case properly, paste operation will be triggered and
    // also the second useHotKeys effect also takes place. So, along with pasting the text,
    // we will see an additional 'v' in the user input.
    useHotkeys(
        'backspace, delete, ctrl+v, command+v, left, right, v, enter',
        (e, handler) => {
            let tempRawValue = '';
            let newFieldMaskPattern = '';
            let isValid = false;
            let newPos;
            switch (handler.key) {
                case 'v':
                    if (rawFieldValue.length >= maxRawInputLength) {
                        isComplete.current = true;
                        return;
                    }
                    tempRawValue =
                        rawFieldValue.substring(0, rawCaretPos.current) +
                        e.key +
                        rawFieldValue.substring(rawCaretPos.current);
                    isValid = validateNewRawValue(
                        tempRawValue,
                        identifiedRegex,
                        fieldMaskRegex,
                        fieldMaskPattern,
                        deterministicPattern
                    );

                    if (isValid) {
                        rawCaretPos.current += 1;
                        if (
                            tempRawValue.length === maxRawInputLength ||
                            !deterministicPattern
                        )
                            isComplete.current = true;
                        setRawFieldValue(tempRawValue);
                    } else setRawFieldValue(rawFieldValue);
                    break;
                case 'enter':
                    if (inputType === 'textarea') e.stopPropagation();
                    break;
                case 'backspace':
                    tempRawValue =
                        rawFieldValue.slice(0, rawCaretPos.current - 1) +
                        rawFieldValue.slice(rawCaretPos.current);

                    isValid = validateNewRawValue(
                        tempRawValue,
                        identifiedRegex,
                        fieldMaskRegex,
                        fieldMaskPattern,
                        deterministicPattern
                    );

                    if (isValid) {
                        rawCaretPos.current -= 1;
                        isComplete.current = false;
                        setRawFieldValue(tempRawValue);
                    }
                    break;
                case 'delete':
                    tempRawValue =
                        rawFieldValue.slice(0, rawCaretPos.current) +
                        rawFieldValue.slice(rawCaretPos.current + 1);

                    newFieldMaskPattern = fieldMaskPattern.format(
                        ...tempRawValue
                    );

                    if (newFieldMaskPattern.search(fieldMaskRegex) === 0) {
                        isComplete.current = false;
                        setRawFieldValue(tempRawValue);
                    }
                    break;
                case 'control+v':
                case 'command+v':
                    navigator.clipboard.readText().then((clipboardText) => {
                        tempRawValue =
                            rawFieldValue.substring(0, rawCaretPos.current) +
                            clipboardText +
                            rawFieldValue.substring(rawCaretPos.current);

                        const endFlag = tempRawValue.length > maxRawInputLength;

                        if (tempRawValue.length > maxRawInputLength) {
                            tempRawValue = tempRawValue.substring(
                                0,
                                maxRawInputLength
                            );
                            console.log(tempRawValue);
                        }

                        isValid = validateNewRawValue(
                            tempRawValue,
                            identifiedRegex,
                            fieldMaskRegex,
                            fieldMaskPattern,
                            deterministicPattern
                        );

                        if (isValid) {
                            if (endFlag) {
                                rawCaretPos.current = maxRawInputLength;
                                isComplete.current = true;
                            } else {
                                rawCaretPos.current += tempRawValue.length;
                                isComplete.current = false;
                            }

                            setRawFieldValue(tempRawValue);
                        }
                    });
                    break;
                case 'left':
                    newPos = calculateArrowNavigatonCaretPos(
                        rawCaretPos.current,
                        e.target.selectionStart - 1,
                        validIndices,
                        rawFieldValue
                    );
                    if (newPos !== -1) rawCaretPos.current = newPos;
                    break;
                case 'right':
                    newPos = calculateArrowNavigatonCaretPos(
                        rawCaretPos.current,
                        e.target.selectionStart + 1,
                        validIndices,
                        rawFieldValue
                    );
                    if (newPos !== -1) rawCaretPos.current = newPos;
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
        (e) => {
            if (rawFieldValue.length >= maxRawInputLength) {
                isComplete.current = true;
                return;
            }
            const anyCharRegex = '^[vV]$';
            let tempRawValue = '';

            if (e.key.search(anyCharRegex) === -1 && e.key.length === 1) {
                tempRawValue =
                    rawFieldValue.substring(0, rawCaretPos.current) +
                    e.key +
                    rawFieldValue.substring(rawCaretPos.current);

                const isValid = validateNewRawValue(
                    tempRawValue,
                    identifiedRegex,
                    fieldMaskRegex,
                    fieldMaskPattern,
                    deterministicPattern
                );

                if (isValid) {
                    rawCaretPos.current += 1;
                    if (
                        tempRawValue.length === maxRawInputLength ||
                        !deterministicPattern
                    )
                        isComplete.current = true;
                    setRawFieldValue(tempRawValue);
                } else setRawFieldValue(rawFieldValue);
            }
        },
        {
            enableOnTags: ['INPUT', 'TEXTAREA']
        }
    );

    const onFocusGain = (e) => {
        if (deterministicPattern) {
            const newPos = calculateCaretPosition(
                rawCaretPos.current,
                e.target.selectionStart,
                validIndices,
                rawFieldValue
            );
            rawCaretPos.current = newPos;
            textFieldRef.current.setSelectionRange(
                validIndices[newPos],
                validIndices[newPos]
            );
        } else {
            textFieldRef.current.setSelectionRange(
                maskedCaretPos,
                maskedCaretPos
            );
        }
    };

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
                    onMouseUp={onFocusGain}
                    onFocus={onFocusGain}
                    autoComplete={servar.metadata.autocomplete || 'on'}
                    data-rawvalue={rawFieldValue}
                    data-iscomplete={isComplete.current}
                    ref={textFieldRef}
                    placeholder=''
                    {...fieldProps}
                    value={
                        (deterministicPattern
                            ? fieldMaskValue.format(...rawFieldValue)
                            : fieldMaskValue.format(rawFieldValue)) ||
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
                    {(deterministicPattern
                        ? fieldMaskValue.format(...rawFieldValue)
                        : fieldMaskValue.format(rawFieldValue)) ||
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
    const fieldMaskProps = getFieldMaskMeta(servar.field_mask);

    return (
        <TextField
            element={element}
            fieldValue={fieldValue}
            fieldMaskProps={fieldMaskProps}
            {...props}
            {...fieldProps}
        />
    );
};

export default memo(MaskedPropsTextField);
