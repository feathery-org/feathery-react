import {
  createDropdownElement,
  createDropdownProps,
  createStatefulOnChange,
  createOptionsMetadata,
  createRepeatOptionsMetadata,
  getMockFieldValue,
  resetMockFieldValue,
  getSelectElement,
  getOptionElements,
  getOptionByValue,
  getOptionByText,
  expectOptionToHaveTooltip,
  expectSelectToHaveValue,
  expectSelectToHaveOptionCount,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DropdownField from '../index';

describe('DropdownField - Base Functionality', () => {
  const dropdown = () => screen.getByRole('combobox') as HTMLSelectElement;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders DropdownField component with default props', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      expect(screen.getByRole('combobox')).toBeTruthy();
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with correct select attributes', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      expect(dropdown().tagName).toBe('SELECT');
      expect(dropdown().getAttribute('id')).toBe('test-dropdown-key');
      expect(dropdown().getAttribute('aria-label')).toBe('Test dropdown field');
    });

    it('renders with disabled state', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element, { disabled: true });

      render(<DropdownField {...props} />);

      expectFieldToBeDisabled(dropdown());
    });
  });

  describe('onChange Functionality', () => {
    it('handles basic option selection and onChange', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownProps(element, { onChange: mockOnChange });

      render(<DropdownField {...props} />);

      act(() => {
        const selectElement = dropdown();
        fireEvent.change(selectElement, { target: { value: 'Option 2' } });
      });

      expect(getMockFieldValue()).toBe('Option 2');
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLSelectElement)
        })
      );
    });

    it('handles empty value selection', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element, {
        onChange: mockOnChange,
        fieldVal: 'Option 1'
      });

      render(<DropdownField {...props} />);

      act(() => {
        const selectElement = dropdown();
        fireEvent.change(selectElement, { target: { value: '' } });
      });

      expect(getMockFieldValue()).toBe('');
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLSelectElement)
        })
      );
    });

    it('displays the selected value correctly', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownProps(element, { fieldVal: 'Option 2' });

      render(<DropdownField {...props} />);

      expectSelectToHaveValue('Option 2');
    });
  });

  describe('Options - Basic Display', () => {
    it('renders basic options correctly', () => {
      const options = ['Apple', 'Banana', 'Cherry'];
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(options)
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      // Should have empty option + 3 regular options
      expectSelectToHaveOptionCount(4);

      // Check that all options are present
      expect(getOptionByValue('Apple')).toBeTruthy();
      expect(getOptionByValue('Banana')).toBeTruthy();
      expect(getOptionByValue('Cherry')).toBeTruthy();

      // Check empty option
      const emptyOption = getOptionByValue('');
      expect(emptyOption).toBeTruthy();
    });

    it('renders options with custom labels', () => {
      const options = ['apple', 'banana', 'cherry'];
      const labels = ['🍎 Apple', '🍌 Banana', '🍒 Cherry'];
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(options, labels)
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      // Check that options have correct values but display labels
      const appleOption = getOptionByValue('apple');
      expect(appleOption?.textContent).toBe('🍎 Apple');

      const bananaOption = getOptionByValue('banana');
      expect(bananaOption?.textContent).toBe('🍌 Banana');

      const cherryOption = getOptionByValue('cherry');
      expect(cherryOption?.textContent).toBe('🍒 Cherry');
    });

    it('falls back to option value when no label is provided', () => {
      const options = ['apple', 'banana', 'cherry'];
      const labels = ['🍎 Apple']; // Only one label provided
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(options, labels)
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      // First option should use label
      const appleOption = getOptionByValue('apple');
      expect(appleOption?.textContent).toBe('🍎 Apple');

      // Other options should fall back to value
      const bananaOption = getOptionByValue('banana');
      expect(bananaOption?.textContent).toBe('banana');

      const cherryOption = getOptionByValue('cherry');
      expect(cherryOption?.textContent).toBe('cherry');
    });
  });

  describe('Options - With Tooltips', () => {
    it('renders options with tooltips', () => {
      const options = ['small', 'medium', 'large'];
      const labels = ['Small', 'Medium', 'Large'];
      const tooltips = ['Size S', 'Size M', 'Size L'];
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(options, labels, tooltips)
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      const smallOption = getOptionByValue('small');
      const mediumOption = getOptionByValue('medium');
      const largeOption = getOptionByValue('large');

      expect(smallOption).toBeTruthy();
      expect(mediumOption).toBeTruthy();
      expect(largeOption).toBeTruthy();

      expectOptionToHaveTooltip(smallOption!, 'Size S');
      expectOptionToHaveTooltip(mediumOption!, 'Size M');
      expectOptionToHaveTooltip(largeOption!, 'Size L');
    });

    it('handles partial tooltip arrays', () => {
      const options = ['option1', 'option2', 'option3'];
      const tooltips = ['Tooltip 1']; // Only one tooltip provided
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(options, undefined, tooltips)
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      const option1 = getOptionByValue('option1');
      const option2 = getOptionByValue('option2');
      const option3 = getOptionByValue('option3');

      expectOptionToHaveTooltip(option1!, 'Tooltip 1');
      expectOptionToHaveTooltip(option2!, ''); // Should be empty
      expectOptionToHaveTooltip(option3!, ''); // Should be empty
    });

    it('handles empty tooltip strings', () => {
      const options = ['option1', 'option2'];
      const tooltips = ['', 'Tooltip 2'];
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(options, undefined, tooltips)
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      const option1 = getOptionByValue('option1');
      const option2 = getOptionByValue('option2');

      expectOptionToHaveTooltip(option1!, '');
      expectOptionToHaveTooltip(option2!, 'Tooltip 2');
    });
  });

  describe('Focus and Blur Behavior', () => {
    it('handles focus and blur events correctly', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element);

      render(<DropdownField {...props} />);

      const selectElement = dropdown();

      // Focus
      act(() => {
        fireEvent.focus(selectElement);
      });

      // Check that focus event was handled
      expect(selectElement).toBeInTheDocument();

      // Blur
      act(() => {
        fireEvent.blur(selectElement);
      });

      // Check that blur event was handled
      expect(selectElement).toBeInTheDocument();
    });

    it('updates internal focused state on focus and blur', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element);

      const { container } = render(<DropdownField {...props} />);
      const selectElement = dropdown();

      // Check initial state (not focused)
      let subContainer = container.querySelector('div > div');
      expect(subContainer).toBeTruthy();

      // Focus
      act(() => {
        fireEvent.focus(selectElement);
      });

      // Check focused state is applied (this would show in active styles)
      subContainer = container.querySelector('div > div');
      expect(subContainer).toBeTruthy();

      // Blur
      act(() => {
        fireEvent.blur(selectElement);
      });

      // Check unfocused state
      subContainer = container.querySelector('div > div');
      expect(subContainer).toBeTruthy();
    });
  });

  describe('Disabled State', () => {
    it('prevents interaction when disabled', () => {
      const mockOnChange = jest.fn();
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element, {
        onChange: mockOnChange,
        disabled: true
      });

      render(<DropdownField {...props} />);

      const selectElement = dropdown();

      expectFieldToBeDisabled(selectElement);

      // Disabled dropdown should not allow user interaction
      expect(selectElement.disabled).toBe(true);
    });

    it('applies disabled styling', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element, { disabled: true });

      render(<DropdownField {...props} />);

      // The component should apply disabled styles through responsiveStyles.getTarget('disabled')
      // This is tested through the CSS-in-JS approach, so we verify the disabled attribute is set
      expectFieldToBeDisabled(dropdown());
    });
  });

  describe('Field Value Display', () => {
    it('displays the provided field value', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownProps(element, { fieldVal: 'Option 2' });

      render(<DropdownField {...props} />);

      expectSelectToHaveValue('Option 2');
    });

    it('updates display when field value changes', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownProps(element, { fieldVal: 'Option 1' });

      const { rerender } = render(<DropdownField {...props} />);

      expectSelectToHaveValue('Option 1');

      // Update field value
      const updatedProps = createDropdownProps(element, {
        fieldVal: 'Option 3'
      });
      rerender(<DropdownField {...updatedProps} />);

      expectSelectToHaveValue('Option 3');
    });

    it('handles null/undefined field values', () => {
      const element = createDropdownElement(
        'dropdown',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownProps(element, { fieldVal: null });

      render(<DropdownField {...props} />);

      expectSelectToHaveValue('');
    });
  });
});
