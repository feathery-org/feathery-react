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
import { fireEvent } from '@testing-library/react';

export {
  mockResponsiveStyles,
  setMockFieldValue,
  getMockFieldValue,
  resetMockFieldValue,
  expectFieldToBeDisabled,
  expectFieldToBeRequired,
  expectFieldToHaveAriaLabel
};

const mockLibphonenumber = {
  AsYouType: jest.fn(() => ({
    input: jest.fn((number) => {
      if (number.startsWith('+1')) {
        const digits = number.replace(/\D/g, '');
        if (digits.length >= 4) {
          return `+1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(
            7,
            11
          )}`.trim();
        }
        return number;
      }
      return number;
    }),
    getNumber: jest.fn(() => ({
      country: 'US',
      nationalNumber: '1234567890'
    }))
  })),
  parseDigits: jest.fn((number) => number.replace(/\D/g, '')),
  parsePhoneNumber: jest.fn((number, country) => ({
    formatInternational: jest.fn(() => '+1 555 123 4567'),
    isValid: jest.fn(() => true),
    country: country || 'US'
  })),
  isSupportedCountry: jest.fn(() => true),
  getExampleNumber: jest.fn(() => '+1 555 123 4567'),
  validatePhoneNumberLength: () => {
    return undefined; // always valid
  }
};

Object.defineProperty(global, 'libphonenumber', {
  value: mockLibphonenumber,
  writable: true
});

jest.mock('../../../../utils/validation', () => ({
  phoneLibPromise: Promise.resolve()
}));

Object.defineProperty(global.Intl, 'DateTimeFormat', {
  value: jest.fn(() => ({
    resolvedOptions: jest.fn(() => ({
      timeZone: 'America/New_York'
    }))
  })),
  writable: true
});

jest.mock('../../../components/data/countries', () => ({
  __esModule: true,
  default: [
    {
      countryCode: 'US',
      countryName: 'United States',
      phoneCode: '1',
      flag: '🇺🇸'
    },
    { countryCode: 'CA', countryName: 'Canada', phoneCode: '1', flag: '🇨🇦' },
    {
      countryCode: 'GB',
      countryName: 'United Kingdom',
      phoneCode: '44',
      flag: '🇬🇧'
    },
    { countryCode: 'FR', countryName: 'France', phoneCode: '33', flag: '🇫🇷' },
    { countryCode: 'DE', countryName: 'Germany', phoneCode: '49', flag: '🇩🇪' },
    { countryCode: 'IN', countryName: 'India', phoneCode: '91', flag: '🇮🇳' },
    { countryCode: 'SG', countryName: 'Singapore', phoneCode: '65', flag: '🇸🇬' }
  ],
  firebaseSMSCountries: ['US', 'CA', 'GB', 'FR', 'DE']
}));

const flagMap = {
  US: '🇺🇸',
  CA: '🇨🇦',
  GB: '🇬🇧',
  FR: '🇫🇷',
  DE: '🇩🇪',
  IN: '🇮🇳',
  SG: '🇸🇬'
};
jest.mock('../timeZoneCountries', () => ({
  'America/New_York': { c: ['US'] },
  'America/Toronto': { c: ['CA'] },
  'Europe/London': { c: ['GB'] },
  'Europe/Paris': { c: ['FR'] },
  'Europe/Berlin': { c: ['DE'] },
  'Asia/Kolkata': { c: ['IN'] },
  'Asia/Singapore': { c: ['SG'] }
}));

jest.mock('../exampleNumbers', () => ({
  US: '+15551234567',
  CA: '+15551234567',
  GB: '+447700123456',
  FR: '+33123456789',
  DE: '+491234567890',
  IN: '+919876543210',
  SG: '+6591234567'
}));

jest.mock('../../../components/Placeholder', () => {
  return function MockPlaceholder({ element, value, inputFocused }: any) {
    const placeholder = element?.properties?.placeholder;
    if (!placeholder || value || inputFocused) return null;
    return <span data-testid='placeholder'>{placeholder}</span>;
  };
});

jest.mock('../../../components/InlineTooltip', () => {
  return function MockInlineTooltip({ text, id }: any) {
    return (
      <span data-testid={`tooltip-${id}`} title={text || ''}>
        {text || ''}
      </span>
    );
  };
});

export const createPhoneElement = (
  type: string = 'phone',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-phone',
    type,
    {
      default_country: 'US',
      disable_other_countries: false,
      ...metadata
    },
    {
      aria_label: 'Test phone field',
      placeholder: '',
      ...properties
    },
    styles
  );

export const createPhoneProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    fullNumber: '',
    onComplete: jest.fn(),
    onEnter: jest.fn(),
    setRef: jest.fn(),
    autoComplete: 'tel',
    ...customProps
  });

export const createStatefulOnComplete = () => {
  return jest.fn((value: string) => {
    setMockFieldValue(value);
  });
};

export const createDefaultCountryMetadata = (country: string | 'auto') => ({
  default_country: country
});

export const createDisableOtherCountriesMetadata = (
  disabled: boolean = true
) => ({
  disable_other_countries: disabled
});

export const createUSPhoneElement = (metadata: any = {}) =>
  createPhoneElement('phone', { default_country: 'US', ...metadata });

export const createUKPhoneElement = (metadata: any = {}) =>
  createPhoneElement('phone', { default_country: 'GB', ...metadata });

export const createAutoCountryPhoneElement = (metadata: any = {}) =>
  createPhoneElement('phone', { default_country: 'auto', ...metadata });

export const createRestrictedPhoneElement = (metadata: any = {}) =>
  createPhoneElement('phone', { disable_other_countries: true, ...metadata });

export const getPhoneInput = () => {
  return (
    (document.querySelector('input[type="tel"]') as HTMLInputElement) ||
    (document.querySelector(
      'input[autocomplete*="tel"]'
    ) as HTMLInputElement) ||
    (document.querySelector('input') as HTMLInputElement)
  );
};

export const getCountryTrigger = () => {
  return document.querySelector('[data-testid="country-trigger"]');
};

export const getCountryDropdown = () => {
  return document.querySelector('[data-testid="country-dropdown"]');
};

export const getCountrySearchInput = () => {
  return document.querySelector(
    '[data-testid="country-search"]'
  ) as HTMLInputElement;
};

export const getCountryOption = (countryCode: string) => {
  return document.querySelector(
    `[data-testid="country-option-${countryCode}"]`
  );
};

export const getPlaceholder = () => {
  return document.querySelector('[data-testid="placeholder"]');
};

export const getTooltip = () => {
  return document.querySelector('[data-testid*="tooltip"]');
};

export const getOverlay = () => {
  return document.querySelector('[data-testid="overlay"]');
};

export const openCountryDropdown = async (user: any) => {
  const trigger = getCountryTrigger();
  expect(trigger).toBeTruthy();
  await user.click(trigger);
};

export const closeCountryDropdown = () => {
  fireEvent.click(document.body);
};

export const selectCountry = (countryCode: string) => {
  const option = getCountryOption(countryCode);
  expect(option).toBeTruthy();

  fireEvent.click(option!);
};

export const searchCountry = (query: string) => {
  const searchInput = getCountrySearchInput();
  expect(searchInput).toBeTruthy();

  fireEvent.change(searchInput, { target: { value: query } });
};

export const typePhoneNumber = (input: HTMLInputElement, value: string) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

export const typePartialPhoneNumber = (
  input: HTMLInputElement,
  value: string
) => {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
};

export const focusPhoneInput = (input: HTMLInputElement) => {
  fireEvent.focus(input);
};

export const blurPhoneInput = (input: HTMLInputElement) => {
  fireEvent.blur(input);
};

export const pressEnterKey = (input: HTMLInputElement) => {
  fireEvent.keyDown(input, { key: 'Enter' });
};

export const pressPlusKey = (input: HTMLInputElement) => {
  fireEvent.keyDown(input, { key: '+' });
};

export const expectPhoneInputToHaveValue = (expectedValue: string) => {
  const input = getPhoneInput();
  expect(input?.value).toBe(expectedValue);
};
export const expectPhoneInputToContain = (expectedValue: string) => {
  const input = getPhoneInput();
  expect(input?.value).toContain(expectedValue);
};

export const expectPhoneInputToHavePlaceholder = (
  expectedPlaceholder: string
) => {
  const input = getPhoneInput();
  expect(input?.placeholder).toBe(expectedPlaceholder);
};

export const expectPhoneInputToBeDisabled = () => {
  const input = getPhoneInput();
  expect(input?.disabled).toBe(true);
};

export const expectPhoneInputToBeEnabled = () => {
  const input = getPhoneInput();
  expect(input?.disabled).toBe(false);
};

export const expectCountryDropdownToBeOpen = () => {
  const dropdown = getCountryDropdown();
  expect(dropdown).toBeInTheDocument();
};

export const expectCountryDropdownToBeClosed = () => {
  const dropdown = getCountryDropdown();
  expect(dropdown).not.toBeInTheDocument();
};

export const expectCurrentCountryToBe = (
  countryCode: string,
  phoneCode: string
) => {
  const trigger = getCountryTrigger();
  const flag = flagMap[countryCode as keyof typeof flagMap];
  expect(trigger?.textContent).toContain(flag);
};

export const expectCountryOptionToBeAvailable = (countryCode: string) => {
  const option = getCountryOption(countryCode);
  expect(option).toBeInTheDocument();
};

export const expectCountryOptionToBeUnavailable = (countryCode: string) => {
  const option = getCountryOption(countryCode);
  expect(option).not.toBeInTheDocument();
};

export const expectCountryTriggerToBeDisabled = () => {
  const trigger = getCountryTrigger();
  expect(trigger).toBeTruthy();

  fireEvent.click(trigger!);

  expectCountryDropdownToBeClosed();
};

export const expectCountryTriggerToBeEnabled = () => {
  const trigger = getCountryTrigger();
  expect(trigger).toBeTruthy();

  fireEvent.click(trigger!);

  expectCountryDropdownToBeOpen();

  closeCountryDropdown();
};

export const expectPlaceholderToBeVisible = (expectedText: string) => {
  const placeholder = getPlaceholder();
  expect(placeholder).toBeInTheDocument();
  expect(placeholder?.textContent).toBe(expectedText);
};

export const expectPlaceholderToBeHidden = () => {
  const placeholder = getPlaceholder();
  expect(placeholder).not.toBeInTheDocument();
};

export const expectTooltipToHaveText = (expectedText: string) => {
  const tooltip = getTooltip();
  expect(tooltip?.getAttribute('title')).toBe(expectedText);
};

export const expectFieldToHaveValue = (expectedValue: string) => {
  const currentValue = getMockFieldValue();
  expect(currentValue).toBe(expectedValue);
};

export const expectPhoneNumberToBeFormatted = (
  input: HTMLInputElement,
  expectedFormat: string
) => {
  expect(input.value).toBe(expectedFormat);
};

export const expectPhoneNumberToBeValidLength = (
  phoneNumber: string,
  countryCode: string
) => {
  const { isValidPhoneLength } = require('../validation');
  expect(isValidPhoneLength(phoneNumber, countryCode)).toBe(true);
};

export const expectPhoneNumberToBeInvalidLength = (
  phoneNumber: string,
  countryCode: string
) => {
  const { isValidPhoneLength } = require('../validation');
  expect(isValidPhoneLength(phoneNumber, countryCode)).toBe(false);
};

export const mockTimezone = (timezone: string) => {
  Object.defineProperty(global.Intl, 'DateTimeFormat', {
    value: jest.fn(() => ({
      resolvedOptions: jest.fn(() => ({
        timeZone: timezone
      }))
    })),
    writable: true
  });
};

export const completePhoneEntry = async (
  user: any,
  fullNumber: string,
  countryCode?: string
) => {
  const input = getPhoneInput();

  if (countryCode) {
    openCountryDropdown(user);
    selectCountry(countryCode);
  }

  typePhoneNumber(input, fullNumber);
};

export const testAsYouTypeFormatting = (
  input: HTMLInputElement,
  digits: string[],
  expectedFormats: string[]
) => {
  expect(digits.length).toBe(expectedFormats.length);

  let currentValue = '';
  digits.forEach((digit, index) => {
    currentValue += digit;
    typePartialPhoneNumber(input, currentValue);
    expect(input.value).toBe(expectedFormats[index]);
  });
};
