import React, { useEffect, useRef, useState } from 'react';
import { isNum } from '../../utils/primitives';

// keyCode constants
const BACKSPACE = 8;
const LEFT_ARROW = 37;
const RIGHT_ARROW = 39;
const DELETE = 46;
const SPACEBAR = 32;

function SingleOtpInput({
    index,
    focus,
    value,
    onChange,
    onKeyDown,
    onInput,
    onPaste,
    onFocus,
    onBlur,
    onClick,
    field,
    inlineError
}) {
    const input = useRef(null);

    useEffect(() => {
        const { current: inputEl } = input;

        // Check if focusedInput changed
        // Prevent calling function if input already in focus
        if (inputEl && focus) {
            inputEl.focus();
            inputEl.select();
        }
    }, [focus, input]);

    const applyStyles = field.applyStyles;
    applyStyles.applyBorders('field', focus ? 'selected_' : '', false);
    return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
                id={`${field.servar.key}-${index}`}
                aria-label={`${
                    index === 0 ? 'Please enter verification code. ' : ''
                }Digit ${index + 1}`}
                css={{
                    textAlign: 'center',
                    marginLeft: '8px',
                    outline: 'none',
                    ...applyStyles.getTarget('field'),
                    ...(inlineError ? { borderColor: '#F42525' } : {}),
                    '&:hover': applyStyles.getTarget('hover')
                }}
                type='tel'
                ref={input}
                value={value || ''}
                onChange={onChange}
                onKeyDown={onKeyDown}
                onInput={onInput}
                onPaste={onPaste}
                onFocus={onFocus}
                onBlur={onBlur}
                onClick={onClick}
            />
        </div>
    );
}

function OtpInput({ onChange, onClick, value, field, inlineError }) {
    const [activeInput, setActiveInput] = useState(0);
    const [rawValue, setRawValue] = useState(value.toString().split(''));

    // Helper to return OTP from input
    const handleOtpChange = (otp) => {
        setRawValue(otp);
        onChange(otp.filter(Boolean).join(''));
    };

    const isInputValueValid = (value) => {
        return isNum(value, 10) && value.trim().length === 1;
    };

    const numInputs = field.servar.max_length;

    // Focus on input by index
    const focusInput = (input) => {
        setActiveInput(Math.max(Math.min(numInputs - 1, input), 0));
    };

    // Focus on next input
    const focusNextInput = () => {
        focusInput(activeInput + 1);
    };

    // Focus on previous input
    const focusPrevInput = () => {
        focusInput(activeInput - 1);
    };

    // Change OTP value at focused input
    const changeCodeAtFocus = (value) => {
        const newVal = JSON.parse(JSON.stringify(rawValue));
        newVal[activeInput] = value[0];
        handleOtpChange(newVal);
    };

    const handleMultipleValues = (vals) => {
        if (isNaN(parseInt(vals, 10))) return;

        const newVal = JSON.parse(JSON.stringify(rawValue));
        let nextActiveInput = activeInput;

        // Paste data from focused input onwards
        for (let pos = 0; pos < numInputs; ++pos) {
            if (pos >= activeInput && vals.length > 0) {
                newVal[pos] = vals.shift();
                nextActiveInput++;
            }
        }

        setActiveInput(nextActiveInput);
        focusInput(nextActiveInput);
        handleOtpChange(newVal);
    };

    // Handle pasted OTP
    const handleOnPaste = (e) => {
        e.preventDefault();

        // Get pastedData in an array of max size (num of inputs - current position)
        const pastedData = e.clipboardData
            .getData('text/plain')
            .slice(0, numInputs - activeInput)
            .split('');
        handleMultipleValues(pastedData);
    };

    const handleOnChange = (e) => {
        const { value } = e.target;
        handleMultipleValues(value.split(''));
    };

    // Handle cases of backspace, delete, left arrow, right arrow, space
    const handleOnKeyDown = (e) => {
        if (e.keyCode === BACKSPACE || e.key === 'Backspace') {
            e.preventDefault();
            changeCodeAtFocus('');
            focusPrevInput();
        } else if (e.keyCode === DELETE || e.key === 'Delete') {
            e.preventDefault();
            changeCodeAtFocus('');
        } else if (e.keyCode === LEFT_ARROW || e.key === 'ArrowLeft') {
            e.preventDefault();
            focusPrevInput();
        } else if (e.keyCode === RIGHT_ARROW || e.key === 'ArrowRight') {
            e.preventDefault();
            focusNextInput();
        } else if (
            e.keyCode === SPACEBAR ||
            e.key === ' ' ||
            e.key === 'Spacebar' ||
            e.key === 'Space'
        ) {
            e.preventDefault();
        }
    };

    // The content may not have changed, but some input took place hence change the focus
    const handleOnInput = (e) => {
        if (isInputValueValid(e.target.value)) {
            focusNextInput();
        }
    };

    const renderInputs = () => {
        const inputs = [];

        for (let i = 0; i < numInputs; i++) {
            inputs.push(
                <SingleOtpInput
                    key={`${field.servar.key}-${i}`}
                    index={i}
                    focus={activeInput === i}
                    value={rawValue[i]}
                    onChange={handleOnChange}
                    onKeyDown={handleOnKeyDown}
                    onInput={handleOnInput}
                    onPaste={handleOnPaste}
                    onFocus={(e) => {
                        setActiveInput(i);
                        e.target.select();
                    }}
                    onBlur={() => setActiveInput(-1)}
                    onClick={onClick}
                    field={field}
                    inlineError={inlineError}
                />
            );
        }

        return inputs;
    };

    return (
        <div
            css={{
                display: 'flex',
                flexDirection: 'row',
                ...field.applyStyles.getTarget('fc')
            }}
        >
            {renderInputs()}
        </div>
    );
}

function FeatheryPinInput({
    field,
    fieldLabel,
    fieldVal,
    onClick,
    onChange,
    inlineError
}) {
    return (
        <div style={{ display: 'flex' }}>
            {fieldLabel}
            <OtpInput
                value={fieldVal}
                field={field}
                onChange={onChange}
                onClick={onClick}
                inlineError={inlineError}
            />
            {inlineError && (
                <span
                    css={{
                        alignSelf: 'flex-start',
                        marginTop: '3px',
                        color: '#F42525',
                        ...field.applyStyles.getTarget('error')
                    }}
                >
                    {inlineError}
                </span>
            )}
        </div>
    );
}

export default FeatheryPinInput;
