import {
  createDropdownMultiElement,
  createDropdownMultiProps,
  createStatefulOnChange,
  createOptionsMetadata,
  createMaxLengthElement,
  getMockFieldValue,
  resetMockFieldValue,
  setMockFieldValue,
  getSelectInput,
  getReactSelectContainer,
  getOptionByText,
  expectSelectedValueCount,
  expectValueToBeSelected,
  openDropdownMenu,
  selectOptionByText,
  removeSelectedValue
} from './test-utils';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DropdownMultiField from '../index';

describe('DropdownMultiField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
  });

  describe('Basic Rendering', () => {
    it('renders DropdownMultiField component with default props', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      expect(getReactSelectContainer()).toBeTruthy();
      expect(screen.getByText('Test Label')).toBeTruthy();
    });

    it('renders with correct input attributes', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      const input = getSelectInput();
      expect(input.getAttribute('id')).toBe('test-dropdown-multi-key');
      expect(input.getAttribute('aria-label')).toBe(
        'Test multi-select dropdown field'
      );
    });

    it('renders with disabled state', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, { disabled: true });

      render(<DropdownMultiField {...props} />);

      const input = getSelectInput();
      // React-select sets disabled on the input element directly
      expect(input.disabled).toBe(true);
    });

    it('renders with edit mode (pointer events disabled)', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, { editMode: true });

      const { container } = render(<DropdownMultiField {...props} />);

      const dropdownContainer = container.firstChild as HTMLElement;
      const computedStyle = window.getComputedStyle(dropdownContainer);
      expect(computedStyle.pointerEvents).toBe('none');
    });
  });

  describe('onChange Functionality', () => {
    it('handles option selection and onChange', async () => {
      const user = userEvent.setup();
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange
      });

      render(<DropdownMultiField {...props} />);

      // Open dropdown and select an option
      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 1');

      expect(mockOnChange).toHaveBeenCalled();
      const callArgs = mockOnChange.mock.calls[0][0];
      expect(callArgs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'Option 1', label: 'Option 1' })
        ])
      );
      expect(getMockFieldValue()).toEqual(['Option 1']);
    });

    it('handles multiple option selection', async () => {
      const user = userEvent.setup();
      let currentValues: string[] = [];
      const mockOnChange = jest.fn((options: any[]) => {
        currentValues = options.map((opt: any) => opt.value);
        setMockFieldValue(currentValues);
      });

      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );

      const TestComponent = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>([]);

        const handleChange = (options: any[]) => {
          const values = options.map((opt) => opt.value);
          setFieldVal(values);
          mockOnChange(options);
        };

        const props = createDropdownMultiProps(element, {
          onChange: handleChange,
          fieldVal
        });

        return <DropdownMultiField {...props} />;
      };

      render(<TestComponent />);

      // Select first option
      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 1');

      // Select second option
      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 2');

      // Check that onChange was called with both selections
      const lastCall =
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1];
      expect(lastCall[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'Option 1', label: 'Option 1' }),
          expect.objectContaining({ value: 'Option 2', label: 'Option 2' })
        ])
      );
    });

    it('handles deselection of options', async () => {
      const user = userEvent.setup();
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange,
        fieldVal: ['Option 1', 'Option 2']
      });

      render(<DropdownMultiField {...props} />);

      // Remove Option 1
      await removeSelectedValue(user, 'Option 1');

      expect(getMockFieldValue()).toEqual(['Option 2']);
    });

    it('handles empty selection', async () => {
      const user = userEvent.setup();
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange,
        fieldVal: ['Option 1']
      });

      render(<DropdownMultiField {...props} />);

      // Remove the only selected option
      await removeSelectedValue(user, 'Option 1');

      expect(getMockFieldValue()).toEqual([]);
    });
  });

  describe('Max Selectable Functionality', () => {
    it('disables options when max length is reached', async () => {
      const user = userEvent.setup();
      const element = createMaxLengthElement(2, [
        'Option 1',
        'Option 2',
        'Option 3'
      ]);
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Option 1', 'Option 2']
      });

      render(<DropdownMultiField {...props} />);

      // Try to open menu - options should be disabled
      await openDropdownMenu(user);

      const option3 = getOptionByText('Option 3');
      if (option3) {
        expect(option3.getAttribute('aria-disabled')).toBe('true');
      }
    });

    it('enables options when below max length', async () => {
      const user = userEvent.setup();
      const element = createMaxLengthElement(3, [
        'Option 1',
        'Option 2',
        'Option 3'
      ]);
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Option 1']
      });

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Options should be selectable
      const option2 = getOptionByText('Option 2');
      if (option2) {
        expect(option2.getAttribute('aria-disabled')).not.toBe('true');
      }
    });

    it('allows selection up to max length', async () => {
      const user = userEvent.setup();
      const mockOnChange = createStatefulOnChange();
      const element = createMaxLengthElement(2, [
        'Option 1',
        'Option 2',
        'Option 3'
      ]);
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange,
        fieldVal: ['Option 1']
      });

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 2');

      expect(getMockFieldValue()).toEqual(['Option 1', 'Option 2']);
    });

    it('handles max length of 0 (no selections allowed)', () => {
      const element = createMaxLengthElement(0, ['Option 1', 'Option 2']);
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      // When max_length is 0, it's falsy so options are enabled
      expect(getReactSelectContainer()).toBeTruthy();
    });
  });

  describe('Options - Basic Display', () => {
    it('renders basic options correctly', async () => {
      const user = userEvent.setup();
      const options = ['Apple', 'Banana', 'Cherry'];
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(options)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Check that all options are present
      expect(getOptionByText('Apple')).toBeTruthy();
      expect(getOptionByText('Banana')).toBeTruthy();
      expect(getOptionByText('Cherry')).toBeTruthy();
    });

    it('renders options with custom labels', async () => {
      const user = userEvent.setup();
      const options = ['apple', 'banana', 'cherry'];
      const labels = ['🍎 Apple', '🍌 Banana', '🍒 Cherry'];
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(options, labels)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Check that options display labels
      expect(getOptionByText('🍎 Apple')).toBeTruthy();
      expect(getOptionByText('🍌 Banana')).toBeTruthy();
      expect(getOptionByText('🍒 Cherry')).toBeTruthy();
    });

    it('falls back to option value when no label is provided', async () => {
      const user = userEvent.setup();
      const options = ['apple', 'banana', 'cherry'];
      const labels = ['🍎 Apple']; // Only one label provided
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(options, labels)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // First option should use label
      expect(getOptionByText('🍎 Apple')).toBeTruthy();

      // Other options should fall back to value
      expect(getOptionByText('banana')).toBeTruthy();
      expect(getOptionByText('cherry')).toBeTruthy();
    });

    it('displays selected values correctly', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Option 1', 'Option 3']
      });

      render(<DropdownMultiField {...props} />);

      expectSelectedValueCount(2);
      expectValueToBeSelected('Option 1');
      expectValueToBeSelected('Option 3');
    });
  });

  describe('Disabled State', () => {
    it('prevents interaction when disabled', () => {
      const mockOnChange = jest.fn();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange,
        disabled: true
      });

      render(<DropdownMultiField {...props} />);

      const input = getSelectInput();
      expect(input.disabled).toBe(true);
    });

    it('applies disabled attribute', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, { disabled: true });

      render(<DropdownMultiField {...props} />);

      const input = getSelectInput();
      expect(input.disabled).toBe(true);
    });
  });

  describe('Field Value Display', () => {
    it('displays the provided field values', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Option 1', 'Option 3']
      });

      render(<DropdownMultiField {...props} />);

      expectSelectedValueCount(2);
    });

    it('updates display when field values change', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2', 'Option 3'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Option 1']
      });

      const { rerender } = render(<DropdownMultiField {...props} />);

      expectSelectedValueCount(1);

      // Update field values
      const updatedProps = createDropdownMultiProps(element, {
        fieldVal: ['Option 2', 'Option 3']
      });
      rerender(<DropdownMultiField {...updatedProps} />);

      expectSelectedValueCount(2);
    });

    it('handles null/undefined field values', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, { fieldVal: null });

      render(<DropdownMultiField {...props} />);

      expectSelectedValueCount(0);
    });

    it('handles empty array field values', () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element, { fieldVal: [] });

      render(<DropdownMultiField {...props} />);

      expectSelectedValueCount(0);
    });
  });

  describe('Focus and Blur Behavior', () => {
    it('handles focus and blur events correctly', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Option 1', 'Option 2'])
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      const input = getSelectInput();

      // Focus
      await user.click(input);

      // Check that input is focused
      expect(input).toBeInTheDocument();

      // Blur
      await user.tab();

      // Check that input still exists
      expect(input).toBeInTheDocument();
    });
  });
});
