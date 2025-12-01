import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

export const createDateSelectorElement = (
  type: string = 'date',
  metadata: any = {},
  properties: any = {},
  styles: any = {}
) =>
  createBaseElement(
    'test-date-selector',
    type,
    {
      display_format: false, // false = MM/dd/yyyy, true = dd/MM/yyyy
      choose_time: false,
      time_format: '12hr', // '12hr' or '24hr'
      time_interval: 30,
      min_time: '',
      max_time: '',
      no_past: false,
      no_future: false,
      no_weekends: false,
      disabled_dates: [],
      ...metadata
    },
    {
      aria_label: 'Test date selector field',
      placeholder: 'Select date',
      translate: {
        months: [
          'January',
          'February',
          'March',
          'April',
          'May',
          'June',
          'July',
          'August',
          'September',
          'October',
          'November',
          'December'
        ],
        weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        time_label: 'Time'
      },
      ...properties
    },
    styles
  );

export const createDateSelectorProps = (element: any, customProps: any = {}) =>
  createFieldProps(element, {
    value: '',
    onComplete: jest.fn(),
    onEnter: jest.fn(),
    setRef: jest.fn(),
    ...customProps
  });

export const createStatefulOnComplete = () => {
  return jest.fn((value: string) => {
    setMockFieldValue(value);
  });
};

export const createDisplayFormatMetadata = (useDDMMYYYY: boolean = false) => ({
  display_format: useDDMMYYYY
});

export const createTimeMetadata = (
  format: '12hr' | '24hr' = '12hr',
  interval: number = 30,
  minTime?: string,
  maxTime?: string
) => ({
  choose_time: true,
  time_format: format,
  time_interval: interval,
  ...(minTime && { min_time: minTime }),
  ...(maxTime && { max_time: maxTime })
});

export const createDateRestrictionsMetadata = (
  noPast?: boolean,
  noFuture?: boolean,
  noWeekends?: boolean,
  disabledDates?: string[],
  minDate?: string | { number: number; unit: 'days' | 'weeks' | 'months' | 'years' },
  maxDate?: string | { number: number; unit: 'days' | 'weeks' | 'months' | 'years' }
) => ({
  ...(noPast !== undefined && { no_past: noPast }),
  ...(noFuture !== undefined && { no_future: noFuture }),
  ...(noWeekends !== undefined && { no_weekends: noWeekends }),
  ...(disabledDates && { disabled_dates: disabledDates }),
  ...(minDate && { min_date: minDate }),
  ...(maxDate && { max_date: maxDate })
});

export const createMMDDYYYYElement = (metadata: any = {}) =>
  createDateSelectorElement('date', { display_format: false, ...metadata });

export const createDDMMYYYYElement = (metadata: any = {}) =>
  createDateSelectorElement('date', { display_format: true, ...metadata });

export const createTimeEnabledElement = (
  format: '12hr' | '24hr' = '12hr',
  interval: number = 30
) => createDateSelectorElement('date', createTimeMetadata(format, interval));

export const createRestrictedDateElement = (restrictions: any = {}) =>
  createDateSelectorElement(
    'date',
    createDateRestrictionsMetadata(
      restrictions.noPast,
      restrictions.noFuture,
      restrictions.noWeekends,
      restrictions.disabledDates,
      restrictions.minDate,
      restrictions.maxDate
    )
  );

export const getDatePickerInput = async () => {
  return await waitFor(() => {
    const inputById = document.querySelector(
      'input[id^="test-date-selector"]'
    ) as HTMLInputElement;

    if (!inputById) throw new Error('Date picker input not found');
    return inputById;
  });
};

export const getMaskedInput = () => {
  return document.querySelector(
    '[data-testid="masked-input"]'
  ) as HTMLInputElement;
};

export const getTooltip = () => {
  return document.querySelector('[data-testid*="tooltip"]');
};

export const setDateValue = async (value: string) => {
  const user = userEvent.setup();
  const input = await getDatePickerInput();
  await user.click(input);
  await user.clear(input);
  await user.type(input, value);
  await user.tab(); // Tab away to trigger blur
};

export const focusDateInput = async () => {
  const user = userEvent.setup();
  const input = await getDatePickerInput();
  await user.click(input);
};

export const blurDateInput = async () => {
  const user = userEvent.setup();
  await user.tab(); // Tab away to blur the current element
};

export const pressEnterKey = async () => {
  const user = userEvent.setup();
  const input = await getDatePickerInput();
  await user.type(input, '{Enter}');
};

export const inputDateInput = async (value: string) => {
  const user = userEvent.setup();
  const input = await getDatePickerInput();
  await user.type(input, value);
};

export const expectDateInputToHaveValue = async (expectedValue: string) => {
  const input = await getDatePickerInput();
  expect(input.value).toBe(expectedValue);
};

export const expectDateInputToBeOptional = async () => {
  const input = await getDatePickerInput();
  expect(input.required).toBe(false);
};

export const expectTooltipToHaveText = (expectedText: string) => {
  const tooltip = getTooltip();
  expect(tooltip?.getAttribute('title')).toBe(expectedText);
};

export const expectFieldToHaveValue = (expectedValue: string) => {
  const currentValue = getMockFieldValue();
  expect(currentValue).toBe(expectedValue);
};

export const getTodayISO = () => {
  return new Date().toISOString().split('T')[0];
};

export const getPastDateISO = (daysAgo: number = 1) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
};

export const getFutureDateISO = (daysFromNow: number = 1) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
};

export const getWeekendDateISO = () => {
  const date = new Date();
  const daysUntilSaturday = (6 - date.getDay()) % 7;
  date.setDate(date.getDate() + daysUntilSaturday);
  return date.toISOString().split('T')[0];
};

export const createDisabledDateString = (month: number, day: number) => {
  return `${month}-${day}`;
};

export const getDateISO = (daysFromNow: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split('T')[0];
};

export const formatDateForInput = (isoDate: string) => {
  const date = new Date(isoDate);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
};

export const expectDateToBeFiltered = async (
  dateString: string,
  shouldBeFiltered: boolean
) => {
  await setDateValue(dateString);
  const input = await getDatePickerInput();

  if (shouldBeFiltered) {
    expect(input.value).not.toBe(dateString);
  } else {
    expect(input.value).toBe(dateString);
  }
};
