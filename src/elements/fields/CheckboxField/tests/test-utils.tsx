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

export const createCheckboxElement = (
  type: string = 'checkbox',
  metadata: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-checkbox',
    type,
    metadata,
    {
      aria_label: 'Test checkbox field'
    },
    styles
  );

export const createCheckboxProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: false,
    onChange: jest.fn(),
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    setMockFieldValue(e.target.checked);
  });
};

export const getCheckboxElement = () => {
  const checkbox = document.querySelector('input[type="checkbox"]');
  if (!checkbox) throw new Error('Checkbox element not found');
  return checkbox as HTMLInputElement;
};

export const getCheckboxContainer = () => {
  const container = document.querySelector('div');
  if (!container) throw new Error('Checkbox container not found');
  return container as HTMLElement;
};

export const expectCheckboxToBeChecked = (checkbox?: HTMLInputElement) => {
  const element = checkbox || getCheckboxElement();
  expect(element.checked).toBe(true);
};

export const expectCheckboxToBeUnchecked = (checkbox?: HTMLInputElement) => {
  const element = checkbox || getCheckboxElement();
  expect(element.checked).toBe(false);
};

export const expectCheckboxToHaveValue = (value: boolean) => {
  const checkbox = getCheckboxElement();
  expect(checkbox.checked).toBe(value);
};

export const expectCheckboxToHaveId = (id: string) => {
  const checkbox = getCheckboxElement();
  expect(checkbox.getAttribute('id')).toBe(id);
};

export const expectCheckboxToHaveName = (name: string) => {
  const checkbox = getCheckboxElement();
  expect(checkbox.getAttribute('name')).toBe(name);
};
