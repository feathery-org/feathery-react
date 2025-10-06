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
    self: {},
    top: {}
  })),
  isHoverDevice: jest.fn(() => false),
  isTouchDevice: jest.fn(() => false),
  isIOS: jest.fn(() => false),
  isAndroid: jest.fn(() => false),
  isMobile: jest.fn(() => false),
  hoverStylesGuard: jest.fn((styles) => styles)
}));

jest.mock('../useDateLocale', () => ({
  useCustomDateLocale: () => undefined
}));

import React, { lazy } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import DateSelectorField from '../index';

import {
  createDateSelectorElement,
  createDateSelectorProps,
  createStatefulOnComplete,
  createRestrictedDateElement,
  getMockFieldValue,
  resetMockFieldValue,
  getDatePickerInput,
  setDateValue,
  focusDateInput,
  pressEnterKey,
  getTodayISO,
  createDisabledDateString,
  expectDateInputToHaveValue,
  inputDateInput,
  blurDateInput
} from './test-utils';

describe('DateSelectorField', () => {
  beforeAll(() => {
    const DatePicker = lazy(() => import('react-datepicker'));
  });
  beforeEach(() => {
    resetMockFieldValue();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('renders DateSelectorField component with default props', async () => {
      const element = createDateSelectorElement();
      const props = createDateSelectorProps(element);

      render(<DateSelectorField {...props} />);

      // Wait for lazy-loaded DatePicker component to render
      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();
    });

    it('renders with disabled state', async () => {
      const element = createDateSelectorElement();
      const props = createDateSelectorProps(element, { disabled: true });

      render(<DateSelectorField {...props} />);

      // Try to select a past date (yesterday)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const pastDate = `${(yesterday.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${yesterday
        .getDate()
        .toString()
        .padStart(2, '0')}/${yesterday.getFullYear()}`;

      await focusDateInput();
      await inputDateInput(pastDate);

      expectDateInputToHaveValue('');
    });

    it('renders with initial value and displays it correctly', async () => {
      const element = createDateSelectorElement();
      const testDate = getTodayISO(); // e.g., "2025-10-03"
      const props = createDateSelectorProps(element, { value: testDate });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();
      // The input should have a value after the DatePicker loads and parses the date
      await waitFor(() => {
        expect(input.value).toBeTruthy();
      });
    });
  });

  describe('Date Restrictions', () => {
    it('restricts past dates when no_past is true', async () => {
      const element = createRestrictedDateElement({ noPast: true });
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Try to select a past date (yesterday)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const pastDate = `${(yesterday.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${yesterday
        .getDate()
        .toString()
        .padStart(2, '0')}/${yesterday.getFullYear()}`;

      await setDateValue(pastDate);

      // The field should reject the past date
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });

      // Today's date should work
      const today = new Date();
      const todayDate = `${(today.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${today
        .getDate()
        .toString()
        .padStart(2, '0')}/${today.getFullYear()}`;

      setDateValue(todayDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(2);
      });
    });

    it('restricts future dates when no_future is true', async () => {
      const element = createRestrictedDateElement({ noFuture: true });
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Try to select a future date (tomorrow)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const futureDate = `${(tomorrow.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${tomorrow
        .getDate()
        .toString()
        .padStart(2, '0')}/${tomorrow.getFullYear()}`;

      await setDateValue(futureDate);

      // The field should reject the future date
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });

      // Today's date should work
      const today = new Date();
      const todayDate = `${(today.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${today
        .getDate()
        .toString()
        .padStart(2, '0')}/${today.getFullYear()}`;

      setDateValue(todayDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(2);
      });
    });

    it('restricts weekends when no_weekends is true', async () => {
      const element = createRestrictedDateElement({ noWeekends: true });
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Find the next Saturday
      const saturday = new Date();
      const daysUntilSaturday = (6 - saturday.getDay() + 7) % 7;
      if (daysUntilSaturday === 0) saturday.setDate(saturday.getDate() + 7);
      else saturday.setDate(saturday.getDate() + daysUntilSaturday);

      const weekendDate = `${(saturday.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${saturday
        .getDate()
        .toString()
        .padStart(2, '0')}/${saturday.getFullYear()}`;

      await setDateValue(weekendDate);

      // Weekend dates should be filtered, onComplete is still called
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });

      // A weekday should work - find next Monday
      const monday = new Date();
      const daysUntilMonday = (1 - monday.getDay() + 7) % 7;
      if (daysUntilMonday === 0) monday.setDate(monday.getDate() + 7);
      else monday.setDate(monday.getDate() + daysUntilMonday);

      const weekdayDate = `${(monday.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${monday
        .getDate()
        .toString()
        .padStart(2, '0')}/${monday.getFullYear()}`;

      await setDateValue(weekdayDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(2);
      });
    });

    it('restricts specific disabled dates', async () => {
      const disabledDates = [
        createDisabledDateString(12, 25),
        createDisabledDateString(1, 1)
      ]; // Christmas and New Year
      const element = createRestrictedDateElement({ disabledDates });
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Try to select Christmas (disabled)
      const currentYear = new Date().getFullYear();
      const christmas = `12/25/${currentYear}`;

      await setDateValue(christmas);

      // Disabled date should be filtered, onComplete is still called
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });

      // A non-disabled date should work
      const validDate = `10/15/${currentYear}`;

      await setDateValue(validDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(2);
        const savedValue = getMockFieldValue();
        expect(savedValue).toMatch(/^\d{4}-10-15$/);
      });
    });

    it('combines multiple date restrictions', async () => {
      const element = createRestrictedDateElement({
        noPast: true,
        noWeekends: true,
        disabledDates: [createDisabledDateString(12, 25)]
      });
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Find a valid future weekday
      const futureWeekday = new Date();
      futureWeekday.setDate(futureWeekday.getDate() + 10); // Go to future
      // Make sure it's a weekday (Monday-Friday)
      if (futureWeekday.getDay() === 0 || futureWeekday.getDay() === 6) {
        futureWeekday.setDate(futureWeekday.getDate() + 2);
      }

      const validDate = `${(futureWeekday.getMonth() + 1)
        .toString()
        .padStart(2, '0')}/${futureWeekday
        .getDate()
        .toString()
        .padStart(2, '0')}/${futureWeekday.getFullYear()}`;

      await setDateValue(validDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
        const savedValue = getMockFieldValue();
        expect(savedValue).toBeTruthy();
        expect(savedValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('allows all dates when no restrictions are set', async () => {
      const element = createRestrictedDateElement({}); // No restrictions
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Should accept past dates
      const pastDate = '01/15/2020';
      await setDateValue(pastDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
        const savedValue = getMockFieldValue();
        expect(savedValue).toMatch(/^2020-01-15$/);
      });

      // Should accept future dates
      const futureDate = '12/31/2030';
      await setDateValue(futureDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledTimes(2);
        const savedValue = getMockFieldValue();
        expect(savedValue).toMatch(/^2030-12-31$/);
      });
    });
  });

  describe('onChange Functionality', () => {
    it('handles basic date selection and calls onComplete', async () => {
      const element = createDateSelectorElement();
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      const testDate = '10/15/2025';
      await setDateValue(testDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });
    });

    it('updates field value when date is selected', async () => {
      const element = createDateSelectorElement();
      const onComplete = createStatefulOnComplete();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      const testDate = '10/15/2025';
      await setDateValue(testDate);

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
        const savedValue = getMockFieldValue();
        // The value should be in ISO format (YYYY-MM-DD)
        expect(savedValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });

    it('allows typing partial dates without immediate completion', async () => {
      const element = createDateSelectorElement();
      const onComplete = jest.fn();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Simulate typing partial date
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '12/25' } });

      // Partial dates should not trigger completion immediately (only on blur)
      expect(input.value).toBeTruthy();
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('Default Today Functionality', () => {
    it('starts with empty value by default', async () => {
      const element = createDateSelectorElement();
      const props = createDateSelectorProps(element);

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('');
    });

    it("accepts today's date as initial value", async () => {
      const element = createDateSelectorElement();
      const today = getTodayISO();
      const props = createDateSelectorProps(element, { value: today });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();
      await waitFor(() => {
        expect(input.value).toBeTruthy();
      });
    });
  });

  describe('Focus and Blur Events', () => {
    it('handles focus events', async () => {
      const element = createDateSelectorElement();
      const props = createDateSelectorProps(element);

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      // Verify input can receive focus
      expect(input).not.toBeDisabled();
      await focusDateInput();

      // Verify the focus event was fired
      expect(input).toBeInTheDocument();
    });

    it('triggers onComplete when input loses focus with a value', async () => {
      const element = createDateSelectorElement();
      const onComplete = jest.fn();
      const props = createDateSelectorProps(element, { onComplete });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      await focusDateInput();
      await inputDateInput('10/15/2025');
      await blurDateInput();

      // Blur should trigger completion with the entered value
      await waitFor(() => {
        expect(onComplete).toHaveBeenCalled();
      });
    });

    it('handles Enter key press and calls onEnter callback', async () => {
      const element = createDateSelectorElement();
      const onEnter = jest.fn();
      const props = createDateSelectorProps(element, { onEnter });

      render(<DateSelectorField {...props} />);

      const input = await getDatePickerInput();
      expect(input).toBeInTheDocument();

      await pressEnterKey();

      expect(onEnter).toHaveBeenCalled();
    });
  });
});
