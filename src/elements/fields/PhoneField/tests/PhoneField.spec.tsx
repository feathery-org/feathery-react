jest.mock('../../../../utils/validation', () => {
  const lib = {
    AsYouType: jest.fn(() => ({
      input: jest.fn((number: string) => {
        if (number.startsWith('+1')) {
          const digits = number.replace(/\D/g, '');
          if (digits.length >= 4) {
            return `+1 ${digits.slice(1, 4)} ${digits.slice(
              4,
              7
            )} ${digits.slice(7, 11)}`.trim();
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
    parseDigits: jest.fn((number: string) => number.replace(/\D/g, '')),
    parsePhoneNumber: jest.fn((number: string, country: string) => ({
      formatInternational: jest.fn(() => '+1 555 123 4567'),
      isValid: jest.fn(() => true),
      country: country || 'US'
    })),
    isSupportedCountry: jest.fn(() => true),
    getExampleNumber: jest.fn(() => '+1 555 123 4567'),
    validatePhoneNumberLength: () => undefined
  };
  return {
    phoneLibPromise: Promise.resolve(lib),
    phoneLib: lib
  };
});

// Shared browser mocks (matchMedia included) are defined in test-utils
jest.mock('../../../../utils/browser', () => ({
  runningInClient: jest.fn(() => true),
  featheryDoc: jest.fn(() => global.document),
  featheryWindow: jest.fn(() => global.window),
  isHoverDevice: jest.fn(() => false),
  isTouchDevice: jest.fn(() => false),
  isIOS: jest.fn(() => false),
  hoverStylesGuard: jest.fn((styles) => styles),
  iosScrollOnFocus: jest.fn(),
  downloadFile: jest.fn()
}));

jest.mock('../../../components/Overlay', () => {
  return function MockOverlay({ show, children }: any) {
    if (!show) return null;
    return <div data-testid='overlay'>{children}</div>;
  };
});

jest.mock('../CountryDropdown', () => {
  const MockReact = require('react');
  return MockReact.forwardRef(function MockCountryDropdown(
    { show, itemOnClick }: any,
    ref: any
  ) {
    if (!show) return null;

    const countries = [
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
      { countryCode: 'DE', countryName: 'Germany', phoneCode: '49', flag: '🇩🇪' }
    ];

    return MockReact.createElement(
      'div',
      { ref, 'data-testid': 'country-dropdown' },
      [
        MockReact.createElement('input', {
          key: 'search',
          'data-testid': 'country-search',
          placeholder: 'Search countries...'
        }),
        ...countries.map((country) =>
          MockReact.createElement(
            'div',
            {
              key: country.countryCode,
              'data-testid': `country-option-${country.countryCode}`,
              onClick: () => itemOnClick(country.countryCode, country.phoneCode)
            },
            `${country.flag} ${country.countryName} (+${country.phoneCode})`
          )
        )
      ]
    );
  });
});

import React from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhoneField from '../index';
import {
  createPhoneElement,
  createPhoneProps,
  createStatefulOnComplete,
  resetMockFieldValue,
  createUSPhoneElement,
  createUKPhoneElement,
  getPhoneInput,
  getCountryTrigger,
  openCountryDropdown,
  selectCountry,
  typePhoneNumber,
  typePartialPhoneNumber,
  expectCountryDropdownToBeOpen,
  expectCountryDropdownToBeClosed,
  expectCurrentCountryToBe,
  expectCountryOptionToBeAvailable,
  expectFieldToHaveValue,
  expectPhoneNumberToBeFormatted,
  mockTimezone,
  expectPhoneInputToHaveValue
} from './test-utils';

describe('PhoneField Component', () => {
  beforeEach(() => {
    resetMockFieldValue();
    jest.clearAllMocks();
    // Reset to default US timezone
    mockTimezone('America/New_York');
  });

  describe('Basic Rendering', () => {
    it('renders phone field with default props', () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);

      const { container } = render(<PhoneField {...props} />);

      expect(container.firstChild).toBeInTheDocument();
      const input = getPhoneInput();
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'tel');
    });

    it('renders country trigger for country selection', () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);

      render(<PhoneField {...props} />);

      const trigger = getCountryTrigger();
      expect(trigger).toBeInTheDocument();
    });
  });

  describe('Default Country', () => {
    it('uses US as default country when not specified', () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);

      render(<PhoneField {...props} />);

      expectCurrentCountryToBe('US', '1');
    });

    it('uses specified default country', () => {
      const element = createUKPhoneElement();
      const props = createPhoneProps(element);

      render(<PhoneField {...props} />);

      expectCurrentCountryToBe('GB', '44');
    });
  });

  describe('Change Country', () => {
    it('opens country dropdown when trigger is clicked', async () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      const user = userEvent.setup();
      render(<PhoneField {...props} />);

      expectCountryDropdownToBeClosed();
      await openCountryDropdown(user);
      expectCountryDropdownToBeOpen();
    });

    it('displays available countries in dropdown', async () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      const user = userEvent.setup();
      render(<PhoneField {...props} />);

      await openCountryDropdown(user);

      expectCountryOptionToBeAvailable('US');
      expectCountryOptionToBeAvailable('CA');
      expectCountryOptionToBeAvailable('GB');
      expectCountryOptionToBeAvailable('FR');
      expectCountryOptionToBeAvailable('DE');
    });

    it('allows selecting different country from dropdown', async () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      const user = userEvent.setup();
      render(<PhoneField {...props} />);

      expectCurrentCountryToBe('US', '1');

      await openCountryDropdown(user);
      selectCountry('GB');

      expectCurrentCountryToBe('GB', '44');
      expectCountryDropdownToBeClosed();
    });
  });

  describe('onChange with As You Type Formatting', () => {
    it('calls onComplete when phone number is entered', () => {
      const element = createPhoneElement();
      const onComplete = createStatefulOnComplete();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      typePhoneNumber(input, '+15551234567');

      expect(onComplete).toHaveBeenCalledWith('15551234567');
      expectFieldToHaveValue('15551234567');
    });

    it('formats US phone number as user types', () => {
      const element = createUSPhoneElement();
      const props = createPhoneProps(element);

      render(<PhoneField {...props} />);

      const input = getPhoneInput();

      // Test progressive formatting
      typePartialPhoneNumber(input, '+1555');
      expectPhoneNumberToBeFormatted(input, '+1 555');

      typePartialPhoneNumber(input, '+1555123');
      expectPhoneNumberToBeFormatted(input, '+1 555 123');

      typePartialPhoneNumber(input, '+15551234567');
      expectPhoneNumberToBeFormatted(input, '+1 555 123 4567');
    });

    it('updates field value as user types', () => {
      const element = createPhoneElement();
      const onComplete = createStatefulOnComplete();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);

      const input = getPhoneInput();

      // Partial typing shouldn't trigger onComplete yet
      typePartialPhoneNumber(input, '+1555');
      expect(onComplete).not.toHaveBeenCalled();

      // Complete the number
      typePhoneNumber(input, '+15551234567');
      expect(onComplete).toHaveBeenCalledWith('15551234567');
    });
  });

  describe('Disabled State', () => {
    it('disables phone input when field is disabled', async () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element, { disabled: true });

      render(<PhoneField {...props} />);

      const input = getPhoneInput();

      const user = userEvent.setup();
      await user.click(input);
      await user.type(input, '555');

      expectPhoneInputToHaveValue('');
    });

    it('disables country selection when field is disabled', async () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element, { disabled: true });

      render(<PhoneField {...props} />);

      const trigger = getCountryTrigger();
      const user = userEvent.setup();
      await user.click(trigger!);
      expectCountryDropdownToBeClosed();
    });
  });
});
