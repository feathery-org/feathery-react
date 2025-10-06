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
  expectFieldToHaveAriaLabel,
  expectFieldToHaveMaxLength,
  expectFieldToHaveMinLength
} from '../../shared/tests/field-test-utils';
import { fireEvent } from '@testing-library/react';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel,
  expectFieldToHaveMaxLength,
  expectFieldToHaveMinLength
};

export const createPasswordElement = (
  type: string = 'password',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => {
  const element = createBaseElement(
    'test-password',
    type,
    metadata,
    {
      aria_label: 'Test password field',
      ...properties
    },
    styles
  );

  return element;
};

export const createPasswordProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    rawValue: '',
    onChange: jest.fn(),
    onEnter: jest.fn(),
    setRef: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    setMockFieldValue(e.target.value);
  });
};

export const getPasswordInput = () => {
  return document.querySelector(
    'input[type="password"], input[type="text"]'
  ) as HTMLInputElement;
};

export const hasEyeIcon = () => {
  return (
    document.querySelector('[aria-label="Toggle password visibility"]') !== null
  );
};

export const clickEyeIcon = () => {
  const eyeIcon = document.querySelector(
    '[aria-label="Toggle password visibility"]'
  ) as HTMLElement;
  if (eyeIcon) {
    fireEvent.click(eyeIcon);
  }
};

export const isPasswordVisible = () => {
  const input = getPasswordInput();
  return input?.type === 'text';
};

export const isPasswordHidden = () => {
  const input = getPasswordInput();
  return input?.type === 'password';
};

export const hasAtLeastOneLetter = (password: string): boolean => {
  return /[a-zA-Z]/.test(password);
};

export const hasAtLeastOneUppercase = (password: string): boolean => {
  return /[A-Z]/.test(password);
};

export const hasAtLeastOneLowercase = (password: string): boolean => {
  return /[a-z]/.test(password);
};

export const hasAtLeastOneNumber = (password: string): boolean => {
  return /[0-9]/.test(password);
};

export const hasAtLeastOneSymbol = (password: string): boolean => {
  return /[^a-zA-Z0-9]/.test(password);
};

export const validatePasswordConstraints = (
  password: string,
  constraints: {
    hasLetter?: boolean;
    hasUppercase?: boolean;
    hasLowercase?: boolean;
    hasNumber?: boolean;
    hasSymbol?: boolean;
  }
): boolean => {
  if (constraints.hasLetter && !hasAtLeastOneLetter(password)) return false;
  if (constraints.hasUppercase && !hasAtLeastOneUppercase(password))
    return false;
  if (constraints.hasLowercase && !hasAtLeastOneLowercase(password))
    return false;
  if (constraints.hasNumber && !hasAtLeastOneNumber(password)) return false;
  if (constraints.hasSymbol && !hasAtLeastOneSymbol(password)) return false;
  return true;
};
