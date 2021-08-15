import React, { useEffect, useRef, useState } from 'react';
import { borderStyleFromField, marginStyleFromField } from '../utils/styles';

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
    hoverCSS,
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

    const borderStyle = borderStyleFromField(
        field,
        focus ? 'selected_' : '',
        false
    );
    if (inlineError) borderStyle.borderColor = '#F42525';
    return (
        <div style={{ display: 'flex', alignItems: 'center' }}>
            <input
                id={`${field.servar.key}-${index}`}
                aria-label={`${
                    index === 0 ? 'Please enter verification code. ' : ''
                }Digit ${index + 1}`}
                autoComplete='off'
                style={{
                    textAlign: 'center',
                    marginLeft: '8px',
                    outline: 'none',
                    height: `${field.styles.height}${field.styles.height_unit}`,
                    width: `${field.styles.width}${field.styles.width_unit}`,
                    backgroundColor: `#${field.styles.background_color}`,
                    boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color}`,
                    fontSize: `${field.styles.font_size}px`,
                    color: `#${field.styles.font_color}`,
                    borderRadius: field.borderRadius,
                    ...borderStyle
                }}
                css={{
                    '&::placeholder': {
                        color: `#${field.styles.font_color} !important`
                    },
                    '&:focus': {
                        boxShadow: `${field.styles.shadow_x_offset}px ${field.styles.shadow_y_offset}px ${field.styles.shadow_blur_radius}px #${field.styles.shadow_color} !important`
                    },
                    '&:hover': hoverCSS
                }}
                type='tel'
                maxLength='1'
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

function OtpInput({ onChange, onClick, value, field, hoverCSS, inlineError }) {
    const [activeInput, setActiveInput] = useState(0);
    const [rawValue, setRawValue] = useState(value.toString().split(''));

    // Helper to return OTP from input
    const handleOtpChange = (otp) => {
        setRawValue(otp);
        onChange(otp.filter(Boolean).join(''));
    };

    const isInputValueValid = (value) => {
        return !isNaN(parseInt(value, 10)) && value.trim().length === 1;
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

    // Handle pasted OTP
    const handleOnPaste = (e) => {
        e.preventDefault();

        // Get pastedData in an array of max size (num of inputs - current position)
        const pastedData = e.clipboardData
            .getData('text/plain')
            .slice(0, numInputs - activeInput)
            .split('');
        if (isNaN(parseInt(pastedData, 10))) return;

        const newVal = JSON.parse(JSON.stringify(rawValue));
        let nextActiveInput = activeInput;

        // Paste data from focused input onwards
        for (let pos = 0; pos < numInputs; ++pos) {
            if (pos >= activeInput && pastedData.length > 0) {
                newVal[pos] = pastedData.shift();
                nextActiveInput++;
            }
        }

        setActiveInput(nextActiveInput);
        focusInput(nextActiveInput);
        handleOtpChange(newVal);
    };

    const handleOnChange = (e) => {
        const { value } = e.target;
        if (isInputValueValid(value)) changeCodeAtFocus(value);
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
                    hoverCSS={hoverCSS}
                    inlineError={inlineError}
                />
            );
        }

        return inputs;
    };

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'row',
                ...marginStyleFromField(field)
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
    hoverCSS,
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
                hoverCSS={hoverCSS}
                inlineError={inlineError}
            />
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

export default FeatheryPinInput;
