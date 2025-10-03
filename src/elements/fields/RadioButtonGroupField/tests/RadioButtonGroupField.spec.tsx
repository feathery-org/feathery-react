import {
  createRadioGroupElement,
  createRadioGroupProps,
  createStatefulOnChange,
  createStatefulOtherOnChange,
  createOptionsMetadata,
  createOtherOptionElement,
  getMockFieldValue,
  resetMockFieldValue,
  setMockFieldValue,
  getRadioInputs,
  getRadioInput,
  getRadioInputByValue,
  getOtherRadio,
  getOtherTextInput,
  getOptionLabels,
  getOptionLabel,
  getOptionTooltip,
  getOtherTooltip,
  expectRadioToBeChecked,
  expectRadioToBeUnchecked,
  expectOtherRadioToBeChecked,
  expectOtherRadioToBeUnchecked,
  expectRadioGroupToHaveValue,
  expectRadioGroupToHaveOptionCount,
  expectRadioToBeDisabled,
  expectRadioToBeEnabled,
  expectOtherRadioToBeDisabled,
  expectOtherRadioToBeEnabled,
  expectOtherTextInputToBeDisabled,
  expectOtherTextInputToBeEnabled,
  expectOtherTextInputToHaveValue,
  expectOptionToHaveTooltip,
  expectOtherToHaveTooltip,
  expectRadiosToHaveCorrectNames,
  expectOtherRadioToHaveValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import RadioButtonGroupField from '../index';

describe('RadioButtonGroupField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders RadioButtonGroupField component with default props', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      expect(screen.getByText('Test Label')).toBeTruthy();
      expectRadioGroupToHaveOptionCount(3);
    });

    it('renders with correct radio structure', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      const radios = getRadioInputs();
      expect(radios).toHaveLength(3);

      radios.forEach((radio, index) => {
        expect(radio.type).toBe('radio');
        expect(radio.id).toBe(`test-radio-group-key-${index}`);
        expect(radio.name).toBe('test-radio-group-key');
      });
    });

    it('renders option labels correctly', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      const labels = getOptionLabels();
      expect(labels).toEqual(['Option 1', 'Option 2', 'Option 3']);
    });

    it('renders with disabled state', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, { disabled: true });

      render(<RadioButtonGroupField {...props} />);

      const radios = getRadioInputs();
      radios.forEach((radio) => {
        expectFieldToBeDisabled(radio);
      });
    });
  });

  describe('onChange Functionality', () => {
    it('handles basic radio selection', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, { onChange: mockOnChange });

      render(<RadioButtonGroupField {...props} />);

      act(() => {
        const radio = getRadioInputByValue('Option 2');
        fireEvent.click(radio);
      });

      expectRadioGroupToHaveValue('Option 2');
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('handles radio selection change (radio behavior)', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, { onChange: mockOnChange });

      render(<RadioButtonGroupField {...props} />);

      // Select first option
      act(() => {
        const radio1 = getRadioInputByValue('Option 1');
        fireEvent.click(radio1);
      });

      expectRadioGroupToHaveValue('Option 1');

      // Select second option (should replace first)
      act(() => {
        const radio2 = getRadioInputByValue('Option 3');
        fireEvent.click(radio2);
      });

      expectRadioGroupToHaveValue('Option 3');
      expect(mockOnChange).toHaveBeenCalledTimes(2);
    });

    it('displays selected value correctly', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, {
        fieldVal: 'Option 2'
      });

      render(<RadioButtonGroupField {...props} />);

      expectRadioToBeChecked('Option 2');
      expectRadioToBeUnchecked('Option 1');
      expectRadioToBeUnchecked('Option 3');
    });

    it('allows only one radio to be selected at a time', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, {
        fieldVal: 'Option 2'
      });

      render(<RadioButtonGroupField {...props} />);

      const radios = getRadioInputs();
      const checkedRadios = radios.filter((radio) => radio.checked);
      expect(checkedRadios).toHaveLength(1);
    });
  });

  describe('Disabled State', () => {
    it('disables all radios when field is disabled', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, { disabled: true });

      render(<RadioButtonGroupField {...props} />);

      expectRadioToBeDisabled('Option 1');
      expectRadioToBeDisabled('Option 2');
      expectRadioToBeDisabled('Option 3');
    });

    it('prevents interaction when disabled', () => {
      const mockOnChange = jest.fn();
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, {
        onChange: mockOnChange,
        disabled: true
      });

      render(<RadioButtonGroupField {...props} />);

      const radios = getRadioInputs();
      radios.forEach((radio) => {
        expect(radio.disabled).toBe(true);
      });
    });
  });

  describe('Options - Labels and Tooltips', () => {
    it('renders options with custom labels', () => {
      const options = ['val1', 'val2', 'val3'];
      const labels = ['Label 1', 'Label 2', 'Label 3'];
      const element = createRadioGroupElement('select', {
        ...createOptionsMetadata(options, labels)
      });
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      const actualLabels = getOptionLabels();
      expect(actualLabels).toEqual(['Label 1', 'Label 2', 'Label 3']);

      // Verify radio values are still the original option values
      const radio1 = getRadioInputByValue('val1');
      const radio2 = getRadioInputByValue('val2');
      const radio3 = getRadioInputByValue('val3');

      expect(radio1).toBeTruthy();
      expect(radio2).toBeTruthy();
      expect(radio3).toBeTruthy();
    });

    it('falls back to option values when no labels provided', () => {
      const options = ['option_a', 'option_b', 'option_c'];
      const element = createRadioGroupElement('select', {
        options
      });
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      const labels = getOptionLabels();
      expect(labels).toEqual(['option_a', 'option_b', 'option_c']);
    });

    it('renders options with tooltips', () => {
      const options = ['small', 'medium', 'large'];
      const labels = ['Small', 'Medium', 'Large'];
      const tooltips = ['Size S', 'Size M', 'Size L'];
      const element = createRadioGroupElement('select', {
        ...createOptionsMetadata(options, labels, tooltips)
      });
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      expectOptionToHaveTooltip('small', 'Size S');
      expectOptionToHaveTooltip('medium', 'Size M');
      expectOptionToHaveTooltip('large', 'Size L');
    });

    it('handles partial tooltip arrays', () => {
      const options = ['option1', 'option2', 'option3'];
      const tooltips = ['Tooltip 1']; // Only one tooltip provided
      const element = createRadioGroupElement('select', {
        ...createOptionsMetadata(options, undefined, tooltips)
      });
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      expectOptionToHaveTooltip('option1', 'Tooltip 1');
      expectOptionToHaveTooltip('option2', ''); // Should be empty
      expectOptionToHaveTooltip('option3', ''); // Should be empty
    });

    it('handles empty tooltip strings', () => {
      const options = ['option1', 'option2'];
      const tooltips = ['', 'Tooltip 2'];
      const element = createRadioGroupElement('select', {
        ...createOptionsMetadata(options, undefined, tooltips)
      });
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      expectOptionToHaveTooltip('option1', '');
      expectOptionToHaveTooltip('option2', 'Tooltip 2');
    });
  });

  describe('Other Option', () => {
    it('renders other option when enabled', () => {
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      const otherRadio = getOtherRadio();
      const otherTextInput = getOtherTextInput();

      expect(otherRadio).toBeTruthy();
      expect(otherTextInput).toBeTruthy();
      expect(screen.getByText('Other')).toBeTruthy();
    });

    it('does not render other option when disabled', () => {
      const element = createRadioGroupElement('select', {
        other: false
      });
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      const otherRadio = getOtherRadio();
      const otherTextInput = getOtherTextInput();

      expect(otherRadio).toBeFalsy();
      expect(otherTextInput).toBeFalsy();
    });

    it('renders other option with custom label', () => {
      const element = createOtherOptionElement(
        ['Option 1'],
        'Custom Other',
        ''
      );
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      expect(screen.getByText('Custom Other')).toBeTruthy();
    });

    it('handles other option selection', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        onChange: mockOnChange,
        otherVal: 'custom value'
      });

      render(<RadioButtonGroupField {...props} />);

      act(() => {
        const otherRadio = getOtherRadio();
        fireEvent.click(otherRadio);
      });

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('disables other text input when other radio is unchecked', () => {
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        fieldVal: 'Option 1', // Regular option selected
        otherVal: ''
      });

      render(<RadioButtonGroupField {...props} />);

      expectOtherRadioToBeUnchecked();
      expectOtherTextInputToBeDisabled();
    });

    it('enables other text input when other radio is checked', () => {
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        fieldVal: 'custom value', // Other option selected
        otherVal: 'custom value'
      });

      render(<RadioButtonGroupField {...props} />);

      expectOtherRadioToBeChecked();
      expectOtherTextInputToBeEnabled();
    });

    it('displays other text input value correctly', () => {
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        otherVal: 'My custom option'
      });

      render(<RadioButtonGroupField {...props} />);

      expectOtherTextInputToHaveValue('My custom option');
    });

    it('handles other text input changes', () => {
      const mockOnOtherChange = createStatefulOtherOnChange();
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        onOtherChange: mockOnOtherChange,
        fieldVal: 'custom value',
        otherVal: 'custom value'
      });

      render(<RadioButtonGroupField {...props} />);

      const otherTextInput = getOtherTextInput();

      act(() => {
        fireEvent.change(otherTextInput, {
          target: { value: 'Updated custom value' }
        });
      });

      expect(mockOnOtherChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('renders other option with tooltip', () => {
      const element = createOtherOptionElement(
        ['Option 1'],
        'Other',
        'Enter custom option'
      );
      const props = createRadioGroupProps(element);

      render(<RadioButtonGroupField {...props} />);

      expectOtherToHaveTooltip('Enter custom option');
    });

    it('has correct value property for other radio button', () => {
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        otherVal: 'my custom value'
      });

      render(<RadioButtonGroupField {...props} />);

      expectOtherRadioToHaveValue('my custom value');
    });

    it('handles empty otherVal correctly', () => {
      const element = createOtherOptionElement();
      const props = createRadioGroupProps(element, {
        otherVal: ''
      });

      render(<RadioButtonGroupField {...props} />);

      expectOtherRadioToHaveValue('');
      expectOtherTextInputToHaveValue('');
    });
  });

  describe('Field Value Display', () => {
    it('displays provided field values correctly', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, {
        fieldVal: 'Option 2'
      });

      render(<RadioButtonGroupField {...props} />);

      expectRadioToBeUnchecked('Option 1');
      expectRadioToBeChecked('Option 2');
      expectRadioToBeUnchecked('Option 3');
    });

    it('updates display when field value changes', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, {
        fieldVal: 'Option 1'
      });

      const { rerender } = render(<RadioButtonGroupField {...props} />);

      expectRadioToBeChecked('Option 1');
      expectRadioToBeUnchecked('Option 2');

      // Update field value
      const updatedProps = createRadioGroupProps(element, {
        fieldVal: 'Option 3'
      });
      rerender(<RadioButtonGroupField {...updatedProps} />);

      expectRadioToBeUnchecked('Option 1');
      expectRadioToBeUnchecked('Option 2');
      expectRadioToBeChecked('Option 3');
    });

    it('handles empty field values', () => {
      const element = createRadioGroupElement('select');
      const props = createRadioGroupProps(element, { fieldVal: '' });

      render(<RadioButtonGroupField {...props} />);

      const radios = getRadioInputs();
      radios.forEach((radio) => {
        expect(radio.checked).toBe(false);
      });
    });
  });
});
