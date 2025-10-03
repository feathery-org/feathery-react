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

jest.mock('../../../components/InlineTooltip', () => {
  return function MockInlineTooltip({ text, id }: any) {
    return (
      <span data-testid={`tooltip-${id}`} title={text || ''}>
        {text || ''}
      </span>
    );
  };
});

export const createCheckboxGroupElement = (
  type: string = 'checkbox_group',
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-checkbox-group',
    type,
    {
      options: ['Option 1', 'Option 2', 'Option 3'],
      option_labels: [],
      option_tooltips: [],
      other: false,
      other_label: 'Other',
      other_tooltip: '',
      ...metadata
    },
    {
      aria_label: 'Test checkbox group field'
    },
    styles
  );
export const createCheckboxGroupProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: [],
    otherVal: '',
    onChange: jest.fn(),
    onOtherChange: jest.fn(),
    onEnter: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    const currentValue = getMockFieldValue() || [];
    const optionValue = e.target.name;
    const isChecked = e.target.checked;

    let newValue;
    if (isChecked) {
      newValue = [...currentValue, optionValue];
    } else {
      newValue = currentValue.filter((val: string) => val !== optionValue);
    }

    setMockFieldValue(newValue);
  });
};

export const createStatefulOtherOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    const newOtherValue = e.target.value;
    setMockFieldValue({ other: newOtherValue });
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
  createCheckboxGroupElement('checkbox_group', {
    ...createOptionsMetadata(options),
    max_length: maxLength
  });

export const createOtherOptionElement = (
  options: string[] = ['Option 1', 'Option 2'],
  otherLabel = 'Other',
  otherTooltip = ''
) =>
  createCheckboxGroupElement('checkbox_group', {
    ...createOptionsMetadata(options),
    other: true,
    other_label: otherLabel,
    other_tooltip: otherTooltip
  });

export const getCheckboxInputs = () => {
  return Array.from(
    document.querySelectorAll('input[type="checkbox"]:not([id$="-"])')
  ) as HTMLInputElement[];
};

export const getCheckboxInput = (index: number) => {
  const checkboxes = getCheckboxInputs();
  return checkboxes[index];
};

export const getCheckboxInputByValue = (value: string) => {
  return document.querySelector(`input[name="${value}"]`) as HTMLInputElement;
};

export const getOtherCheckbox = () => {
  return document.querySelector('input[id$="-"]') as HTMLInputElement;
};

export const getOtherTextInput = () => {
  // The "other" text input has id={servar.key} which is "test-checkbox-group-key"
  // and type="text", and is a sibling of the "other" checkbox
  const otherCheckbox = getOtherCheckbox();
  if (!otherCheckbox) return null;

  // Find the text input that's a sibling of the checkbox (within the same parent div)
  const container = otherCheckbox.parentElement;
  return container?.querySelector('input[type="text"]') as HTMLInputElement;
};

export const getOptionLabels = () => {
  const checkboxes = getCheckboxInputs();
  return checkboxes.map((checkbox) => {
    const label = checkbox.closest('label')?.querySelector('span');
    return label?.textContent || '';
  });
};

export const getOptionLabel = (index: number) => {
  const labels = getOptionLabels();
  return labels[index];
};

export const getOptionTooltip = (value: string) => {
  const element = document.querySelector(
    `[data-testid="tooltip-test-checkbox-group-${value}"]`
  );
  return element?.getAttribute('title') || '';
};

export const getOtherTooltip = () => {
  const element = document.querySelector(
    '[data-testid="tooltip-test-checkbox-group-"]'
  );
  return element?.getAttribute('title') || '';
};

export const expectCheckboxToBeChecked = (value: string) => {
  const checkbox = getCheckboxInputByValue(value);
  expect(checkbox?.checked).toBe(true);
};

export const expectCheckboxToBeUnchecked = (value: string) => {
  const checkbox = getCheckboxInputByValue(value);
  expect(checkbox?.checked).toBe(false);
};

export const expectOtherCheckboxToBeChecked = () => {
  const checkbox = getOtherCheckbox();
  expect(checkbox?.checked).toBe(true);
};

export const expectOtherCheckboxToBeUnchecked = () => {
  const checkbox = getOtherCheckbox();
  expect(checkbox?.checked).toBe(false);
};

export const expectCheckboxGroupToHaveValues = (values: string[]) => {
  const currentValue = getMockFieldValue() || [];
  expect(currentValue.sort()).toEqual(values.sort());
};

export const expectCheckboxGroupToHaveOptionCount = (count: number) => {
  const checkboxes = getCheckboxInputs();
  expect(checkboxes).toHaveLength(count);
};

export const expectCheckboxToBeDisabled = (value: string) => {
  const checkbox = getCheckboxInputByValue(value);
  expect(checkbox?.disabled).toBe(true);
};

export const expectCheckboxToBeEnabled = (value: string) => {
  const checkbox = getCheckboxInputByValue(value);
  expect(checkbox?.disabled).toBe(false);
};

export const expectOtherCheckboxToBeDisabled = () => {
  const checkbox = getOtherCheckbox();
  expect(checkbox?.disabled).toBe(true);
};

export const expectOtherCheckboxToBeEnabled = () => {
  const checkbox = getOtherCheckbox();
  expect(checkbox?.disabled).toBe(false);
};

export const expectOtherTextInputToBeDisabled = () => {
  const textInput = getOtherTextInput();
  expect(textInput?.disabled).toBe(true);
};

export const expectOtherTextInputToBeEnabled = () => {
  const textInput = getOtherTextInput();
  expect(textInput?.disabled).toBe(false);
};

export const expectOtherTextInputToHaveValue = (value: string) => {
  const textInput = getOtherTextInput();
  expect(textInput?.value).toBe(value);
};

export const expectOptionToHaveTooltip = (value: string, tooltip: string) => {
  const actualTooltip = getOptionTooltip(value);
  expect(actualTooltip).toBe(tooltip);
};

export const expectOtherToHaveTooltip = (tooltip: string) => {
  const actualTooltip = getOtherTooltip();
  expect(actualTooltip).toBe(tooltip);
};
