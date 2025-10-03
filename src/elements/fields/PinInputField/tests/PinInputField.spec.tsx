// Import test-utils FIRST to ensure mocks are set up before the component loads
import {
  createPinElement,
  createPinProps,
  createStatefulOnChange,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel,
  createPinLengthMetadata,
  create4DigitPinElement,
  create6DigitPinElement,
  create8DigitPinElement,
  getPinInputs,
  getPinInput,
  getPinInputCount,
  getPinContainer,
  getFocusedPinInput,
  typeDigitInInput,
  typePinSequence,
  clearPinInput,
  focusPinInput,
  blurPinInput,
  pressKeyOnInput,
  pressHotkey,
  pastePinCode,
  simulateSMSOTP,
  pressBackspaceOnInput,
  pressDeleteOnInput,
  pressLeftArrowOnInput,
  pressRightArrowOnInput,
  pressEnterOnInput,
  expectPinInputToHaveValue,
  expectPinInputsToHaveValues,
  expectCompletePinValue,
  expectPinInputToBeFocused,
  expectPinInputToBeDisabled,
  expectPinInputToBeEnabled,
  expectAllPinInputsToBeDisabled,
  expectAllPinInputsToBeEnabled,
  expectPinInputCount,
  expectPinInputToHaveAttributes,
  expectPinInputToHaveAutocomplete,
  expectPinInputToAcceptOnlySingleDigit,
  expectFieldToHaveValue,
  expectPinToBeComplete,
  expectPinToBeIncomplete,
  expectPinToBeEmpty,
  expectAutoFocusOnFirstInput,
  expectNavigationToWork,
  expectBackspaceToWork,
  expectPasteToWork,
  expectSMSOTPToWork,
  completePinEntry,
  expectOnlyNumericInput,
  expectInputLengthRestriction
} from './test-utils';
import React from 'react';
import { render } from '@testing-library/react';
import PinInputField from '../index';

describe('PinInputField Component', () => {
  beforeEach(() => {
    resetMockFieldValue();
    jest.clearAllMocks();
    (global as any).hotkeyCallbacks = {};
    (global as any).otpCallback = null;
  });

  describe('Basic Rendering', () => {
    it('renders pin field with default props', () => {
      const element = createPinElement();
      const props = createPinProps(element);

      const { container } = render(<PinInputField {...props} />);

      expect(container.firstChild).toBeInTheDocument();
      const inputs = getPinInputs();
      expect(inputs.length).toBeGreaterThan(0);
    });

    it('renders individual input fields', () => {
      const element = createPinElement();
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      const inputs = getPinInputs();
      inputs.forEach((input) => {
        expect(input).toHaveAttribute('inputmode', 'numeric');
        expect(input).toHaveAttribute('name', element.servar.key);
      });
    });

    it('renders container with proper structure', () => {
      const element = createPinElement();
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      const container = getPinContainer();
      expect(container).toBeInTheDocument();
      // Container should have inputs rendered
      expect(getPinInputs().length).toBeGreaterThan(0);
    });
  });

  describe('Length Configuration', () => {
    it('renders 4 inputs for 4-digit PIN', () => {
      const element = create4DigitPinElement();
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPinInputCount(4);
    });

    it('renders 8 inputs for 8-digit PIN', () => {
      const element = create8DigitPinElement();
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPinInputCount(8);
    });

    it('handles custom length from metadata', () => {
      const element = createPinElement('pin', createPinLengthMetadata(5));
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPinInputCount(5);
    });

    it('uses max_length from element.servar', () => {
      const element = createPinElement();
      element.servar.max_length = 3;
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPinInputCount(3);
    });

    it('handles edge case of 1-digit PIN', () => {
      const element = createPinElement('pin', createPinLengthMetadata(1));
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPinInputCount(1);
    });

    it('handles edge case of large PIN length', () => {
      const element = createPinElement('pin', createPinLengthMetadata(12));
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPinInputCount(12);
    });
  });

  describe('onChange Behavior', () => {
    it('calls onChange when PIN digit is entered', () => {
      const element = createPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      typeDigitInInput(0, '1');

      expect(onChange).toHaveBeenCalledWith('1');
      expectFieldToHaveValue('1');
    });

    it('calls onChange when multiple digits are entered', () => {
      const element = createPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      typePinSequence('123');

      expect(onChange).toHaveBeenCalledWith('123');
      expectFieldToHaveValue('123');
    });

    it('calls onChange when complete PIN is entered', () => {
      const element = create4DigitPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      completePinEntry('1234');

      expect(onChange).toHaveBeenCalledWith('1234');
      expectFieldToHaveValue('1234');
    });

    it('calls onChange when PIN is modified', () => {
      const element = createPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      // Enter initial PIN
      typePinSequence('123');
      expect(onChange).toHaveBeenCalledWith('123');

      // Modify PIN
      typeDigitInInput(3, '4');
      expect(onChange).toHaveBeenCalledWith('1234');

      expectFieldToHaveValue('1234');
    });

    it('updates field value as PIN is entered progressively', () => {
      const element = create6DigitPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      typeDigitInInput(0, '1');
      expectFieldToHaveValue('1');

      typeDigitInInput(1, '2');
      expectFieldToHaveValue('12');

      typeDigitInInput(2, '3');
      expectFieldToHaveValue('123');

      typeDigitInInput(3, '4');
      expectFieldToHaveValue('1234');

      typeDigitInInput(4, '5');
      expectFieldToHaveValue('12345');

      typeDigitInInput(5, '6');
      expectFieldToHaveValue('123456');
    });

    it('handles onChange with existing fieldVal prop', () => {
      const element = createPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, {
        fieldVal: '12',
        onChange
      });

      render(<PinInputField {...props} />);

      // Should display existing value
      expectPinInputsToHaveValues(['1', '2', '', '', '', '']);

      // Continue entering digits
      typeDigitInInput(2, '3');
      expect(onChange).toHaveBeenCalledWith('123');
    });
  });

  describe('Auto Focus Behavior', () => {
    it('focuses first input when autoFocus is true', () => {
      const element = createPinElement();
      const props = createPinProps(element, { autoFocus: true });

      render(<PinInputField {...props} />);

      expectAutoFocusOnFirstInput();
    });

    it('does not focus first input when autoFocus is false', () => {
      const element = createPinElement();
      const props = createPinProps(element, { autoFocus: false });

      render(<PinInputField {...props} />);

      const firstInput = getPinInput(0);
      expect(document.activeElement).not.toBe(firstInput);
    });

    it('automatically focuses next input after digit entry', () => {
      const element = createPinElement();
      const props = createPinProps(element, { autoFocus: true });

      render(<PinInputField {...props} />);

      expectPinInputToBeFocused(0);

      typeDigitInInput(0, '1');
      expectPinInputToBeFocused(1);

      typeDigitInInput(1, '2');
      expectPinInputToBeFocused(2);
    });
  });

  describe('Paste Functionality', () => {
    it('supports pasting complete PIN code', () => {
      const element = create6DigitPinElement();
      const props = createPinProps(element);

      render(<PinInputField {...props} />);

      expectPasteToWork('123456');
    });

    it('supports pasting partial PIN code', () => {
      const element = create6DigitPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      pastePinCode(0, '123');

      expectPinInputsToHaveValues(['1', '2', '3', '', '', '']);
      expect(onChange).toHaveBeenCalledWith('123');
    });

    it('handles paste starting from middle input', () => {
      const element = create6DigitPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      // Type first digit manually
      typeDigitInInput(0, '1');

      // Paste remaining digits from second input
      pastePinCode(1, '23456');

      expectPinInputsToHaveValues(['1', '2', '3', '4', '5', '6']);
      expect(onChange).toHaveBeenCalledWith('123456');
    });

    it('handles paste longer than remaining inputs', () => {
      const element = create4DigitPinElement();
      const onChange = createStatefulOnChange();
      const props = createPinProps(element, { onChange });

      render(<PinInputField {...props} />);

      // Paste 6 digits into 4-digit field
      pastePinCode(0, '123456');

      // Should only take first 4 digits
      expectPinInputsToHaveValues(['1', '2', '3', '4']);
      expect(onChange).toHaveBeenCalledWith('1234');
    });
  });
});
