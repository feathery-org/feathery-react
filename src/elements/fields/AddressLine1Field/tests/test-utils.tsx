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
import userEvent from '@testing-library/user-event';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue
};

jest.mock('../../../components/Placeholder', () => {
  return function MockPlaceholder({ value, element, ...props }: any) {
    if (!value && element.properties.placeholder) {
      return (
        <div data-testid='placeholder'>{element.properties.placeholder}</div>
      );
    }
    return null;
  };
});

jest.mock('../../../components/InlineTooltip', () => {
  return function MockInlineTooltip({ text, ...props }: any) {
    if (text) {
      return <div data-testid='inline-tooltip'>{text}</div>;
    }
    return null;
  };
});

jest.mock('../../../../hooks/useMounted', () => {
  return jest.fn(() => ({ current: true }));
});

export const createAddressLine1Element = (
  type: string = 'gmap_line_1',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) => {
  return createBaseElement(
    'test-address-line-1',
    type,
    {
      address_autocomplete: false,
      autocomplete_country: '',
      save_address: 'components',
      ...metadata
    },
    {
      aria_label: 'Test address field',
      placeholder: 'Enter address',
      ...properties
    },
    styles
  );
};

export const createAddressLine1Props = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    value: '',
    onChange: jest.fn(),
    onSelect: jest.fn(),
    onBlur: jest.fn(),
    onEnter: jest.fn(),
    setRef: jest.fn(),
    autoComplete: 'off',
    disabled: false,
    ...customProps
  });

export const createStatefulOnChange = () => {
  return jest.fn((e: React.ChangeEvent<HTMLInputElement>) => {
    const fullValue = e.target.value;
    setMockFieldValue(fullValue);
  });
};

export const AddressWrapper = ({ element, ...initialProps }: any) => {
  const [value, setValue] = React.useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    setMockFieldValue(newValue);
    if (initialProps.onChange) {
      initialProps.onChange(e);
    }
  };

  const props = {
    ...createAddressLine1Props(element),
    ...initialProps,
    value,
    onChange: handleChange
  };

  return React.createElement(require('..').default, props);
};

export const getAddressInput = () => {
  return document.querySelector('input') as HTMLInputElement;
};

export const getDropdownOverlay = () => {
  return document.querySelector('[data-testid="overlay"]') as HTMLElement;
};

export const getDropdownOptions = () => {
  const overlay = getDropdownOverlay();
  if (!overlay) return [];
  return Array.from(overlay.querySelectorAll('li')) as HTMLElement[];
};

export const typeInAddressInput = async (value: string) => {
  const input = getAddressInput();
  if (!input) throw new Error('Address input not found');

  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });

  // Fire a keyDown event to trigger the component's keyDown handler
  const user = userEvent.setup();
  await user.type(input, '{Shift}');
};

export const focusAddressInput = async () => {
  const input = getAddressInput();
  if (!input) throw new Error('Address input not found');

  fireEvent.focus(input);
};

export const blurAddressInput = async () => {
  const input = getAddressInput();
  if (!input) throw new Error('Address input not found');

  fireEvent.blur(input);
};

export const pressEnterOnInput = async () => {
  const input = getAddressInput();
  if (!input) throw new Error('Address input not found');

  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isTrusted: true });
};

export const pressEscapeOnInput = async () => {
  const input = getAddressInput();
  if (!input) throw new Error('Address input not found');

  fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', isTrusted: true });
};

export const clickDropdownOption = async (index: number) => {
  const options = getDropdownOptions();
  if (!options[index])
    throw new Error(`Dropdown option at index ${index} not found`);

  fireEvent.click(options[index]);
};

export const isDropdownVisible = () => {
  return getDropdownOverlay() !== null;
};

export const isAddressInputDisabled = () => {
  const input = getAddressInput();
  return input?.disabled ?? false;
};

export const getInputMaxLength = () => {
  const input = getAddressInput();
  const maxLength = input?.getAttribute('maxLength');
  return maxLength ? parseInt(maxLength, 10) : null;
};

export const getInputMinLength = () => {
  const input = getAddressInput();
  const minLength = input?.getAttribute('minLength');
  return minLength ? parseInt(minLength, 10) : null;
};

export const expectAddressValue = (expectedValue: string) => {
  const actualValue = getMockFieldValue();
  expect(actualValue).toBe(expectedValue);
};

export const createMockAddressSearchResult = (
  display: string,
  addressId: string
) => ({
  display,
  address_id: addressId
});

export const createMockAddressDetail = (overrides: any = {}) => ({
  formatted_address: '123 Main St, New York, NY 10001, USA',
  gmap_line_1: '123 Main St',
  gmap_line_2: '',
  gmap_city: 'New York',
  gmap_state: 'New York',
  gmap_state_short: 'NY',
  gmap_zip: '10001',
  gmap_country: 'US',
  ...overrides
});

export const waitForDebounce = (ms: number = 600) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
