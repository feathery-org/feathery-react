import React from 'react';
import {
  createBaseElement,
  createFieldProps,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
} from '../../shared/tests/field-test-utils';
import { fireEvent, waitFor } from '@testing-library/react';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
};

export const createColorPickerElement = (
  type: string = 'color_picker',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => {
  return createBaseElement(
    'test-color-picker',
    type,
    metadata,
    {
      aria_label: 'Test color picker field',
      ...properties
    },
    styles
  );
};

export const createColorPickerProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: 'FFFFFFFF',
    onChange: jest.fn(),
    disabled: false,
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((value: string) => {
    setMockFieldValue(value);
  });
};

export const getColorDisplay = async () => {
  return await waitFor(() => {
    const displays = Array.from(document.querySelectorAll('div')).filter(
      (div) => {
        const computedStyle = window.getComputedStyle(div);
        const inlineBackground =
          div.style.background || div.style.backgroundColor;

        const hasBackground =
          inlineBackground ||
          computedStyle.background ||
          computedStyle.backgroundColor;
        const hasPointerCursor = computedStyle.cursor === 'pointer';

        return hasBackground && hasPointerCursor;
      }
    );
    if (displays.length === 0) throw new Error('Color display not found');
    return displays[0] as HTMLElement;
  });
};

export const getColorPickerOverlay = () => {
  const sketches = Array.from(document.querySelectorAll('div')).filter(
    (div) => {
      return (
        div.getAttribute('class')?.includes('w-color-sketch') ||
        div.querySelector('[class*="w-color-sketch"]')
      );
    }
  );
  return sketches[0] as HTMLElement;
};

export const getColorPickerInput = () => {
  const inputs = Array.from(
    document.querySelectorAll('input[type="text"]')
  ) as HTMLInputElement[];
  const hexInput = inputs.find((input) => {
    const value = input.value;
    return value.startsWith('#') || input.placeholder?.includes('#');
  });
  return hexInput as HTMLInputElement;
};

export const clickColorDisplay = async () => {
  const display = await getColorDisplay();
  fireEvent.click(display);
};

export const changeColor = (hexColor: string) => {
  const input = getColorPickerInput();
  if (!input) throw new Error('Color picker input not found');

  fireEvent.change(input, { target: { value: hexColor } });
};

export const isPickerVisible = () => {
  return getColorPickerOverlay() !== null;
};

export const isColorDisplayDisabled = async () => {
  const display = await getColorDisplay();
  const parent = display.parentElement;
  if (!parent) return false;

  const style = window.getComputedStyle(parent);
  return style.pointerEvents === 'none';
};

export const expectColorValue = (expectedValue: string) => {
  const actualValue = getMockFieldValue();
  expect(actualValue).toBe(expectedValue);
};

export const getDisplayedColor = async () => {
  const display = await getColorDisplay();
  const computedStyle = window.getComputedStyle(display);
  return (
    display.style.background ||
    computedStyle.background ||
    computedStyle.backgroundColor
  );
};
