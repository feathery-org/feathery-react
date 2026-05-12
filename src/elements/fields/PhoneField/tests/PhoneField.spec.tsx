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
import { render, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PhoneField from '../index';
import * as validation from '../../../../utils/validation';
import {
  createPhoneElement,
  createPhoneProps,
  createStatefulOnComplete,
  resetMockFieldValue,
  createUSPhoneElement,
  createUKPhoneElement,
  createRestrictedPhoneElement,
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
  beforeAll(async () => {
    // Await the lazy-loaded libphonenumber-js
    validation.loadPhoneValidator();
    await validation.phoneLibPromise;
  });

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

  describe('Cursor placement after focus', () => {
    it('positions cursor after phone code on focus so first digit is not dropped', () => {
      // Regression: resetToPhoneCode was setting cursor state but not toggling
      // cursorChange, so the setSelectionRange effect never fired. Cursor stayed
      // at 0 (before +), causing the onChange guard to drop the first keystroke.
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      const setSelectionRangeSpy = jest.spyOn(input, 'setSelectionRange');

      act(() => {
        fireEvent.focus(input);
      });

      // Cursor should be placed after "+1" (position 2)
      expect(setSelectionRangeSpy).toHaveBeenCalledWith(2, 2);
    });

    it('positions cursor after phone code when country is changed via dropdown', () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      const setSelectionRangeSpy = jest.spyOn(input, 'setSelectionRange');

      // Select UK (phone code "44", length=2, not > 3 → delta=1, cursor = 2 + 1 = 3)
      act(() => {
        fireEvent.click(
          document.querySelector('[data-testid="country-trigger"]')!
        );
      });
      act(() => {
        fireEvent.click(
          document.querySelector('[data-testid="country-option-GB"]')!
        );
      });

      expect(setSelectionRangeSpy).toHaveBeenCalledWith(3, 3);
    });

    it('keeps cursor after phone code when clicking before plus sign', () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      render(<PhoneField {...props} />);

      const input = getPhoneInput();

      act(() => {
        fireEvent.focus(input);
      });
      input.setSelectionRange(0, 0);
      const setSelectionRangeSpy = jest.spyOn(input, 'setSelectionRange');
      act(() => {
        fireEvent.click(input);
      });

      expect(setSelectionRangeSpy).toHaveBeenCalledWith(2, 2);
      expect(input.selectionStart).toBe(2);
    });

    it('moves cursor to the end on refocus when a partial number already exists', () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      act(() => {
        fireEvent.focus(input);
      });
      typePartialPhoneNumber(input, '+1555');
      act(() => {
        fireEvent.blur(input);
      });

      input.setSelectionRange(0, 0);
      const setSelectionRangeSpy = jest.spyOn(input, 'setSelectionRange');
      act(() => {
        fireEvent.focus(input);
        fireEvent.click(input);
      });

      const end = input.value.length;
      expect(setSelectionRangeSpy).toHaveBeenCalledWith(end, end);
      expect(input.selectionStart).toBe(end);
    });

    it('keeps subsequent typing at the clicked cursor position', async () => {
      const element = createPhoneElement();
      const props = createPhoneProps(element);
      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      const user = userEvent.setup();

      await user.click(input);
      await user.type(input, '647');

      act(() => {
        input.setSelectionRange(3, 3);
        fireEvent.click(input);
      });

      await user.keyboard('5');
      await user.keyboard('8');

      expect(input.value.replace(/\D/g, '')).toBe('158647');
    });
  });

  describe('Auto-prepend country code', () => {
    it('prepends default country code when fullNumber is missing it', async () => {
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, {
        fullNumber: '5551234567',
        onComplete
      });

      await act(async () => {
        render(<PhoneField {...props} />);
        await Promise.resolve();
      });

      expect(onComplete).toHaveBeenCalledWith('15551234567');
    });

    it('leaves fullNumber alone when it already includes a valid country code', async () => {
      // Digits-only valid international: resolver detects GB, but doesn't
      // change the digits, so onComplete should not fire.
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, {
        fullNumber: '442079460958',
        onComplete
      });

      await act(async () => {
        render(<PhoneField {...props} />);
        await Promise.resolve();
      });

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not modify fullNumber when bare digits are not a valid national length', async () => {
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, {
        fullNumber: '555',
        onComplete
      });

      await act(async () => {
        render(<PhoneField {...props} />);
        await Promise.resolve();
      });

      expect(onComplete).not.toHaveBeenCalled();
    });

    it('updates selected country to match the value when normalization is skipped', async () => {
      // GB number loaded into a US-default field: the value is valid as-is so
      // we don't normalize, but the selected country must follow the +44
      // prefix or the input becomes uneditable (the onChange guard rejects
      // edits that don't start with the active country's phoneCode).
      const element = createUSPhoneElement();
      const props = createPhoneProps(element, {
        fullNumber: '+442079460958'
      });

      await act(async () => {
        render(<PhoneField {...props} />);
        await Promise.resolve();
      });

      expectCurrentCountryToBe('GB', '44');
    });
  });

  describe('Copy/Paste & Autofill', () => {
    const pasteIntoPhoneInput = async (
      input: HTMLInputElement,
      value: string
    ) => {
      const pasteEvent = new Event('paste', {
        bubbles: true,
        cancelable: true
      });
      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: { getData: () => value }
      });

      await act(async () => {
        input.dispatchEvent(pasteEvent);
        await Promise.resolve();
      });

      return pasteEvent;
    };

    it('strips formatting when a formatted number is pasted', () => {
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      // Simulate paste of a fully-formatted US number
      fireEvent.change(input, { target: { value: '+1 (415) 555-2671' } });

      expect(input.value.replace(/\D/g, '')).toBe('14155552671');
    });

    it('auto-prepends country code when pasted number has no "+"', () => {
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      // iPhone autofill / "type-then-paste" sometimes drops the leading +
      fireEvent.change(input, { target: { value: '4155552671' } });

      expect(input.value.replace(/\D/g, '')).toBe('14155552671');
    });

    it('handles multi-"+" paste from autofill quirks', () => {
      const element = createUSPhoneElement();
      const props = createPhoneProps(element);

      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      // Some autofill flows insert a stray + before the country-coded value.
      fireEvent.change(input, { target: { value: '+1++14155552671' } });

      // Everything before the last + is discarded; final value should
      // contain a single +1 prefix.
      expect(input.value.startsWith('+1')).toBe(true);
      expect((input.value.match(/\+/g) || []).length).toBe(1);
    });

    it('uses selected country when resolving national-format paste', async () => {
      // Default = US, but user has selected UK before pasting a UK number.
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);
      const input = getPhoneInput();
      act(() => {
        fireEvent.click(getCountryTrigger()!);
      });
      act(() => {
        selectCountry('GB');
      });
      onComplete.mockClear();

      const pasteEvent = await pasteIntoPhoneInput(input, '2079460958');

      expect(pasteEvent.defaultPrevented).toBe(true);
      expect(onComplete).toHaveBeenCalledWith('442079460958');
      expectCurrentCountryToBe('GB', '44');
    });

    it('lets partial paste use native insert behavior', async () => {
      const element = createUSPhoneElement();
      const onComplete = jest.fn();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);

      const pasteEvent = await pasteIntoPhoneInput(getPhoneInput(), '226');

      expect(pasteEvent.defaultPrevented).toBe(false);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('does not let paste change country when other countries are disabled', async () => {
      const element = createRestrictedPhoneElement({ default_country: 'US' });
      const onComplete = jest.fn();
      const props = createPhoneProps(element, { onComplete });

      render(<PhoneField {...props} />);

      const pasteEvent = await pasteIntoPhoneInput(
        getPhoneInput(),
        '+442079460958'
      );

      expect(pasteEvent.defaultPrevented).toBe(false);
      expect(onComplete).not.toHaveBeenCalled();
      expectCurrentCountryToBe('US', '1');
    });

    it('rejects paste that would shorten below the country code', () => {
      const element = createUSPhoneElement();
      const props = createPhoneProps(element);

      render(<PhoneField {...props} />);

      const input = getPhoneInput();
      fireEvent.focus(input);
      // After focus, value is "+1". Try to "paste" a value that would
      // delete the country code — the guard should reject it.
      fireEvent.change(input, { target: { value: '+' } });

      expect(input.value.startsWith('+1')).toBe(true);
    });
  });

  describe('External load fixtures (100)', () => {
    // Convert any ISO-3166 alpha-2 country code to its emoji flag.
    const flagFor = (code: string) =>
      [...code]
        .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
        .join('');

    // 100 inputs paired with the (country, digits) we expect the resolver to
    // produce. "digits" is the rawNumber after non-digit stripping.
    const fixtures: { input: string; country: string; digits: string }[] = [
      { input: '5551234567', country: 'US', digits: '15551234567' },
      { input: '7172262934', country: 'US', digits: '17172262934' },
      { input: '4155552671', country: 'US', digits: '14155552671' },
      { input: '(415) 555-2671', country: 'US', digits: '14155552671' },
      { input: '408-555-0123', country: 'US', digits: '14085550123' },
      { input: '212.555.7890', country: 'US', digits: '12125557890' },
      { input: '(646) 555-3210', country: 'US', digits: '16465553210' },
      { input: '312-555-0142', country: 'US', digits: '13125550142' },
      { input: '213 555 8765', country: 'US', digits: '12135558765' },
      { input: '8005551212', country: 'US', digits: '18005551212' },
      { input: '14155552671', country: 'US', digits: '14155552671' },
      { input: '14155552671', country: 'US', digits: '14155552671' },
      { input: '1 (415) 555-2671', country: 'US', digits: '14155552671' },
      { input: '1-415-555-2671', country: 'US', digits: '14155552671' },
      { input: '17172262934', country: 'US', digits: '17172262934' },
      { input: '17172262934', country: 'US', digits: '17172262934' },
      { input: '1 415 555 2671', country: 'US', digits: '14155552671' },
      { input: '12135558765', country: 'US', digits: '12135558765' },
      { input: '1 (213) 555-8765', country: 'US', digits: '12135558765' },
      { input: '1-415-555-2671', country: 'US', digits: '14155552671' },
      { input: '442079460958', country: 'GB', digits: '442079460958' },
      { input: '442079460958', country: 'GB', digits: '442079460958' },
      { input: '44 20 7946 0958', country: 'GB', digits: '442079460958' },
      // UK drama range — libphonenumber doesn't strict-validate, falls to US.
      { input: '44 7700 900123', country: 'US', digits: '447700900123' },
      { input: '447700900123', country: 'US', digits: '447700900123' },
      { input: '44 113 496 0123', country: 'GB', digits: '441134960123' },
      { input: '441134960123', country: 'GB', digits: '441134960123' },
      // 13-digit "+44(0)..." reconciles to GB via parsed.country detection.
      { input: '44(0)2079460958', country: 'GB', digits: '4402079460958' },
      { input: '44 161 496 0123', country: 'GB', digits: '441614960123' },
      { input: '441614960123', country: 'GB', digits: '441614960123' },
      // NANP — area code drives country (416/604/902/514/587 → CA).
      { input: '14165550199', country: 'CA', digits: '14165550199' },
      { input: '14165550199', country: 'CA', digits: '14165550199' },
      { input: '(416) 555-0199', country: 'CA', digits: '14165550199' },
      { input: '1-604-555-0142', country: 'CA', digits: '16045550142' },
      { input: '16045550142', country: 'CA', digits: '16045550142' },
      { input: '1 902 555 0123', country: 'CA', digits: '19025550123' },
      { input: '19025550123', country: 'CA', digits: '19025550123' },
      { input: '1 (514) 555-7890', country: 'CA', digits: '15145557890' },
      { input: '15145557890', country: 'CA', digits: '15145557890' },
      { input: '1 587 555 0001', country: 'CA', digits: '15875550001' },
      { input: '33123456789', country: 'FR', digits: '33123456789' },
      { input: '33 1 23 45 67 89', country: 'FR', digits: '33123456789' },
      { input: '49 30 12345678', country: 'DE', digits: '493012345678' },
      { input: '493012345678', country: 'DE', digits: '493012345678' },
      { input: '81-3-1234-5678', country: 'JP', digits: '81312345678' },
      { input: '81312345678', country: 'JP', digits: '81312345678' },
      { input: '61 2 1234 5678', country: 'AU', digits: '61212345678' },
      { input: '61212345678', country: 'AU', digits: '61212345678' },
      { input: '52 55 1234 5678', country: 'MX', digits: '525512345678' },
      { input: '55 11 91234-5678', country: 'BR', digits: '5511912345678' },
      { input: '91 98765 43210', country: 'IN', digits: '919876543210' },
      { input: '919876543210', country: 'IN', digits: '919876543210' },
      { input: '86 138 0013 8000', country: 'CN', digits: '8613800138000' },
      { input: '7 495 123 45 67', country: 'RU', digits: '74951234567' },
      { input: '31 6 12345678', country: 'NL', digits: '31612345678' },
      { input: '34 612 345 678', country: 'ES', digits: '34612345678' },
      { input: '39 06 12345678', country: 'IT', digits: '390612345678' },
      { input: '82 2 1234 5678', country: 'KR', digits: '82212345678' },
      // 10-digit non-NANP without "+" — step 3 prepends US before reconcile.
      { input: '65 9123 4567', country: 'US', digits: '16591234567' },
      { input: '353 1 234 5678', country: 'IE', digits: '35312345678' },
      { input: '27 11 123 4567', country: 'ZA', digits: '27111234567' },
      { input: '972 3 123 4567', country: 'IL', digits: '97231234567' },
      { input: '971 4 123 4567', country: 'AE', digits: '97141234567' },
      { input: '966 11 123 4567', country: 'SA', digits: '966111234567' },
      { input: '47 21 23 45 67', country: 'US', digits: '14721234567' },
      // 10-digit no-"+" — step 3 prepends US (libphonenumber doesn't
      // strict-validate UK 020-7946-XXXX drama range, so step 2 misses).
      { input: '2079460958', country: 'US', digits: '12079460958' },
      // Leading-0 national prefixes don't strip — these fall back to US.
      { input: '01134960123', country: 'US', digits: '01134960123' },
      { input: '0612345678', country: 'US', digits: '10612345678' },
      { input: '0212345678', country: 'US', digits: '10212345678' },
      { input: '0312345678', country: 'US', digits: '10312345678' },
      // 10-digit numbers without "+" → step 3 prepend US.
      { input: '9876543210', country: 'US', digits: '19876543210' },
      { input: '0987654321', country: 'US', digits: '10987654321' },
      { input: '07700900123', country: 'US', digits: '07700900123' },
      { input: '0123456789', country: 'US', digits: '10123456789' },
      { input: '06123456789', country: 'US', digits: '06123456789' },
      { input: '1 (212) 555-1212', country: 'US', digits: '12125551212' },
      { input: '(212) 555-1212', country: 'US', digits: '12125551212' },
      { input: '212.555.1212', country: 'US', digits: '12125551212' },
      { input: '212-555-1212', country: 'US', digits: '12125551212' },
      { input: '212 555 1212', country: 'US', digits: '12125551212' },
      { input: '2125551212', country: 'US', digits: '12125551212' },
      { input: ' 1 212 555 1212 ', country: 'US', digits: '12125551212' },
      { input: '1.212.555.1212', country: 'US', digits: '12125551212' },
      { input: '1 212 555 1212', country: 'US', digits: '12125551212' },
      { input: '1\t212\t555\t1212', country: 'US', digits: '12125551212' },
      { input: '', country: 'US', digits: '' },
      { input: '1', country: 'US', digits: '1' },
      { input: '12', country: 'US', digits: '12' },
      { input: '12345', country: 'US', digits: '12345' },
      { input: '9999999999999', country: 'US', digits: '9999999999999' },
      { input: 'abc123def', country: 'US', digits: '123' },
      // Real libphonenumber: '+CC0000000000' uniquely strict-validates only
      // for Côte d'Ivoire (+225 with 10-digit NSN), so step 2 picks CI.
      { input: '0000000000', country: 'CI', digits: '2250000000000' },
      { input: '1234567890123456', country: 'US', digits: '1234567890123456' },
      { input: '555', country: 'US', digits: '555' },
      { input: '1234', country: 'US', digits: '1234' },
      { input: '18005551212', country: 'US', digits: '18005551212' },
      { input: '(800) 555-1212', country: 'US', digits: '18005551212' },
      { input: '18002221212', country: 'US', digits: '18002221212' },
      { input: '800 1234 5678', country: 'US', digits: '80012345678' },
      { input: '1 (800) FLOWERS', country: 'US', digits: '1800' }
    ];

    it.each(fixtures)(
      '$input → $country: $digits',
      async ({ input, country, digits }) => {
        const element = createUSPhoneElement();
        const props = createPhoneProps(element, { fullNumber: input });

        await act(async () => {
          render(<PhoneField {...props} />);
          await Promise.resolve();
        });

        expect(getCountryTrigger()?.textContent).toContain(flagFor(country));
        expect(getPhoneInput().value.replace(/\D/g, '')).toBe(digits);
      }
    );
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
