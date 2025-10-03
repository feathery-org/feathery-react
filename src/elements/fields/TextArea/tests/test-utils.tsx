import {
  createStatefulTextOnChange,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveMaxLength,
  expectFieldToHaveMinLength,
  expectFieldToHaveAriaLabel,
  createBaseElement,
  createFieldProps
} from '../../shared/tests/field-test-utils';

export const createTextAreaElement = (
  type: string,
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-textarea',
    type,
    metadata,
    {
      placeholder: 'Enter text',
      aria_label: 'Test textarea field'
    },
    {
      num_rows: 4,
      ...styles
    }
  );

export const createTextAreaProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    onChange: jest.fn(),
    setRef: jest.fn(),
    rawValue: '',
    ...customProps
  });

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveMaxLength,
  expectFieldToHaveMinLength,
  expectFieldToHaveAriaLabel,
  createStatefulTextOnChange
};
