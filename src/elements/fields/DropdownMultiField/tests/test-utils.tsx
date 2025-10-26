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
import { waitFor } from '@testing-library/react';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
};

jest.mock('../../../../hooks/useSalesforceSync', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    dynamicOptions: [],
    loadingDynamicOptions: false,
    shouldSalesforceSync: false
  }))
}));

export const createDropdownMultiElement = (
  type: string,
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-dropdown-multi',
    type,
    metadata,
    {
      placeholder: 'Select options',
      aria_label: 'Test multi-select dropdown field'
    },
    styles
  );

export const createDropdownMultiProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: [],
    repeatIndex: null,
    rightToLeft: false,
    onChange: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((selectedOptions: any[]) => {
    const values = selectedOptions
      ? selectedOptions.map((opt) => opt.value)
      : [];
    setMockFieldValue(values);
  });
};

export const createOptionsMetadata = (
  options: string[],
  labels?: string[],
  tooltips?: string[]
) => ({
  options,
  ...(labels && { option_labels: labels }),
  ...(tooltips && { option_tooltips: tooltips })
});

export const createRepeatOptionsMetadata = (repeatOptions: any[]) => ({
  repeat_options: [repeatOptions]
});

export const createMaxLengthElement = (
  maxLength: number,
  options: string[] = ['Option 1', 'Option 2', 'Option 3']
) =>
  createDropdownMultiElement('dropdown_multi', {
    ...createOptionsMetadata(options),
    max_length: maxLength
  });

export const createCreatableElement = (options: string[]) =>
  createDropdownMultiElement('dropdown_multi', {
    ...createOptionsMetadata(options),
    creatable_options: true
  });

export const getSelectInput = () => {
  const input = document.querySelector('input[id="test-dropdown-multi-key"]');
  if (!input) throw new Error('React-select input not found');
  return input as HTMLInputElement;
};

export const getReactSelectContainer = () => {
  const container = document.querySelector('div[class*="-control"]');
  if (!container) throw new Error('React-select container not found');
  return container as HTMLElement;
};

export const getOptionElements = () => {
  const menu = document.querySelector('div[class*="-menu"]');
  if (!menu) return [];
  return Array.from(menu.querySelectorAll('div[class*="-option"]'));
};

export const getOptionByText = (text: string) => {
  const options = getOptionElements();
  return options.find((option) => option.textContent === text);
};

export const getSelectedValues = () => {
  return Array.from(document.querySelectorAll('div[class*="-multiValue"]'));
};

export const getSelectedValueElement = (text: string) => {
  const values = getSelectedValues();
  return values.find((el) => {
    const labelEl = el.querySelector('div[class*="-MultiValueGeneric"]');
    return labelEl?.textContent === text;
  });
};

export const getRemoveButton = (text: string) => {
  const valueElement = getSelectedValueElement(text);
  if (!valueElement) return null;
  return valueElement.querySelector(
    'div[class*="-MultiValueRemove"]'
  ) as HTMLElement;
};

export const expectMultiSelectToHaveOptionCount = (count: number) => {
  const options = getOptionElements();
  expect(options).toHaveLength(count);
};

export const expectSelectedValueCount = (count: number) => {
  const selectedValues = getSelectedValues();
  expect(selectedValues).toHaveLength(count);
};

export const expectValueToBeSelected = (text: string) => {
  const selectedElement = getSelectedValueElement(text);
  expect(selectedElement).toBeTruthy();
};

export const openDropdownMenu = async (user: any) => {
  const control = getReactSelectContainer();
  await user.click(control);
  const input = getSelectInput();
  input.focus();
  await user.keyboard('[ArrowDown]');
  await waitFor(() => {
    if (getOptionElements().length === 0) {
      throw new Error('Dropdown menu did not open');
    }
  });
};

export const selectOptionByText = async (user: any, text: string) => {
  const option = await waitFor(() => {
    const found = getOptionByText(text);
    if (!found) {
      throw new Error(`Option with text "${text}" not found`);
    }
    return found;
  });
  await user.click(option);
};

export const removeSelectedValue = async (user: any, text: string) => {
  const removeBtn = getRemoveButton(text);
  if (!removeBtn) throw new Error(`Remove button for "${text}" not found`);
  await user.click(removeBtn);
};
