import React from 'react';
import {
  createBaseElement,
  createFieldProps,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
} from '../../shared/tests/field-test-utils';
import { fireEvent } from '@testing-library/react';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
};

Object.defineProperty(global.navigator, 'credentials', {
  value: {
    get: jest.fn(() => Promise.resolve({ code: '123456' }))
  },
  writable: true
});

jest.mock('../useOTPListener', () => {
  return jest.fn((onOTP) => {
    // Store the callback for testing
    (global as any).otpCallback = onOTP;
  });
});

export const createPinElement = (
  type: string = 'pin',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => {
  const element = createBaseElement(
    'test-pin',
    type,
    metadata,
    {
      aria_label: 'Test pin field',
      ...properties
    },
    styles
  );

  element.servar = {
    key: 'test-pin',
    max_length: metadata.max_length || 6,
    ...element.servar
  };

  return element;
};

export const createPinProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: '',
    onChange: jest.fn(),
    onEnter: jest.fn(),
    autoFocus: false,
    disabled: false,
    autoComplete: 'one-time-code',
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((value: string) => {
    setMockFieldValue(value);
  });
};

export const createPinLengthMetadata = (length: number) => ({
  max_length: length
});

export const create4DigitPinElement = (metadata: any = {}) =>
  createPinElement('pin', { max_length: 4, ...metadata });

export const create6DigitPinElement = (metadata: any = {}) =>
  createPinElement('pin', { max_length: 6, ...metadata });

export const create8DigitPinElement = (metadata: any = {}) =>
  createPinElement('pin', { max_length: 8, ...metadata });

export const getPinInputs = () => {
  return Array.from(
    document.querySelectorAll('input[inputmode="numeric"]')
  ) as HTMLInputElement[];
};

export const getPinInput = (index: number) => {
  const inputs = getPinInputs();
  return inputs[index];
};

export const getPinInputCount = () => {
  return getPinInputs().length;
};

export const getPinContainer = () => {
  return document.querySelector('div') || document.body.firstElementChild;
};

export const getFocusedPinInput = () => {
  return document.activeElement as HTMLInputElement;
};

export const typeDigitInInput = (index: number, digit: string) => {
  const input = getPinInput(index);
  expect(input).toBeTruthy();

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: digit } });
};

export const typePinSequence = (pin: string) => {
  const digits = pin.split('');
  digits.forEach((digit, index) => {
    typeDigitInInput(index, digit);
  });
};

export const clearPinInput = (index: number) => {
  const input = getPinInput(index);
  expect(input).toBeTruthy();

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '' } });
};

export const focusPinInput = (index: number) => {
  const input = getPinInput(index);
  expect(input).toBeTruthy();

  fireEvent.focus(input);
};

export const blurPinInput = (index: number) => {
  const input = getPinInput(index);
  expect(input).toBeTruthy();

  fireEvent.blur(input);
};

export const pressKeyOnInput = (index: number, key: string) => {
  const input = getPinInput(index);
  expect(input).toBeTruthy();

  fireEvent.focus(input);
  fireEvent.keyDown(input, { key });
};

export const pressHotkey = (key: string) => {
  // Trigger the hotkey callback
  const callback = (global as any).hotkeyCallbacks?.[
    'enter, backspace, delete, left, right, space'
  ];
  if (callback) {
    const mockEvent = { preventDefault: jest.fn() };
    const mockHandler = { key };
    callback(mockEvent, mockHandler);
  }
};

// Helper to simulate paste in specific input
export const pastePinCode = (index: number, code: string) => {
  const input = getPinInput(index);
  expect(input).toBeTruthy();

  fireEvent.focus(input);
  fireEvent.paste(input, {
    clipboardData: {
      getData: jest.fn(() => code)
    }
  });
};

// Helper to simulate SMS OTP reception
export const simulateSMSOTP = (code: string) => {
  if ((global as any).otpCallback) {
    (global as any).otpCallback(code);
  }
};

export const pressBackspaceOnInput = (index: number) => {
  pressKeyOnInput(index, 'Backspace');
};

export const pressDeleteOnInput = (index: number) => {
  pressKeyOnInput(index, 'Delete');
};

export const pressLeftArrowOnInput = (index: number) => {
  pressKeyOnInput(index, 'ArrowLeft');
};

export const pressRightArrowOnInput = (index: number) => {
  pressKeyOnInput(index, 'ArrowRight');
};

export const pressEnterOnInput = (index: number) => {
  pressKeyOnInput(index, 'Enter');
};

export const expectPinInputToHaveValue = (
  index: number,
  expectedValue: string
) => {
  const input = getPinInput(index);
  expect(input?.value).toBe(expectedValue);
};

export const expectPinInputsToHaveValues = (expectedValues: string[]) => {
  const inputs = getPinInputs();
  expect(inputs).toHaveLength(expectedValues.length);

  expectedValues.forEach((value, index) => {
    expectPinInputToHaveValue(index, value);
  });
};

export const expectCompletePinValue = (expectedPin: string) => {
  const inputs = getPinInputs();
  const actualPin = inputs.map((input) => input.value).join('');
  expect(actualPin).toBe(expectedPin);
};

export const expectPinInputToBeFocused = (index: number) => {
  const input = getPinInput(index);
  expect(document.activeElement).toBe(input);
};

export const expectPinInputToBeDisabled = (index: number) => {
  const input = getPinInput(index);
  expect(input?.disabled).toBe(true);
};

export const expectPinInputToBeEnabled = (index: number) => {
  const input = getPinInput(index);
  expect(input?.disabled).toBe(false);
};

export const expectAllPinInputsToBeDisabled = () => {
  const inputs = getPinInputs();
  inputs.forEach((input, index) => {
    expectPinInputToBeDisabled(index);
  });
};

export const expectAllPinInputsToBeEnabled = () => {
  const inputs = getPinInputs();
  inputs.forEach((input, index) => {
    expectPinInputToBeEnabled(index);
  });
};

export const expectPinInputCount = (expectedCount: number) => {
  const inputs = getPinInputs();
  expect(inputs).toHaveLength(expectedCount);
};

export const expectPinInputToHaveAttributes = (
  index: number,
  expectedAttributes: any
) => {
  const input = getPinInput(index);

  Object.keys(expectedAttributes).forEach((attr) => {
    expect(input?.getAttribute(attr)).toBe(expectedAttributes[attr]);
  });
};

export const expectPinInputToHaveAutocomplete = (
  index: number,
  expectedValue: string
) => {
  const input = getPinInput(index);
  expect(input?.getAttribute('autocomplete')).toBe(expectedValue);
};

export const expectPinInputToAcceptOnlySingleDigit = (index: number) => {
  const input = getPinInput(index);
  expect(input?.getAttribute('maxlength')).toBe('1');
};

export const expectFieldToHaveValue = (expectedValue: string) => {
  const currentValue = getMockFieldValue();
  expect(currentValue).toBe(expectedValue);
};

export const expectPinToBeComplete = (expectedPin: string) => {
  expectCompletePinValue(expectedPin);
  expectFieldToHaveValue(expectedPin);
};

export const expectPinToBeIncomplete = () => {
  const inputs = getPinInputs();
  const pin = inputs.map((input) => input.value).join('');
  expect(pin.length).toBeLessThan(inputs.length);
};

export const expectPinToBeEmpty = () => {
  expectCompletePinValue('');
  expectFieldToHaveValue('');
};

export const expectAutoFocusOnFirstInput = () => {
  expectPinInputToBeFocused(0);
};

export const expectNavigationToWork = () => {
  const inputCount = getPinInputCount();

  // Focus first input
  focusPinInput(0);
  expectPinInputToBeFocused(0);

  // Navigate forward
  for (let i = 1; i < inputCount; i++) {
    pressRightArrowOnInput(i - 1);
    expectPinInputToBeFocused(i);
  }

  // Navigate backward
  for (let i = inputCount - 2; i >= 0; i--) {
    pressLeftArrowOnInput(i + 1);
    expectPinInputToBeFocused(i);
  }
};

export const expectBackspaceToWork = () => {
  typePinSequence('123');
  expectPinInputsToHaveValues(['1', '2', '3', '', '', '']);

  pressBackspaceOnInput(2);
  expectPinInputsToHaveValues(['1', '2', '', '', '', '']);
  expectPinInputToBeFocused(1);
};

export const expectPasteToWork = (pin: string) => {
  focusPinInput(0);
  pastePinCode(0, pin);

  const expectedValues = pin
    .split('')
    .concat(Array(Math.max(0, 6 - pin.length)).fill(''));
  expectPinInputsToHaveValues(expectedValues.slice(0, 6));
};

export const expectSMSOTPToWork = (code: string) => {
  simulateSMSOTP(code);

  const expectedValues = code
    .split('')
    .concat(Array(Math.max(0, 6 - code.length)).fill(''));
  expectPinInputsToHaveValues(expectedValues.slice(0, 6));
};

export const completePinEntry = (pin: string) => {
  typePinSequence(pin);
  expectPinToBeComplete(pin);
};

export const expectOnlyNumericInput = (index: number) => {
  const input = getPinInput(index);

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'a' } });
  expect(input.value).toBe(''); // Should not accept letter

  fireEvent.change(input, { target: { value: '5' } });
  expect(input.value).toBe('5'); // Should accept number
};

export const expectInputLengthRestriction = (index: number) => {
  const input = getPinInput(index);

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '123' } });
  expect(input.value.length).toBeLessThanOrEqual(1); // Should only accept 1 character
};
