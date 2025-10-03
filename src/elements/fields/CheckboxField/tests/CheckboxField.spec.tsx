import {
  createCheckboxElement,
  createCheckboxProps,
  createStatefulOnChange,
  getMockFieldValue,
  resetMockFieldValue,
  getCheckboxElement,
  expectCheckboxToBeChecked,
  expectCheckboxToBeUnchecked,
  expectCheckboxToHaveValue,
  expectCheckboxToHaveId,
  expectCheckboxToHaveName,
  expectFieldToBeDisabled,
  expectFieldToHaveAriaLabel
} from './test-utils';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import CheckboxField from '../index';

describe('CheckboxField - Base Functionality', () => {
  const checkbox = () => getCheckboxElement();

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders CheckboxField component with default props', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element);

      render(<CheckboxField {...props} />);

      expect(screen.getByRole('checkbox')).toBeTruthy();
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with correct checkbox attributes', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element);

      render(<CheckboxField {...props} />);

      expect(checkbox().tagName).toBe('INPUT');
      expect(checkbox().type).toBe('checkbox');
      expectCheckboxToHaveId('test-checkbox-key');
      expectCheckboxToHaveName('test-checkbox-key');
      expectFieldToHaveAriaLabel(checkbox(), 'Test checkbox field');
    });

    it('renders with disabled state', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { disabled: true });

      render(<CheckboxField {...props} />);

      expectFieldToBeDisabled(checkbox());
    });

    it('renders with checked state', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: true });

      render(<CheckboxField {...props} />);

      expectCheckboxToBeChecked();
    });

    it('renders with unchecked state', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: false });

      render(<CheckboxField {...props} />);

      expectCheckboxToBeUnchecked();
    });
  });

  describe('onChange Functionality', () => {
    it('handles basic checkbox toggle and onChange', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, {
        onChange: mockOnChange,
        fieldVal: false
      });

      render(<CheckboxField {...props} />);

      act(() => {
        fireEvent.click(checkbox());
      });

      expect(getMockFieldValue()).toBe(true);
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('handles unchecking a checked checkbox', () => {
      const mockOnChange = createStatefulOnChange();
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, {
        onChange: mockOnChange,
        fieldVal: true
      });

      render(<CheckboxField {...props} />);

      expectCheckboxToBeChecked();

      act(() => {
        fireEvent.click(checkbox());
      });

      expect(getMockFieldValue()).toBe(false);
      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.any(HTMLInputElement)
        })
      );
    });

    it('displays the checked value correctly', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: true });

      render(<CheckboxField {...props} />);

      expectCheckboxToHaveValue(true);
    });

    it('displays the unchecked value correctly', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: false });

      render(<CheckboxField {...props} />);

      expectCheckboxToHaveValue(false);
    });
  });

  describe('Field Value Display', () => {
    it('displays the provided field value (checked)', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: true });

      render(<CheckboxField {...props} />);

      expectCheckboxToHaveValue(true);
    });

    it('displays the provided field value (unchecked)', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: false });

      render(<CheckboxField {...props} />);

      expectCheckboxToHaveValue(false);
    });

    it('updates display when field value changes', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { fieldVal: false });

      const { rerender } = render(<CheckboxField {...props} />);

      expectCheckboxToHaveValue(false);

      // Update field value
      const updatedProps = createCheckboxProps(element, { fieldVal: true });
      rerender(<CheckboxField {...updatedProps} />);

      expectCheckboxToHaveValue(true);
    });

    it('handles default fieldVal correctly', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element);
      // Remove fieldVal to test default behavior
      delete props.fieldVal;

      render(<CheckboxField {...props} />);

      // Default fieldVal should be true according to component definition
      expectCheckboxToHaveValue(true);
    });
  });

  describe('Disabled State', () => {
    it('prevents interaction when disabled', () => {
      const mockOnChange = jest.fn();
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, {
        onChange: mockOnChange,
        disabled: true,
        fieldVal: false
      });

      render(<CheckboxField {...props} />);

      const checkboxElement = checkbox();

      expectFieldToBeDisabled(checkboxElement);

      // Disabled checkbox should not allow user interaction
      expect(checkboxElement.disabled).toBe(true);
      // Value should remain unchanged
      expectCheckboxToHaveValue(false);
    });

    it('applies disabled styling', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, { disabled: true });

      render(<CheckboxField {...props} />);

      // The component should apply disabled styles through responsiveStyles.getTarget('disabled')
      // This is tested through the CSS-in-JS approach, so we verify the disabled attribute is set
      expectFieldToBeDisabled(checkbox());
    });

    it('maintains disabled state with different field values', () => {
      const element = createCheckboxElement('checkbox');
      const props = createCheckboxProps(element, {
        disabled: true,
        fieldVal: true
      });

      render(<CheckboxField {...props} />);

      expectFieldToBeDisabled(checkbox());
      expectCheckboxToHaveValue(true);
    });
  });
});
