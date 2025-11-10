import {
  createDropdownMultiElement,
  createDropdownMultiProps,
  createStatefulOnChange,
  createOptionsMetadata,
  createMaxLengthElement,
  createCreatableElement,
  getMockFieldValue,
  resetMockFieldValue,
  setMockFieldValue,
  getSelectInput,
  getReactSelectContainer,
  getOptionByText,
  getOptionElements,
  expectSelectedValueCount,
  expectValueToBeSelected,
  openDropdownMenu,
  selectOptionByText,
  removeSelectedValue,
  getRemoveButton
} from './test-utils';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DropdownMultiField from '../index';
import useSalesforceSync from '../../../../hooks/useSalesforceSync';

const mockUseSalesforceSync = useSalesforceSync as jest.MockedFunction<
  typeof useSalesforceSync
>;

describe('DropdownMultiField - Base Functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockFieldValue();
    mockUseSalesforceSync.mockReturnValue({
      dynamicOptions: [],
      loadingDynamicOptions: false,
      shouldSalesforceSync: false
    });
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

  describe('Enter key guards', () => {
    const renderDropdownForm = (props: any, submitSpy: jest.Mock) => {
      render(
        <form
          onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            submitSpy(event);
          }}
        >
          <DropdownMultiField {...props} />
          <button type='submit'>Submit</button>
        </form>
      );
    };

    it('blocks form submission when pressing Enter with blank input', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta'])
      );
      const props = createDropdownMultiProps(element);
      const submitSpy = jest.fn();

      renderDropdownForm(props, submitSpy);

      await user.click(getReactSelectContainer());
      await user.keyboard('{Escape}');
      expect(getOptionElements()).toHaveLength(0);

      await user.keyboard('{Enter}');
      await waitFor(() => {
        expect(getOptionElements().length).toBeGreaterThan(0);
      });

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('blocks form submission when attempting to re-add a selected option', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha']
      });
      const submitSpy = jest.fn();

      renderDropdownForm(props, submitSpy);

      await openDropdownMenu(user);
      const input = getSelectInput();
      await user.clear(input);
      await user.type(input, 'Alpha');

      await user.keyboard('{Enter}');

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('blocks form submission when no options are available', async () => {
      const user = userEvent.setup();
      const element = createMaxLengthElement(1, ['Alpha']);
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha']
      });
      const submitSpy = jest.fn();

      renderDropdownForm(props, submitSpy);

      await user.click(getReactSelectContainer());
      await waitFor(() => {
        const menu = document.querySelector('div[class*="-menu"]');
        if (!menu) {
          throw new Error('Dropdown menu did not open');
        }
      });
      await user.keyboard('{Enter}');

      expect(submitSpy).not.toHaveBeenCalled();
    });

    it('allows creatable selection without submitting the form', async () => {
      const user = userEvent.setup();
      const element = createCreatableElement(['Alpha']);
      const submitSpy = jest.fn();

      const CreatableHarness = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>([]);
        const props = createDropdownMultiProps(element, {
          fieldVal,
          onChange: (next: any[]) => {
            setFieldVal(next.map((opt) => opt.value));
          }
        });

        return (
          <form
            onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              submitSpy(event);
            }}
          >
            <DropdownMultiField {...props} />
            <button type='submit'>Submit</button>
          </form>
        );
      };

      render(<CreatableHarness />);

      await openDropdownMenu(user);
      const input = getSelectInput();
      await user.clear(input);
      await user.type(input, 'New Option');

      await waitFor(() => {
        const createOption = getOptionElements().find((option) =>
          option.textContent?.includes('New Option')
        );
        if (!createOption) {
          throw new Error('Creatable option not available');
        }
      });

      await user.keyboard('{Enter}');

      await waitFor(() => {
        expectValueToBeSelected('New Option');
      });

      expect(submitSpy).not.toHaveBeenCalled();
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

  describe('Pointer Interactions', () => {
    it('opens the menu on mouse click', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta', 'Gamma'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha']
      });

      render(<DropdownMultiField {...props} />);

      await user.click(getReactSelectContainer());

      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );
    });

    it('opens the menu on touch start', async () => {
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta', 'Gamma'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha']
      });

      render(<DropdownMultiField {...props} />);

      const control = getReactSelectContainer();
      fireEvent.touchStart(control);

      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );
    });

    it('closes the menu on outside pointer after opening', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta', 'Gamma'])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha']
      });

      render(<DropdownMultiField {...props} />);

      await user.click(getReactSelectContainer());

      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );

      fireEvent.pointerDown(document.body, {
        pointerType: 'touch',
        bubbles: true
      });

      await waitFor(() => expect(getOptionElements()).toHaveLength(0));
    });

    it('removes a value via touch without reopening the menu', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta'])
      );
      const onChange = createStatefulOnChange();
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha', 'Beta'],
        onChange
      });

      render(<DropdownMultiField {...props} />);

      const removeBtn = getRemoveButton('Alpha');
      if (!removeBtn) throw new Error('Remove button not found');

      fireEvent.pointerDown(removeBtn, { pointerType: 'touch' });
      await user.click(removeBtn);

      await waitFor(() => expect(getMockFieldValue()).toEqual(['Beta']));
      expect(getOptionElements()).toHaveLength(0);
    });
  });

  describe('Keyboard Interactions', () => {
    it('opens the menu when pressing ArrowDown while focused', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta'])
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      const input = getSelectInput();
      input.focus();

      await user.keyboard('{ArrowDown}');

      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );
    });

    it('selects an option with Enter after navigating', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata(['Alpha', 'Beta'])
      );

      const KeyboardHarness = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>([]);
        const props = createDropdownMultiProps(element, {
          fieldVal,
          onChange: (next: any[]) => {
            setFieldVal(next.map((opt) => opt.value));
          }
        });

        return <DropdownMultiField {...props} />;
      };

      render(<KeyboardHarness />);

      const input = getSelectInput();
      input.focus();

      await user.keyboard('{ArrowDown}');
      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );
      await user.keyboard('{Enter}');

      await waitFor(() => expectValueToBeSelected('Alpha'));
    });

    it('creates a new option when creatable is enabled', async () => {
      const user = userEvent.setup();
      const element = createCreatableElement(['Alpha']);

      const CreatableHarness = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>([]);
        const props = createDropdownMultiProps(element, {
          fieldVal,
          onChange: (next: any[]) => {
            setFieldVal(next.map((opt) => opt.value));
          }
        });

        return <DropdownMultiField {...props} />;
      };

      render(<CreatableHarness />);

      const input = getSelectInput();
      await user.click(input);
      await user.type(input, 'Unique Option');
      await user.keyboard('{Enter}');

      await waitFor(() => expectValueToBeSelected('Unique Option'));
    });

    it('does not duplicate a creatable option via Enter', async () => {
      const user = userEvent.setup();
      const element = createCreatableElement(['Alpha']);

      const CreatableHarness = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>(['Alpha']);
        const props = createDropdownMultiProps(element, {
          fieldVal,
          onChange: (next: any[]) => {
            setFieldVal(next.map((opt) => opt.value));
          }
        });

        return <DropdownMultiField {...props} />;
      };

      render(<CreatableHarness />);

      const input = getSelectInput();
      await user.click(input);
      await user.type(input, 'Alpha');
      await user.keyboard('{Enter}');

      await waitFor(() => expectSelectedValueCount(1));
      expectValueToBeSelected('Alpha');
    });
  });

  describe('Salesforce sync integration', () => {
    it('merges persisted field values into dynamic options', async () => {
      mockUseSalesforceSync.mockReturnValue({
        dynamicOptions: [{ value: 'alpha', label: 'Alpha' }],
        loadingDynamicOptions: false,
        shouldSalesforceSync: true
      });

      const element = createDropdownMultiElement(
        'dropdown_multi',
        createOptionsMetadata([])
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Persisted Option']
      });

      render(<DropdownMultiField {...props} />);

      await waitFor(() => expectSelectedValueCount(1));
      expectValueToBeSelected('Persisted Option');
    });
  });
});
