import {
  createCheckboxGroupElement,
  createCheckboxGroupProps,
  createStatefulOnChange,
  createStatefulOtherOnChange,
  createOptionsMetadata,
  createMaxLengthElement,
  createOtherOptionElement,
  getMockFieldValue,
  resetMockFieldValue,
  setMockFieldValue,
  getCheckboxInputs,
  getCheckboxInputByValue,
  getOtherCheckbox,
  getOtherTextInput,
  getOptionLabels,
  expectCheckboxToBeChecked,
  expectCheckboxToBeUnchecked,
  expectOtherCheckboxToBeChecked,
  expectOtherCheckboxToBeUnchecked,
  expectCheckboxGroupToHaveValues,
  expectCheckboxGroupToHaveOptionCount,
  expectCheckboxToBeDisabled,
  expectCheckboxToBeEnabled,
  expectOtherCheckboxToBeDisabled,
  expectOtherTextInputToBeDisabled,
  expectOtherTextInputToBeEnabled,
  expectOtherTextInputToHaveValue,
  expectOptionToHaveTooltip,
  expectOtherToHaveTooltip,
  expectFieldToBeDisabled,
  expectFieldToHaveAriaLabel
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CheckboxGroupField from '../index';

describe('CheckboxGroupField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders CheckboxGroupField component with default props', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      expect(screen.getByText('Test Label')).toBeTruthy();
      expectCheckboxGroupToHaveOptionCount(3);
    });

    it('renders with correct checkbox structure', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      const checkboxes = getCheckboxInputs();
      expect(checkboxes).toHaveLength(3);

      checkboxes.forEach((checkbox, index) => {
        expect(checkbox.type).toBe('checkbox');
        expect(checkbox.id).toBe(`test-checkbox-group-key-${index}`);
      });
    });

    it('renders option labels correctly', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      const labels = getOptionLabels();
      expect(labels).toEqual(['Option 1', 'Option 2', 'Option 3']);
    });

    it('renders with disabled state', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, { disabled: true });

      render(<CheckboxGroupField {...props} />);

      const checkboxes = getCheckboxInputs();
      checkboxes.forEach((checkbox) => {
        expectFieldToBeDisabled(checkbox);
      });
    });
  });

  describe('onChange Functionality', () => {
    it('handles basic checkbox selection', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, {
        onChange: mockOnChange
      });

      render(<CheckboxGroupField {...props} />);

      act(() => {
        const checkbox = getCheckboxInputByValue('Option 2');
        fireEvent.click(checkbox);
      });

      expectCheckboxGroupToHaveValues(['Option 2']);
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('handles multiple checkbox selections', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, {
        onChange: mockOnChange
      });

      render(<CheckboxGroupField {...props} />);

      act(() => {
        const checkbox1 = getCheckboxInputByValue('Option 1');
        const checkbox3 = getCheckboxInputByValue('Option 3');
        fireEvent.click(checkbox1);
        fireEvent.click(checkbox3);
      });

      expectCheckboxGroupToHaveValues(['Option 1', 'Option 3']);
      expect(mockOnChange).toHaveBeenCalledTimes(2);
    });

    it('handles unchecking checkboxes', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createCheckboxGroupElement('checkbox_group');

      // Set initial values
      setMockFieldValue(['Option 1', 'Option 2']);

      const props = createCheckboxGroupProps(element, {
        onChange: mockOnChange,
        fieldVal: ['Option 1', 'Option 2']
      });

      render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeChecked('Option 1');
      expectCheckboxToBeChecked('Option 2');

      act(() => {
        const checkbox = getCheckboxInputByValue('Option 1');
        fireEvent.click(checkbox);
      });

      expectCheckboxGroupToHaveValues(['Option 2']);
    });

    it('displays selected values correctly', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, {
        fieldVal: ['Option 1', 'Option 3']
      });

      render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeChecked('Option 1');
      expectCheckboxToBeUnchecked('Option 2');
      expectCheckboxToBeChecked('Option 3');
    });
  });

  describe('Disabled State', () => {
    it('disables all checkboxes when field is disabled', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, { disabled: true });

      render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeDisabled('Option 1');
      expectCheckboxToBeDisabled('Option 2');
      expectCheckboxToBeDisabled('Option 3');
    });

    it('prevents interaction when disabled', () => {
      const mockOnChange = jest.fn();
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, {
        onChange: mockOnChange,
        disabled: true
      });

      render(<CheckboxGroupField {...props} />);

      const checkboxes = getCheckboxInputs();
      checkboxes.forEach((checkbox) => {
        expect(checkbox.disabled).toBe(true);
      });
    });
  });

  describe('Max Selectable', () => {
    it('enforces max length constraint', () => {
      const element = createMaxLengthElement(2);
      const props = createCheckboxGroupProps(element, {
        fieldVal: ['Option 1', 'Option 2']
      });

      render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeEnabled('Option 1'); // Already selected
      expectCheckboxToBeEnabled('Option 2'); // Already selected
      expectCheckboxToBeDisabled('Option 3'); // Max reached, not selected
    });

    it('allows deselecting when at max limit', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createMaxLengthElement(2);

      setMockFieldValue(['Option 1', 'Option 2']);

      const props = createCheckboxGroupProps(element, {
        onChange: mockOnChange,
        fieldVal: ['Option 1', 'Option 2']
      });

      render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeEnabled('Option 1');
      expectCheckboxToBeEnabled('Option 2');
      expectCheckboxToBeDisabled('Option 3');

      // Should be able to uncheck selected items
      act(() => {
        const checkbox = getCheckboxInputByValue('Option 1');
        fireEvent.click(checkbox);
      });

      expectCheckboxGroupToHaveValues(['Option 2']);
    });

    it('handles max_length of 0 (no selections allowed)', () => {
      const element = createMaxLengthElement(0);
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      // With max_length = 0, checkboxes should still be enabled since 0 is falsy
      // The logic is: (servar.max_length && servar.max_length <= fieldVal.length && !checked)
      // Since 0 is falsy, the condition fails and checkboxes remain enabled
      expectCheckboxToBeEnabled('Option 1');
      expectCheckboxToBeEnabled('Option 2');
      expectCheckboxToBeEnabled('Option 3');
    });
  });

  describe('Options - Labels and Tooltips', () => {
    it('renders options with custom labels', () => {
      const options = ['val1', 'val2', 'val3'];
      const labels = ['Label 1', 'Label 2', 'Label 3'];
      const element = createCheckboxGroupElement('checkbox_group', {
        ...createOptionsMetadata(options, labels)
      });
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      const actualLabels = getOptionLabels();
      expect(actualLabels).toEqual(['Label 1', 'Label 2', 'Label 3']);

      // Verify checkbox values are still the original option values
      const checkbox1 = getCheckboxInputByValue('val1');
      const checkbox2 = getCheckboxInputByValue('val2');
      const checkbox3 = getCheckboxInputByValue('val3');

      expect(checkbox1).toBeTruthy();
      expect(checkbox2).toBeTruthy();
      expect(checkbox3).toBeTruthy();
    });

    it('falls back to option values when no labels provided', () => {
      const options = ['option_a', 'option_b', 'option_c'];
      const element = createCheckboxGroupElement('checkbox_group', {
        options
      });
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      const labels = getOptionLabels();
      expect(labels).toEqual(['option_a', 'option_b', 'option_c']);
    });

    it('renders options with tooltips', () => {
      const options = ['small', 'medium', 'large'];
      const labels = ['Small', 'Medium', 'Large'];
      const tooltips = ['Size S', 'Size M', 'Size L'];
      const element = createCheckboxGroupElement('checkbox_group', {
        ...createOptionsMetadata(options, labels, tooltips)
      });
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      expectOptionToHaveTooltip('small', 'Size S');
      expectOptionToHaveTooltip('medium', 'Size M');
      expectOptionToHaveTooltip('large', 'Size L');
    });

    it('handles partial tooltip arrays', () => {
      const options = ['option1', 'option2', 'option3'];
      const tooltips = ['Tooltip 1']; // Only one tooltip provided
      const element = createCheckboxGroupElement('checkbox_group', {
        ...createOptionsMetadata(options, undefined, tooltips)
      });
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      expectOptionToHaveTooltip('option1', 'Tooltip 1');
      expectOptionToHaveTooltip('option2', ''); // Should be empty
      expectOptionToHaveTooltip('option3', ''); // Should be empty
    });

    it('handles empty tooltip strings', () => {
      const options = ['option1', 'option2'];
      const tooltips = ['', 'Tooltip 2'];
      const element = createCheckboxGroupElement('checkbox_group', {
        ...createOptionsMetadata(options, undefined, tooltips)
      });
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      expectOptionToHaveTooltip('option1', '');
      expectOptionToHaveTooltip('option2', 'Tooltip 2');
    });
  });

  describe('Other Option', () => {
    it('renders other option when enabled', () => {
      const element = createOtherOptionElement();
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      const otherCheckbox = getOtherCheckbox();
      const otherTextInput = getOtherTextInput();

      expect(otherCheckbox).toBeTruthy();
      expect(otherTextInput).toBeTruthy();
      expect(screen.getByText('Other')).toBeTruthy();
    });

    it('does not render other option when disabled', () => {
      const element = createCheckboxGroupElement('checkbox_group', {
        other: false
      });
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      const otherCheckbox = getOtherCheckbox();
      const otherTextInput = getOtherTextInput();

      expect(otherCheckbox).toBeFalsy();
      expect(otherTextInput).toBeFalsy();
    });

    it('renders other option with custom label', () => {
      const element = createOtherOptionElement(
        ['Option 1'],
        'Custom Other',
        ''
      );
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      expect(screen.getByText('Custom Other')).toBeTruthy();
    });

    it('handles other option selection', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createOtherOptionElement();
      const props = createCheckboxGroupProps(element, {
        onChange: mockOnChange,
        otherVal: 'custom value'
      });

      render(<CheckboxGroupField {...props} />);

      act(() => {
        const otherCheckbox = getOtherCheckbox();
        fireEvent.click(otherCheckbox);
      });

      expect(getMockFieldValue()).toContain('custom value');
      expect(mockOnChange).toHaveBeenCalled();
    });

    it('disables other text input when other checkbox is unchecked', () => {
      const element = createOtherOptionElement();
      const props = createCheckboxGroupProps(element, {
        fieldVal: [], // Other not selected
        otherVal: ''
      });

      render(<CheckboxGroupField {...props} />);

      expectOtherCheckboxToBeUnchecked();
      expectOtherTextInputToBeDisabled();
    });

    it('enables other text input when other checkbox is checked', () => {
      const element = createOtherOptionElement();
      const props = createCheckboxGroupProps(element, {
        fieldVal: ['custom value'], // Other selected
        otherVal: 'custom value'
      });

      render(<CheckboxGroupField {...props} />);

      expectOtherCheckboxToBeChecked();
      expectOtherTextInputToBeEnabled();
    });

    it('displays other text input value correctly', () => {
      const element = createOtherOptionElement();
      const props = createCheckboxGroupProps(element, {
        otherVal: 'My custom option'
      });

      render(<CheckboxGroupField {...props} />);

      expectOtherTextInputToHaveValue('My custom option');
    });

    it('handles other text input changes', () => {
      const mockOnOtherChange = createStatefulOtherOnChange();
      const element = createOtherOptionElement();
      const props = createCheckboxGroupProps(element, {
        onOtherChange: mockOnOtherChange,
        fieldVal: ['custom value'],
        otherVal: 'custom value'
      });

      render(<CheckboxGroupField {...props} />);

      const otherTextInput = getOtherTextInput();

      act(() => {
        fireEvent.change(otherTextInput!, {
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
      const props = createCheckboxGroupProps(element);

      render(<CheckboxGroupField {...props} />);

      expectOtherToHaveTooltip('Enter custom option');
    });

    it('handles other option with max length constraint', () => {
      const element = createCheckboxGroupElement('checkbox_group', {
        options: ['Option 1', 'Option 2'],
        other: true,
        max_length: 2
      });
      const props = createCheckboxGroupProps(element, {
        fieldVal: ['Option 1', 'Option 2'], // At max limit
        otherVal: 'custom'
      });

      render(<CheckboxGroupField {...props} />);

      // Other checkbox should be disabled because max length is reached
      expectOtherCheckboxToBeDisabled();
      expectOtherTextInputToBeDisabled();
    });
  });

  describe('Field Value Display', () => {
    it('displays provided field values correctly', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, {
        fieldVal: ['Option 1', 'Option 3']
      });

      render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeChecked('Option 1');
      expectCheckboxToBeUnchecked('Option 2');
      expectCheckboxToBeChecked('Option 3');
    });

    it('updates display when field value changes', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, {
        fieldVal: ['Option 1']
      });

      const { rerender } = render(<CheckboxGroupField {...props} />);

      expectCheckboxToBeChecked('Option 1');
      expectCheckboxToBeUnchecked('Option 2');

      // Update field value
      const updatedProps = createCheckboxGroupProps(element, {
        fieldVal: ['Option 2', 'Option 3']
      });
      rerender(<CheckboxGroupField {...updatedProps} />);

      expectCheckboxToBeUnchecked('Option 1');
      expectCheckboxToBeChecked('Option 2');
      expectCheckboxToBeChecked('Option 3');
    });

    it('handles empty field values', () => {
      const element = createCheckboxGroupElement('checkbox_group');
      const props = createCheckboxGroupProps(element, { fieldVal: [] });

      render(<CheckboxGroupField {...props} />);

      const checkboxes = getCheckboxInputs();
      checkboxes.forEach((checkbox) => {
        expect(checkbox.checked).toBe(false);
      });
    });
  });
});
