import React from 'react';
import {
  createBaseElement,
  createFieldProps,
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
} from '../../shared/tests/field-test-utils';
import { fireEvent } from '@testing-library/react';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
};

jest.mock('../../../components/icons/RatingStar', () => {
  return function MockRatingStar({
    onClick,
    onMouseEnter,
    onMouseLeave,
    css,
    ...props
  }: any) {
    return (
      <div
        data-testid='rating-star'
        data-pointer-events={css?.pointerEvents || 'auto'}
        data-cursor={css?.cursor || 'pointer'}
        data-disabled={css?.pointerEvents === 'none' ? 'true' : 'false'}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...props}
      />
    );
  };
});

jest.mock('../../../components/icons/Heart', () => {
  return function MockHeart({
    onClick,
    onMouseEnter,
    onMouseLeave,
    css,
    ...props
  }: any) {
    return (
      <div
        data-testid='rating-heart'
        data-pointer-events={css?.pointerEvents || 'auto'}
        data-cursor={css?.cursor || 'pointer'}
        data-disabled={css?.pointerEvents === 'none' ? 'true' : 'false'}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        {...props}
      />
    );
  };
});

jest.mock('../../../components/ErrorInput', () => {
  return function MockErrorInput({ id, name, ...props }: any) {
    return (
      <input
        data-testid='error-input'
        id={id}
        name={name}
        type='hidden'
        {...props}
      />
    );
  };
});

export const createRatingElement = (
  type: string = 'rating',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => {
  const element = createBaseElement(
    'test-rating',
    type,
    metadata,
    {
      aria_label: 'Test rating field',
      ...properties
    },
    {
      icon_type: 'star',
      ...styles
    }
  );

  element.servar = {
    ...element.servar,
    max_length: metadata.scale ?? 5
  };

  return element;
};

export const createRatingProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fieldVal: undefined,
    onChange: jest.fn(),
    disabled: false,
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((value: number) => {
    setMockFieldValue(value);
  });
};

export const getRatingIcons = (iconType: 'star' | 'heart' = 'star') => {
  const testId = iconType === 'heart' ? 'rating-heart' : 'rating-star';
  return Array.from(
    document.querySelectorAll(`[data-testid="${testId}"]`)
  ) as HTMLElement[];
};

export const getRatingIcon = (
  index: number,
  iconType: 'star' | 'heart' = 'star'
) => {
  const icons = getRatingIcons(iconType);
  return icons[index - 1];
};

export const getRatingIconCount = (iconType: 'star' | 'heart' = 'star') => {
  return getRatingIcons(iconType).length;
};

export const clickRatingIcon = (
  index: number,
  iconType: 'star' | 'heart' = 'star'
) => {
  const icon = getRatingIcon(index, iconType);
  if (!icon) throw new Error(`Rating icon at index ${index} not found`);

  fireEvent.click(icon);
};

export const hoverRatingIcon = (
  index: number,
  iconType: 'star' | 'heart' = 'star'
) => {
  const icon = getRatingIcon(index, iconType);
  if (!icon) throw new Error(`Rating icon at index ${index} not found`);

  fireEvent.mouseEnter(icon);
};

export const unhoverRatingIcon = (
  index: number,
  iconType: 'star' | 'heart' = 'star'
) => {
  const icon = getRatingIcon(index, iconType);
  if (!icon) throw new Error(`Rating icon at index ${index} not found`);

  fireEvent.mouseLeave(icon);
};

export const areRatingIconsDisabled = (iconType: 'star' | 'heart' = 'star') => {
  const icons = getRatingIcons(iconType);
  return icons.every((icon) => {
    return icon.getAttribute('data-disabled') === 'true';
  });
};

export const areRatingIconsEnabled = (iconType: 'star' | 'heart' = 'star') => {
  const icons = getRatingIcons(iconType);
  return icons.every((icon) => {
    const pointerEvents = icon.getAttribute('data-pointer-events');
    return pointerEvents === 'auto' || pointerEvents === '';
  });
};

export const expectRatingIconCount = (
  expectedCount: number,
  iconType: 'star' | 'heart' = 'star'
) => {
  const count = getRatingIconCount(iconType);
  expect(count).toBe(expectedCount);
};

export const expectRatingValue = (expectedValue: number) => {
  const actualValue = getMockFieldValue();
  expect(actualValue).toBe(expectedValue);
};
