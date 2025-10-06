let mockAddressSearchResults: any[] = [];
let mockAddressDetail: any = null;

jest.mock('../utils', () => ({
  isKeydownValid: () => true
}));

jest.mock('../../../components/Overlay', () => {
  return function MockOverlay({ show, children }: any) {
    if (show) {
      return <div data-testid='overlay'>{children}</div>;
    }
    return null;
  };
});

jest.mock('../../../../utils/init', () => ({
  initInfo: jest.fn(() => ({
    sdkKey: 'test-sdk-key',
    apiUrl: 'https://api.feathery.io',
    environment: 'test'
  }))
}));

jest.mock('../../../../utils/featheryClient', () => {
  return jest.fn().mockImplementation(() => ({
    addressSearchResults: jest.fn(() =>
      Promise.resolve(mockAddressSearchResults)
    ),
    addressDetail: jest.fn(() => Promise.resolve(mockAddressDetail))
  }));
});

jest.mock('../../../../utils/browser', () => ({
  runningInClient: jest.fn(() => true),
  featheryDoc: jest.fn(() => ({
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    querySelector: jest.fn(() => null),
    createElement: jest.fn(() => ({
      id: '',
      textContent: '',
      style: { setProperty: jest.fn() }
    })),
    head: {
      appendChild: jest.fn()
    }
  })),
  featheryWindow: jest.fn(() => ({
    matchMedia: jest.fn(() => ({
      matches: false,
      addListener: jest.fn(),
      removeListener: jest.fn()
    })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    self: {},
    top: {}
  })),
  isHoverDevice: jest.fn(() => false),
  isTouchDevice: jest.fn(() => false),
  isIOS: jest.fn(() => false),
  isAndroid: jest.fn(() => false),
  isMobile: jest.fn(() => false),
  hoverStylesGuard: jest.fn((styles) => styles),
  iosScrollOnFocus: jest.fn()
}));

import { render, waitFor, act } from '@testing-library/react';
import AddressLine1 from '..';
import {
  createAddressLine1Element,
  createAddressLine1Props,
  createStatefulOnChange,
  AddressWrapper,
  typeInAddressInput,
  focusAddressInput,
  blurAddressInput,
  pressEscapeOnInput,
  clickDropdownOption,
  isDropdownVisible,
  isAddressInputDisabled,
  getInputMaxLength,
  getInputMinLength,
  getDropdownOptions,
  expectAddressValue,
  resetMockFieldValue,
  createMockAddressSearchResult,
  createMockAddressDetail,
  waitForDebounce,
  getAddressInput
} from './test-utils';

const setMockAddressSearchResults = (results: any[]) => {
  mockAddressSearchResults = results;
};

const setMockAddressDetail = (detail: any) => {
  mockAddressDetail = detail;
};

const resetMockAddressData = () => {
  mockAddressSearchResults = [];
  mockAddressDetail = null;
};

describe('AddressLine1', () => {
  beforeEach(() => {
    resetMockFieldValue();
    resetMockAddressData();
    jest.clearAllMocks();
  });

  describe('onChange functionality', () => {
    it('should call onChange with value', async () => {
      const element = createAddressLine1Element();
      const onChange = createStatefulOnChange();
      const props = createAddressLine1Props(element, {
        onChange
      });

      render(<AddressLine1 {...props} />);

      await typeInAddressInput('456 Oak Avenue');

      expect(onChange).toHaveBeenCalled();

      expectAddressValue('456 Oak Avenue');
    });

    it('should handle multiple onChange events', async () => {
      const element = createAddressLine1Element();
      const onChange = jest.fn();
      const props = createAddressLine1Props(element, {
        onChange
      });

      render(<AddressLine1 {...props} />);

      await typeInAddressInput('1');
      await typeInAddressInput('12');
      await typeInAddressInput('123');

      expect(onChange).toHaveBeenCalledTimes(3);
    });
  });

  describe('disabled functionality', () => {
    it('should disable input when disabled prop is true', () => {
      const element = createAddressLine1Element();
      const props = createAddressLine1Props(element, {
        disabled: true
      });

      render(<AddressLine1 {...props} />);

      expect(isAddressInputDisabled()).toBe(true);
    });
  });

  describe('min/max length', () => {
    it('should set maxLength attribute on input', () => {
      const element = createAddressLine1Element('gmap_line_1', {}, {}, {});
      element.servar.max_length = 100;

      const props = createAddressLine1Props(element);

      render(<AddressLine1 {...props} />);

      expect(getInputMaxLength()).toBe(100);
    });

    it('should set minLength attribute on input', () => {
      const element = createAddressLine1Element('gmap_line_1', {}, {}, {});
      element.servar.min_length = 5;

      const props = createAddressLine1Props(element);

      render(<AddressLine1 {...props} />);

      expect(getInputMinLength()).toBe(5);
    });
  });

  describe('Google autocomplete', () => {
    describe('search country', () => {
      it('should not show dropdown when address_autocomplete is disabled', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: false
        });

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('1234 Main Street');

        await act(async () => {
          await waitForDebounce();
        });

        expect(isDropdownVisible()).toBe(false);
      });

      it('should fetch and show address suggestions when typing', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          autocomplete_country: 'US'
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1'),
          createMockAddressSearchResult('123 Main St, Los Angeles, CA', 'addr2')
        ];
        setMockAddressSearchResults(mockResults);

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        const options = getDropdownOptions();
        expect(options).toHaveLength(2);
        expect(options[0].textContent).toBe('123 Main St, New York, NY');
        expect(options[1].textContent).toBe('123 Main St, Los Angeles, CA');
      });

      it('should filter by country when autocomplete_country is set', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          autocomplete_country: 'CA'
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, Toronto, ON', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        const options = getDropdownOptions();
        expect(options).toHaveLength(1);
        expect(options[0].textContent).toBe('123 Main St, Toronto, ON');
      });

      it('should only fetch when input length > 3', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        render(<AddressWrapper element={element} />);

        // Type 3 characters - should not fetch
        await typeInAddressInput('123');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        expect(isDropdownVisible()).toBe(false);

        // Type 4 characters - should fetch
        await typeInAddressInput('1234');

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });
      });

      it('should hide dropdown when pressing Escape', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await pressEscapeOnInput();

        expect(isDropdownVisible()).toBe(false);
      });
    });

    describe('save address - into 1 line', () => {
      it('should save full address into single field when save_address is all_line_1', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          save_address: 'all_line_1'
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail({
          formatted_address: '123 Main St, New York, NY 10001, USA'
        });
        setMockAddressDetail(mockDetail);

        const onSelect = jest.fn();

        render(<AddressWrapper element={element} onSelect={onSelect} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          expect(onSelect).toHaveBeenCalledWith(mockDetail, 'addr1');
        });
      });

      it('should call onSelect with full formatted address', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          save_address: 'all_line_1'
        });

        const mockResults = [
          createMockAddressSearchResult('456 Oak Ave, Chicago, IL', 'addr2')
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail({
          formatted_address: '456 Oak Ave, Chicago, IL 60601, USA'
        });
        setMockAddressDetail(mockDetail);

        const onSelect = jest.fn();

        render(<AddressWrapper element={element} onSelect={onSelect} />);

        await typeInAddressInput('456 Oak');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          expect(onSelect).toHaveBeenCalled();
          const details = onSelect.mock.calls[0][0];
          expect(details.formatted_address).toBe(
            '456 Oak Ave, Chicago, IL 60601, USA'
          );
        });
      });
    });

    describe('save address - into components', () => {
      it('should call onSelect with address components', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          save_address: 'components'
        });

        const mockResults = [
          createMockAddressSearchResult('789 Pine St, Seattle, WA', 'addr3')
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail({
          gmap_line_1: '789 Pine St',
          gmap_line_2: 'Apt 5',
          gmap_city: 'Seattle',
          gmap_state: 'Washington',
          gmap_state_short: 'WA',
          gmap_zip: '98101',
          gmap_country: 'US'
        });
        setMockAddressDetail(mockDetail);

        const onSelect = jest.fn();

        render(<AddressWrapper element={element} onSelect={onSelect} />);

        await typeInAddressInput('789 Pine');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          expect(onSelect).toHaveBeenCalled();
          const details = onSelect.mock.calls[0][0];
          expect(details.gmap_line_1).toBe('789 Pine St');
          expect(details.gmap_city).toBe('Seattle');
          expect(details.gmap_state).toBe('Washington');
          expect(details.gmap_state_short).toBe('WA');
          expect(details.gmap_zip).toBe('98101');
          expect(details.gmap_country).toBe('US');
        });
      });

      it('should provide all address components including city, state, and zip', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          save_address: 'components'
        });

        const mockResults = [
          createMockAddressSearchResult('321 Elm St, Boston, MA', 'addr4')
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail({
          gmap_line_1: '321 Elm St',
          gmap_line_2: '',
          gmap_city: 'Boston',
          gmap_state: 'Massachusetts',
          gmap_state_short: 'MA',
          gmap_zip: '02108',
          gmap_country: 'US'
        });
        setMockAddressDetail(mockDetail);

        const onSelect = jest.fn();

        render(<AddressWrapper element={element} onSelect={onSelect} />);

        await typeInAddressInput('321 Elm');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          expect(onSelect).toHaveBeenCalled();
          const details = onSelect.mock.calls[0][0];
          expect(details).toHaveProperty('gmap_line_1');
          expect(details).toHaveProperty('gmap_line_2');
          expect(details).toHaveProperty('gmap_city');
          expect(details).toHaveProperty('gmap_state');
          expect(details).toHaveProperty('gmap_state_short');
          expect(details).toHaveProperty('gmap_zip');
          expect(details).toHaveProperty('gmap_country');
        });
      });

      it('should pass addressId to onSelect', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true,
          save_address: 'components'
        });

        const mockResults = [
          createMockAddressSearchResult(
            '555 Maple Dr, Austin, TX',
            'unique-addr-id'
          )
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail();
        setMockAddressDetail(mockDetail);

        const onSelect = jest.fn();

        render(<AddressWrapper element={element} onSelect={onSelect} />);

        await typeInAddressInput('555 Maple');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          expect(onSelect).toHaveBeenCalledWith(
            expect.any(Object),
            'unique-addr-id'
          );
        });
      });
    });

    describe('autocomplete interactions', () => {
      it('should hide dropdown after selecting an option', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail();
        setMockAddressDetail(mockDetail);

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(false);
        });
      });

      it('should focus input after selecting an option', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        const mockDetail = createMockAddressDetail();
        setMockAddressDetail(mockDetail);

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await clickDropdownOption(0);

        await waitFor(() => {
          const input = getAddressInput();
          expect(document.activeElement).toBe(input);
        });
      });

      it('should hide dropdown on blur after delay', async () => {
        const element = createAddressLine1Element('gmap_line_1', {
          address_autocomplete: true
        });

        const mockResults = [
          createMockAddressSearchResult('123 Main St, New York, NY', 'addr1')
        ];
        setMockAddressSearchResults(mockResults);

        render(<AddressWrapper element={element} />);

        await typeInAddressInput('123 Main');
        await focusAddressInput();

        await act(async () => {
          await waitForDebounce();
        });

        await waitFor(() => {
          expect(isDropdownVisible()).toBe(true);
        });

        await blurAddressInput();

        // Wait for the EXIT_DELAY_TIME_MS (200ms)
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 250));
        });

        expect(isDropdownVisible()).toBe(false);
      });
    });
  });
});
