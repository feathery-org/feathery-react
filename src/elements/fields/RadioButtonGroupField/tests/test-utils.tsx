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

jest.mock('../../../components/FormControl', () => {
  const MockReact = require('react');
  return {
    FormControl: MockReact.forwardRef(function MockFormControl(
      props: any,
      ref: any
    ) {
      return MockReact.createElement('input', {
        ref,
        ...props,
        'data-testid': 'other-text-input'
      });
    })
  };
});

export const createRadioGroupElement = (
  type: string = 'select',
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-radio-group',
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
      aria_label: 'Test radio group field'
    },
    styles
  );

export const createRadioGroupProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: '',
    otherVal: '',
    onChange: jest.fn(),
    onOtherChange: jest.fn(),
    onEnter: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    const optionValue = e.target.value;
    setMockFieldValue(optionValue);
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

export const createOtherOptionElement = (
  options: string[] = ['Option 1', 'Option 2'],
  otherLabel = 'Other',
  otherTooltip = ''
) =>
  createRadioGroupElement('select', {
    ...createOptionsMetadata(options),
    other: true,
    other_label: otherLabel,
    other_tooltip: otherTooltip
  });

export const getRadioInputs = () => {
  return Array.from(
    document.querySelectorAll('input[type="radio"]:not([id$="-"])')
  ) as HTMLInputElement[];
};

export const getRadioInput = (index: number) => {
  const radios = getRadioInputs();
  return radios[index];
};

export const getRadioInputByValue = (value: string) => {
  return document.querySelector(`input[value="${value}"]`) as HTMLInputElement;
};

export const getOtherRadio = () => {
  return document.querySelector('input[id$="-"]') as HTMLInputElement;
};

export const getOtherTextInput = () => {
  return document.querySelector(
    '[data-testid="other-text-input"]'
  ) as HTMLInputElement;
};

export const getOptionLabels = () => {
  const radios = getRadioInputs();
  return radios.map((radio) => {
    const label = radio.closest('label')?.querySelector('span');
    return label?.textContent || '';
  });
};

export const getOptionLabel = (index: number) => {
  const labels = getOptionLabels();
  return labels[index];
};

export const getOptionTooltip = (value: string) => {
  const element = document.querySelector(
    `[data-testid="tooltip-test-radio-group-${value}"]`
  );
  return element?.getAttribute('title') || '';
};

export const getOtherTooltip = () => {
  const element = document.querySelector(
    '[data-testid="tooltip-test-radio-group-"]'
  );
  return element?.getAttribute('title') || '';
};

export const expectRadioToBeChecked = (value: string) => {
  const radio = getRadioInputByValue(value);
  expect(radio?.checked).toBe(true);
};

export const expectRadioToBeUnchecked = (value: string) => {
  const radio = getRadioInputByValue(value);
  expect(radio?.checked).toBe(false);
};

export const expectOtherRadioToBeChecked = () => {
  const radio = getOtherRadio();
  expect(radio?.checked).toBe(true);
};

export const expectOtherRadioToBeUnchecked = () => {
  const radio = getOtherRadio();
  expect(radio?.checked).toBe(false);
};

export const expectRadioGroupToHaveValue = (value: string) => {
  const currentValue = getMockFieldValue();
  expect(currentValue).toBe(value);
};

export const expectRadioGroupToHaveOptionCount = (count: number) => {
  const radios = getRadioInputs();
  expect(radios).toHaveLength(count);
};

export const expectRadioToBeDisabled = (value: string) => {
  const radio = getRadioInputByValue(value);
  expect(radio?.disabled).toBe(true);
};

export const expectRadioToBeEnabled = (value: string) => {
  const radio = getRadioInputByValue(value);
  expect(radio?.disabled).toBe(false);
};

export const expectOtherRadioToBeDisabled = () => {
  const radio = getOtherRadio();
  expect(radio?.disabled).toBe(true);
};

export const expectOtherRadioToBeEnabled = () => {
  const radio = getOtherRadio();
  expect(radio?.disabled).toBe(false);
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

export const expectRadiosToHaveCorrectNames = (expectedName: string) => {
  const allRadios = [...getRadioInputs(), getOtherRadio()].filter(Boolean);
  allRadios.forEach((radio) => {
    expect(radio.name).toBe(expectedName);
  });
};

export const expectOtherRadioToHaveValue = (value: string) => {
  const radio = getOtherRadio();
  expect(radio?.value).toBe(value);
};
