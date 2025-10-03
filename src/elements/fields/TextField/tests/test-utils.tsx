import {
  createStatefulAcceptHandler,
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

export const createTextFieldElement = (
  type: string,
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-textfield',
    type,
    metadata,
    {
      placeholder: 'Enter text',
      aria_label: 'Test field'
    },
    styles
  );

export const createTextFieldProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    autoComplete: true,
    onAccept: jest.fn(),
    onEnter: jest.fn(),
    setRef: jest.fn(),
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
  createStatefulAcceptHandler
};
