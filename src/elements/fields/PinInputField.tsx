import React, { useEffect, useRef, useState } from 'react';
import { isNum } from '../../utils/primitives';
import { useHotkeys } from 'react-hotkeys-hook';
import { ERROR_COLOR } from '../styles';

function SingleOtpInput({
  index,
  focus,
  value,
  onChange,
  onInput,
  paste,
  onPaste,
  onFocus,
  onBlur,
  element,
  applyStyles,
  inlineError,
  changeCodeAtFocus,
  focusPrevInput,
  focusNextInput,
  shouldFocus
}: any) {
  const input = useRef(null);

  useEffect(() => {
    const { current: inputEl } = input;
    // Check if focusedInput changed
    // Prevent calling function if input already in focus
    if (inputEl && focus) {
      (inputEl as any).focus();
      (inputEl as any).select();
      if (paste) {
        (inputEl as any).selectionStart = (inputEl as any).selectionEnd;
      }
    }
  }, [focus, input]);

  applyStyles.applyBorders({
    target: 'field',
    prefix: focus ? 'selected_' : '',
    important: false
  });

  // Handle cases of backspace, delete, left arrow, right arrow, space
  useHotkeys(
    'enter, backspace, delete, left, right, space',
    (e, handler) => {
      if (!shouldFocus) return;
      switch (handler.key) {
        case 'enter':
          e.preventDefault();
          break;
        case 'backspace':
          e.preventDefault();
          changeCodeAtFocus('');
          focusPrevInput();
          break;
        case 'delete':
          e.preventDefault();
          changeCodeAtFocus('');
          break;
        case 'left':
          e.preventDefault();
          focusPrevInput();
          break;
        case 'right':
          e.preventDefault();
          focusNextInput();
          break;
        case 'space':
          e.preventDefault();
          break;
      }
    },
    {
      enableOnTags: ['INPUT']
    }
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <input
        id={`${element.servar.key}-${index}`}
        aria-label={`${
          index === 0 ? 'Please enter verification code. ' : ''
        }Digit ${index + 1}`}
        css={{
          textAlign: 'center',
          marginLeft: '8px',
          outline: 'none',
          ...applyStyles.getTarget('field'),
          ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
          '&:hover': applyStyles.getTarget('hover')
        }}
        type='tel'
        ref={input}
        value={value || ''}
        onChange={onChange}
        onInput={onInput}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    </div>
  );
}

function OtpInput({
  element,
  applyStyles,
  shouldFocus,
  onChange,
  value,
  inlineError
}: any) {
  const [activeInput, setActiveInput] = useState(shouldFocus ? 0 : -1);
  const [pasted, setPasted] = useState(false);
  const [rawValue, setRawValue] = useState(value.toString().split(''));

  useEffect(() => {
    if (value !== rawValue) setRawValue(value);
  }, [value]);

  // Helper to return OTP from input
  const handleOtpChange = (otp: any) => {
    setRawValue(otp);
    onChange(otp.filter(Boolean).join(''));
  };

  const isInputValueValid = (value: any) => {
    // @ts-expect-error TS(2554): Expected 1 arguments, but got 2.
    return isNum(value, 10) && value.trim().length === 1;
  };

  const numInputs = element.servar.max_length;

  // Focus on input by index
  const focusInput = (input: any) => {
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
  const changeCodeAtFocus = (value: any) => {
    const newVal = JSON.parse(JSON.stringify(rawValue));
    newVal[activeInput] = value[0];
    handleOtpChange(newVal);
  };

  const handleMultipleValues = (vals: any) => {
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
  const handleOnPaste = (e: any) => {
    e.preventDefault();

    // Get pastedData in an array of max size (num of inputs - current position)
    const pastedData = e.clipboardData
      .getData('text/plain')
      .slice(0, numInputs - activeInput)
      .split('');
    const inputLength = pastedData.length;
    handleMultipleValues(pastedData);
    if (activeInput + inputLength >= numInputs) {
      setPasted(true);
    }
  };

  const handleOnChange = (e: any) => {
    const { value } = e.target;
    handleMultipleValues(value.split(''));
  };

  // The content may not have changed, but some input took place hence change the focus
  const handleOnInput = (e: any) => {
    if (isInputValueValid(e.target.value)) {
      focusNextInput();
    }
  };

  const renderInputs = () => {
    const inputs = [];

    for (let i = 0; i < numInputs; i++) {
      inputs.push(
        <SingleOtpInput
          key={`${element.servar.key}-${i}`}
          index={i}
          focus={activeInput === i}
          value={rawValue[i]}
          onChange={handleOnChange}
          onInput={handleOnInput}
          paste={pasted}
          onPaste={handleOnPaste}
          onFocus={(e: any) => {
            setActiveInput(i);
            setPasted(false);
            e.target.select();
          }}
          onBlur={() => setActiveInput(-1)}
          element={element}
          applyStyles={applyStyles}
          inlineError={inlineError}
          changeCodeAtFocus={changeCodeAtFocus}
          focusPrevInput={focusPrevInput}
          focusNextInput={focusNextInput}
          shouldFocus={shouldFocus}
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
        ...applyStyles.getTarget('fc')
      }}
    >
      {renderInputs()}
    </div>
  );
}

function PinInputField({
  element,
  applyStyles,
  fieldLabel,
  inlineError,
  shouldFocus = false,
  fieldVal = '',
  editMode,
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto'
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <OtpInput
        shouldFocus={shouldFocus}
        value={fieldVal}
        applyStyles={applyStyles}
        element={element}
        onChange={onChange}
        inlineError={inlineError}
      />
    </div>
  );
}

export default PinInputField;
