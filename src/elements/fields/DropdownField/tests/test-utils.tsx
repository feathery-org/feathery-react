import {
  createBaseElement,
  createFieldProps,
  createStatefulTextOnChange,
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

export const createDropdownElement = (
  type: string,
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-dropdown',
    type,
    metadata,
    {
      placeholder: 'Select an option',
      aria_label: 'Test dropdown field'
    },
    styles
  );

export const createDropdownProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: '',
    repeatIndex: null,
    countryCode: '',
    rightToLeft: false,
    onChange: jest.fn(),
    setRef: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLSelectElement>) => {
    setMockFieldValue(e.target.value);
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

export const getSelectElement = () => {
  const select = document.querySelector('select');
  if (!select) throw new Error('Select element not found');
  return select as HTMLSelectElement;
};

export const getOptionElements = () => {
  const select = getSelectElement();
  return Array.from(select.querySelectorAll('option'));
};

export const getOptionByValue = (value: string) => {
  const options = getOptionElements();
  return options.find((option) => option.value === value);
};

export const getOptionByText = (text: string) => {
  const options = getOptionElements();
  return options.find((option) => option.textContent === text);
};

export const expectOptionToHaveTooltip = (
  option: HTMLOptionElement,
  tooltip: string
) => {
  expect(option.getAttribute('title')).toBe(tooltip);
};

export const expectSelectToHaveValue = (value: string) => {
  const select = getSelectElement();
  expect(select.value).toBe(value);
};

export const expectSelectToHaveOptionCount = (count: number) => {
  const options = getOptionElements();
  expect(options).toHaveLength(count);
};
