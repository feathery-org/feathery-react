import {
  createDropdownMultiElement,
  createDropdownMultiProps,
  createStatefulOnChange,
  createOptionsMetadata,
  createMaxLengthElement,
  createCreatableElement,
  createSingleSelectCreatableElement,
  getMockFieldValue,
  resetMockFieldValue,
  setMockFieldValue,
  getSelectInput,
  getReactSelectContainer,
  getOptionByText,
  getOptionElements,
  getSelectedValues,
  getSingleValue,
  getSingleValues,
  getValueContainer,
  getListbox,
  getFocusedOptionText,
  expectSelectedValueCount,
  expectValueToBeSelected,
  openDropdownMenu,
  openDropdownMenuByClick,
  selectOptionByText,
  removeSelectedValue,
  getRemoveButton,
  mockTouchDevice
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
    // clearAllMocks leaves return values in place, so pin the desktop default
    mockTouchDevice(false);
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

    it('stays a chip multi-select at a max length above 1', async () => {
      const user = userEvent.setup();
      const element = createMaxLengthElement(2, [
        'Option 1',
        'Option 2',
        'Option 3'
      ]);

      const MultiHarness = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>([]);
        const props = createDropdownMultiProps(element, {
          fieldVal,
          onChange: (next: any[]) => setFieldVal(next.map((opt) => opt.value))
        });
        return <DropdownMultiField {...props} />;
      };

      render(<MultiHarness />);

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 1');

      // Pins the three behaviors single-select mode drops: the picked option
      // leaves the menu, the menu stays open, and the chip keeps its remove.
      await waitFor(() => expect(getSelectedValues()).toHaveLength(1));
      expect(getOptionElements().length).toBeGreaterThan(0);
      expect(getOptionByText('Option 1')).toBeUndefined();
      expect(getRemoveButton('Option 1')).not.toBeNull();
      expect(getSingleValues()).toHaveLength(0);
    });

    it('handles max length of 0 (no selections allowed)', () => {
      const element = createMaxLengthElement(0, ['Option 1', 'Option 2']);
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      // When max_length is 0, it's falsy so options are enabled
      expect(getReactSelectContainer()).toBeTruthy();
    });
  });

  describe('Single Select Mode (max length of 1)', () => {
    const renderSingleSelect = ({
      options = ['Option 1', 'Option 2', 'Option 3'],
      initialValue = [] as string[],
      element = createMaxLengthElement(1, options),
      editMode = false
    } = {}) => {
      const onChange = jest.fn();

      const SingleSelectHarness = () => {
        const [fieldVal, setFieldVal] = React.useState<string[]>(initialValue);
        const props = createDropdownMultiProps(element, {
          fieldVal,
          editMode,
          onChange: (next: any[]) => {
            onChange(next);
            setFieldVal(next.map((opt) => opt.value));
          }
        });

        return <DropdownMultiField {...props} />;
      };

      return { onChange, ...render(<SingleSelectHarness />) };
    };

    const expectOnChangeWithOnly = (onChange: jest.Mock, value: string) => {
      const last = onChange.mock.calls[onChange.mock.calls.length - 1];
      expect(last[0]).toHaveLength(1);
      expect(last[0][0]).toEqual(expect.objectContaining({ value }));
    };

    it('closes the menu immediately after selecting an option', async () => {
      const user = userEvent.setup();
      renderSingleSelect();

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 2');

      await waitFor(() => expect(getOptionElements()).toHaveLength(0));
      expect(getSingleValue()?.textContent).toBe('Option 2');
    });

    it('blurs the input after selecting on a touch device', async () => {
      mockTouchDevice(true);
      const user = userEvent.setup();
      renderSingleSelect();

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 2');

      // jsdom has no soft keyboard; dropping focus is what dismisses it
      await waitFor(() =>
        expect(document.activeElement).not.toBe(getSelectInput())
      );
    });

    it('keeps focus on the input after selecting without touch', async () => {
      const user = userEvent.setup();
      renderSingleSelect();

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 2');

      await waitFor(() =>
        expect(document.activeElement).toBe(getSelectInput())
      );
    });

    it('renders the selected value as plain text with no chip or remove button', () => {
      renderSingleSelect({ initialValue: ['Option 1'] });

      // Expectation moved: isMulti:false renders a SingleValue, so there is no
      // longer a chip to strip a remove button out of.
      expect(getSelectedValues()).toHaveLength(0);
      expect(getSingleValues()).toHaveLength(1);

      const value = getSingleValue() as HTMLElement;
      expect(value.textContent).toBe('Option 1');
      const styles = window.getComputedStyle(value);
      expect(styles.marginLeft).toBe('0px');
      expect(styles.marginRight).toBe('0px');
    });

    it('keeps every option visible and enabled while a value is selected', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 1'] });

      await openDropdownMenu(user);

      const options = getOptionElements();
      expect(options).toHaveLength(3);
      options.forEach((option) => {
        expect(option.getAttribute('aria-disabled')).not.toBe('true');
      });
      expect(getOptionByText('Option 1')).toBeTruthy();
    });

    it('replaces the selection when a different option is picked', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({ initialValue: ['Option 1'] });

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 3');

      expectOnChangeWithOnly(onChange, 'Option 3');
      await waitFor(() =>
        expect(getSingleValue()?.textContent).toBe('Option 3')
      );
      expect(getSingleValues()).toHaveLength(1);
    });

    it('keeps the value and closes the menu when the selected option is re-picked', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({ initialValue: ['Option 2'] });

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 2');

      await waitFor(() => expect(getOptionElements()).toHaveLength(0));
      // Expectation moved: v1 swallowed the re-pick as `deselect-option` and
      // fired nothing. Under isMulti:false it is another `select-option`, so
      // onChange fires again, matching the native DropdownField.
      expectOnChangeWithOnly(onChange, 'Option 2');
      expect(getSingleValue()?.textContent).toBe('Option 2');
    });

    it('does not mark the listbox as multiselectable', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 1'] });

      await openDropdownMenu(user);

      expect(getListbox()?.getAttribute('aria-multiselectable')).toBe('false');
    });

    it('opens the menu focused on the current value', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 3'] });

      await openDropdownMenuByClick(user);

      expect(getFocusedOptionText()).toBe('Option 3');
    });

    it('opens the menu on touch start', async () => {
      renderSingleSelect({ initialValue: ['Option 1'] });

      fireEvent.touchStart(getReactSelectContainer());

      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );
    });

    it('opens the menu focused on the current value from the keyboard', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 2'] });

      getSelectInput().focus();
      await user.keyboard('[ArrowDown]');
      await waitFor(() =>
        expect(getOptionElements().length).toBeGreaterThan(0)
      );

      expect(getFocusedOptionText()).toBe('Option 2');
    });

    it('filters options while typing and hides the value text', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 1'] });

      await openDropdownMenu(user);
      await user.type(getSelectInput(), 'Option 3');

      await waitFor(() => expect(getOptionElements()).toHaveLength(1));
      expect(getOptionByText('Option 3')).toBeTruthy();
      // Expectation moved: react-select skips SingleValue entirely while an
      // input value is present, so the element is absent rather than hidden.
      expect(getSingleValue()).toBeNull();
    });

    it('restores the value text when the typed filter is cleared', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 1'] });

      await openDropdownMenu(user);
      const input = getSelectInput();
      await user.type(input, 'Option 3');
      await waitFor(() => expect(getSingleValue()).toBeNull());

      await user.clear(input);

      await waitFor(() =>
        expect(getSingleValue()?.textContent).toBe('Option 1')
      );
    });

    it('clears the search text and restores the value when Enter re-picks the filtered value', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({ initialValue: ['Option 2'] });

      await openDropdownMenu(user);
      const input = getSelectInput();
      await user.type(input, 'Option 2');
      await waitFor(() => expect(getOptionElements()).toHaveLength(1));
      expect(getSingleValue()).toBeNull();

      await user.keyboard('{Enter}');

      // The v1 Enter guard blocked react-select's setValue, the only thing that
      // resets the controlled inputValue, so the menu closed on stale text.
      await waitFor(() => expect(getOptionElements()).toHaveLength(0));
      expect(getSelectInput().value).toBe('');
      const value = getSingleValue() as HTMLElement;
      expect(value).not.toBeNull();
      expect(value.textContent).toBe('Option 2');
      expect(window.getComputedStyle(value).display).not.toBe('none');
      expectOnChangeWithOnly(onChange, 'Option 2');
    });

    it('clears the value on Backspace with an empty input', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({ initialValue: ['Option 2'] });

      getSelectInput().focus();
      await user.keyboard('{Backspace}');

      expect(onChange).toHaveBeenLastCalledWith([]);
      await waitFor(() => expect(getSingleValue()).toBeNull());
    });

    it('clears the value on Delete with an empty input', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({ initialValue: ['Option 2'] });

      getSelectInput().focus();
      await user.keyboard('{Delete}');

      expect(onChange).toHaveBeenLastCalledWith([]);
      await waitFor(() => expect(getSingleValue()).toBeNull());
    });

    it('renders only the first entry of a legacy multi-value array', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({
        initialValue: ['Option 1', 'Option 3']
      });

      // Clamped for display only - nothing is written back on mount
      expect(getSingleValues()).toHaveLength(1);
      expect(getSingleValue()?.textContent).toBe('Option 1');

      await openDropdownMenu(user);
      const options = getOptionElements();
      expect(options).toHaveLength(3);
      options.forEach((option) => {
        expect(option.getAttribute('aria-disabled')).not.toBe('true');
      });

      await selectOptionByText(user, 'Option 2');

      // Any pick heals the whole stored array down to a single entry
      expectOnChangeWithOnly(onChange, 'Option 2');
      await waitFor(() =>
        expect(getSingleValue()?.textContent).toBe('Option 2')
      );
    });

    it('keeps the dropped entries of a legacy array out of the options', async () => {
      const user = userEvent.setup();
      // 'Ghost' is not a configured option. Unclamped, the backwards-compat
      // pass that keeps stored values selectable would add it to the menu.
      renderSingleSelect({ initialValue: ['Option 1', 'Ghost'] });

      expect(getSingleValue()?.textContent).toBe('Option 1');

      await openDropdownMenu(user);

      expect(getOptionElements()).toHaveLength(3);
      expect(getOptionByText('Ghost')).toBeFalsy();
    });

    it('clears a legacy multi-value array entirely on Backspace', async () => {
      const user = userEvent.setup();
      const { onChange } = renderSingleSelect({
        initialValue: ['Option 1', 'Option 3']
      });

      getSelectInput().focus();
      await user.keyboard('{Backspace}');

      expect(onChange).toHaveBeenLastCalledWith([]);
      await waitFor(() => expect(getSingleValue()).toBeNull());
    });

    it('keeps the value container layout stable across open and typing', async () => {
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 1'] });

      const layout = () => {
        const styles = window.getComputedStyle(getValueContainer());
        return {
          padding: styles.padding,
          display: styles.display,
          alignItems: styles.alignItems
        };
      };

      const closed = layout();
      expect(closed).toEqual({
        padding: '2px 8px',
        display: 'grid',
        alignItems: 'center'
      });

      await openDropdownMenu(user);
      expect(layout()).toEqual(closed);

      await user.type(getSelectInput(), 'Option');
      expect(layout()).toEqual(closed);
    });

    it('lists the selected option once in windowed results', async () => {
      const user = userEvent.setup();
      const options = Array.from({ length: 500 }, (_, i) => `Option ${i + 1}`);
      renderSingleSelect({ options, initialValue: ['Option 400'] });

      await openDropdownMenu(user);

      // Windowing hoists selected options, which must not double up in the menu
      const matches = getOptionElements().filter(
        (option) => option.textContent === 'Option 400'
      );
      expect(matches).toHaveLength(1);
    });

    it('selects from windowed results and closes the menu', async () => {
      const user = userEvent.setup();
      const options = Array.from({ length: 500 }, (_, i) => `Option ${i + 1}`);
      const { onChange } = renderSingleSelect({ options });

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 5');

      expectOnChangeWithOnly(onChange, 'Option 5');
      await waitFor(() => expect(getOptionElements()).toHaveLength(0));
    });

    it('selects and closes when creating an option', async () => {
      const user = userEvent.setup();
      const element = createSingleSelectCreatableElement(['Alpha']);
      const { onChange } = renderSingleSelect({ element });

      await openDropdownMenu(user);
      await user.type(getSelectInput(), 'New Option');
      await user.keyboard('{Enter}');

      await waitFor(() =>
        expect(getSingleValue()?.textContent).toBe('New Option')
      );
      expect(getOptionElements()).toHaveLength(0);
      expectOnChangeWithOnly(onChange, 'New Option');
    });

    it('disables options while Salesforce options are loading', async () => {
      mockUseSalesforceSync.mockReturnValue({
        dynamicOptions: [],
        loadingDynamicOptions: true,
        shouldSalesforceSync: true
      });
      const user = userEvent.setup();
      renderSingleSelect({ initialValue: ['Option 1'] });

      await openDropdownMenu(user);

      const options = getOptionElements();
      expect(options.length).toBeGreaterThan(0);
      options.forEach((option) => {
        expect(option.getAttribute('aria-disabled')).toBe('true');
      });
    });

    it('renders the selection but stays inert on the builder canvas', () => {
      const { container } = renderSingleSelect({
        initialValue: ['Option 1'],
        editMode: true
      });

      // Expectation moved: the old version rendered no value, so it passed
      // either way. A value is what puts editMode's pointerEvents under test.
      expect(getSingleValue()?.textContent).toBe('Option 1');
      expect(
        window.getComputedStyle(container.firstChild as HTMLElement)
          .pointerEvents
      ).toBe('none');
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
      // Moved from max_length 1 to 2: a max of 1 is now single-select mode,
      // which keeps every option listed and enabled.
      const element = createMaxLengthElement(2, ['Alpha', 'Beta']);
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Alpha', 'Beta']
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

  describe('Windowed Options - Large Datasets', () => {
    const createLargeOptionsMetadata = (count: number) => ({
      options: Array.from({ length: count }, (_, i) => `Option ${i + 1}`),
      option_labels: Array.from({ length: count }, (_, i) => `Option ${i + 1}`)
    });

    it('renders a subset of options for large datasets (>250)', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Should show 250 options + 1 "more results" indicator
      const options = getOptionElements();
      expect(options.length).toBeLessThanOrEqual(251);
    });

    it('displays "more results" indicator when options are hidden', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Look for the "more results" text
      await waitFor(() => {
        const menu = document.querySelector('div[class*="-menu"]');
        expect(menu?.textContent).toContain('more result');
        expect(menu?.textContent).toContain('refine your search');
      });
    });

    it('filters options when user types a search term', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);
      const input = getSelectInput();

      // Type a search term that matches only a few options
      await user.type(input, 'Option 42');

      await waitFor(() => {
        const options = getOptionElements();
        // Should show much fewer options now
        expect(options.length).toBeLessThan(20);
      });
    });

    it('removes indicator when search reduces results below threshold', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);
      const input = getSelectInput();

      // Type a very specific search term
      await user.type(input, 'Option 123');

      await waitFor(() => {
        const menu = document.querySelector('div[class*="-menu"]');
        // Should NOT show "more results" since filtered results are small
        expect(menu?.textContent).not.toContain('more result');
      });
    });

    it('still allows selection from windowed options', async () => {
      const user = userEvent.setup();
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange
      });

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);
      await selectOptionByText(user, 'Option 1');

      expect(mockOnChange).toHaveBeenCalled();
      expect(getMockFieldValue()).toEqual(['Option 1']);
    });

    it('preserves selected values in windowed results', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element, {
        fieldVal: ['Option 400', 'Option 450']
      });

      render(<DropdownMultiField {...props} />);

      // Selected values should be displayed
      expectSelectedValueCount(2);
      expectValueToBeSelected('Option 400');
      expectValueToBeSelected('Option 450');

      // When opening menu, selected options should still be accessible
      await openDropdownMenu(user);
      const options = getOptionElements();
      expect(options.length).toBeGreaterThan(0);
    });

    it('indicator is not selectable', async () => {
      const user = userEvent.setup();
      const mockOnChange = createStatefulOnChange();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(500)
      );
      const props = createDropdownMultiProps(element, {
        onChange: mockOnChange
      });

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Find and try to click the indicator
      const menu = document.querySelector('div[class*="-menu"]');
      const indicatorText = menu?.textContent?.match(/\d+ more results?/);

      if (indicatorText) {
        // The indicator should be styled as disabled/non-interactive
        // Clicking it should not trigger onChange
        const optionsBefore = getMockFieldValue();

        // Find the element containing the indicator text and try to click it
        const allElements = menu?.querySelectorAll('div');
        const indicatorElement = Array.from(allElements || []).find((el) =>
          el.textContent?.includes('more result')
        );

        if (indicatorElement) {
          await user.click(indicatorElement);
          // Value should not have changed
          expect(getMockFieldValue()).toEqual(optionsBefore);
        }
      }
    });

    it('handles datasets at exact threshold (250 options)', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(250)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Should show all 250 options without indicator
      const options = getOptionElements();
      expect(options).toHaveLength(250);

      const menu = document.querySelector('div[class*="-menu"]');
      expect(menu?.textContent).not.toContain('more result');
    });

    it('handles datasets just above threshold (251 options)', async () => {
      const user = userEvent.setup();
      const element = createDropdownMultiElement(
        'dropdown_multi',
        createLargeOptionsMetadata(251)
      );
      const props = createDropdownMultiProps(element);

      render(<DropdownMultiField {...props} />);

      await openDropdownMenu(user);

      // Should show 250 selectable options (indicator is a custom div, not an option)
      const options = getOptionElements();
      expect(options).toHaveLength(250);

      // The indicator should appear in menu text
      const menu = document.querySelector('div[class*="-menu"]');
      expect(menu?.textContent).toContain('1 more result');
      // Should use singular form
      expect(menu?.textContent).not.toContain('1 more results');
    });
  });
});
