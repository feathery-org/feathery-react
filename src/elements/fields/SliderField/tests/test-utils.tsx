import {
  createBaseElement,
  createFieldProps,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
} from '../../shared/tests/field-test-utils';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
};

export const createSliderElement = (
  type: string = 'slider',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => {
  const element = createBaseElement(
    'test-slider',
    type,
    {
      min_val_label: metadata.min_val_label || undefined,
      max_val_label: metadata.max_val_label || undefined,
      step_size: metadata.step_size || 1,
      ...metadata
    },
    {
      aria_label: 'Test slider field',
      ...properties
    },
    styles
  );

  // Override servar with slider-specific fields
  element.servar = {
    ...element.servar,
    min_length: metadata.min_value ?? 0,
    max_length: metadata.max_value ?? 100,
    metadata: {
      min_val_label: metadata.min_val_label || undefined,
      max_val_label: metadata.max_val_label || undefined,
      step_size: metadata.step_size || 1
    }
  };

  return element;
};

export const createSliderProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: 0,
    onChange: jest.fn(),
    rightToLeft: false,
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((value: number) => {
    setMockFieldValue(value);
  });
};

export const getSliderHandle = () => {
  return document.querySelector('.rc-slider-handle') as HTMLElement;
};

export const getSliderRail = () => {
  return document.querySelector('.rc-slider-rail') as HTMLElement;
};

export const getSliderTrack = () => {
  return document.querySelector('.rc-slider-track') as HTMLElement;
};

export const getSliderContainer = () => {
  return document.querySelector('.rc-slider') as HTMLElement;
};

export const getMinLabel = () => {
  const labels = document.querySelectorAll('span');
  return labels[0]?.textContent || '';
};

export const getMaxLabel = () => {
  const labels = document.querySelectorAll('span');
  return labels[labels.length - 1]?.textContent || '';
};

export const getCurrentValueDisplay = () => {
  const currentValue = document.querySelector('.current-value');
  return currentValue?.textContent || '';
};

export const expectSliderToHaveMin = (expectedMin: number) => {
  const handle = getSliderHandle();
  expect(handle?.getAttribute('aria-valuemin')).toBe(expectedMin.toString());
};

export const expectSliderToHaveMax = (expectedMax: number) => {
  const handle = getSliderHandle();
  expect(handle?.getAttribute('aria-valuemax')).toBe(expectedMax.toString());
};

export const expectSliderToHaveValue = (expectedValue: number) => {
  const handle = getSliderHandle();
  expect(handle?.getAttribute('aria-valuenow')).toBe(expectedValue.toString());
};
