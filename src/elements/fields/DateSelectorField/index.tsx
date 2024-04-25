import React, { memo, useEffect, useRef, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
// @ts-expect-error TS(7016): Could not find a declaration file for module 'reac... Remove this comment to see the full error message
import DatePicker from 'react-datepicker';
import DateSelectorStyles from './styles';

import { bootstrapStyles } from '../../styles';
import { parseISO } from 'date-fns';
import useBorder from '../../components/useBorder';
import { hoverStylesGuard } from '../../../utils/browser';

const isMobile = () => true; // /Mobi|Android/i.test(navigator.userAgent);
// Helper function to determine if the native datepicker should be used
const shouldUseNativePicker = (servarMeta: any) => {
  if (!isMobile()) return false;

  const hasDisabledDates =
    Array.isArray(servarMeta.disabled_dates) &&
    servarMeta.disabled_dates.length > 0;

  return (
    !servarMeta.no_weekends &&
    !hasDisabledDates &&
    !servarMeta.min_time &&
    !servarMeta.max_time
  );
};

// Helper function to parse time limits
const parseTimeThreshold = (timeThreshold: string) =>
  timeThreshold.split(':').map(Number);

export function formatDateString(date: any, meta: Record<string, any>) {
  if (!date) return '';

  const chooseTime: boolean = meta.choose_time;
  const minTime: string | undefined = meta.min_time;
  const maxTime: string | undefined = meta.max_time;

  // If simply a date, then not in UTC.
  // If it is a date time, then it is in UTC with the 'Z' at the end.
  if (chooseTime) {
    if (minTime) {
      const [minHour, minMinute] = parseTimeThreshold(minTime);
      let localHour = date.getHours();
      if (localHour < minHour) date.setHours(minHour);
      localHour = date.getHours();
      const localMinute = date.getMinutes();
      if (localHour === minHour && localMinute < minMinute)
        date.setMinutes(minMinute);
    }
    if (maxTime) {
      const [maxHour, maxMinute] = parseTimeThreshold(maxTime);
      let localHour = date.getHours();
      if (localHour > maxHour) date.setHours(maxHour);
      localHour = date.getHours();
      const localMinute = date.getMinutes();
      if (localHour === maxHour && localMinute > maxMinute)
        date.setMinutes(maxMinute);
    }

    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    const hour = date.getUTCHours().toString().padStart(2, '0');
    const minute = date.getUTCMinutes().toString().padStart(2, '0');
    const second = date.getUTCSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  } else {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  }
}

function DateSelectorField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  disabled = false,
  repeatIndex = null,
  editMode,
  rightToLeft,
  onChange = () => {},
  setRef = () => {},
  value = '',
  inlineError,
  children
}: any) {
  const servarMeta = element.servar.metadata;

  const pickerRef = useRef<any>();
  const [internalDate, setInternalDate] = useState('');

  useEffect(() => {
    if (pickerRef.current !== null && pickerRef.current.input?.inputMode) {
      pickerRef.current.input.inputMode = 'none';
    }
  }, [pickerRef]);

  useEffect(() => {
    let internalVal: any = '';
    if (value) {
      internalVal = parseISO(value);
      if (internalVal.toString() === 'Invalid Date') internalVal = '';
      else if (!servarMeta.choose_time) internalVal.setHours(0, 0, 0);
    }
    setInternalDate(internalVal);
  }, [value]);

  const filterPassedTime = (time: any) => {
    const hour = time.getHours();
    const minutes = time.getMinutes();

    if (servarMeta.min_time) {
      const [minHour, minMinutes] = parseTimeThreshold(servarMeta.min_time);
      if (minHour > hour || (minHour === hour && minMinutes > minutes))
        return false;
    }

    if (servarMeta.max_time) {
      const [maxHour, maxMinutes] = parseTimeThreshold(servarMeta.max_time);
      if (maxHour < hour || (maxHour === hour && maxMinutes < minutes))
        return false;
    }

    return true;
  };

  const filterPassedDate = (date: any) => {
    if (servarMeta.no_weekends && [0, 6].includes(date.getDay())) return false;

    const disabledDates = servarMeta.disabled_dates ?? [];
    return !disabledDates.includes(`${date.getMonth() + 1}-${date.getDate()}`);
  };

  const onDateChange = (newDate: any) => {
    newDate = newDate ?? '';
    setInternalDate(newDate);
    onChange(formatDateString(newDate, servarMeta));
  };

  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });
  const [focused, setFocused] = useState(false);

  let dateMask = servarMeta.display_format ? 'd/MM/yyyy' : 'MM/d/yyyy';
  const timeMask = servarMeta.time_format === '12hr' ? 'h:mm aa' : 'HH:mm';
  if (servarMeta.choose_time) dateMask = `${dateMask} ${timeMask}`;

  const nowString = formatDateForInput(new Date(), servarMeta.choose_time);

  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:hover': hoverStylesGuard(
            disabled
              ? {}
              : {
                  ...responsiveStyles.getTarget('hover'),
                  ...borderStyles.hover
                }
          ),
          '&&': focused
            ? {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              }
            : {}
        }}
      >
        {customBorder}
        <DateSelectorStyles />
        {shouldUseNativePicker(servarMeta) ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginRight: 10
            }}
          >
            <input
              type={servarMeta.choose_time ? 'datetime-local' : 'date'}
              value={
                internalDate
                  ? formatDateForInput(
                      internalDate as unknown as Date,
                      servarMeta.choose_time
                    )
                  : ''
              }
              onChange={(e) => {
                const newDate = new Date(e.target.value);
                if (newDate) {
                  const utcDate = new Date(
                    newDate.getUTCFullYear(),
                    newDate.getUTCMonth(),
                    newDate.getUTCDate(),
                    newDate.getHours(),
                    newDate.getMinutes()
                  );
                  onDateChange(utcDate);
                } else {
                  // Handle empty input scenario
                  setInternalDate('');
                  onChange('');
                }
              }}
              autoFocus={false}
              id={element.servar.key}
              autoComplete='off'
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              required={required}
              placeholder=''
              readOnly={disabled}
              max={servarMeta.no_future ? nowString : undefined}
              min={servarMeta.no_past ? nowString : undefined}
              aria-label={element.properties.aria_label}
              css={{
                height: '100%',
                width: '100%',
                border: 'none',
                background: 'transparent',
                ...bootstrapStyles,
                ...responsiveStyles.getTarget('field'),
                ...(focused || value || !element.properties.placeholder
                  ? {}
                  : { color: 'transparent !important' })
              }}
              ref={(ref: any) => {
                pickerRef.current = ref;
                setRef(ref);
              }}
            />
            <InlineTooltip
              id={element.id}
              text={element.properties.tooltipText}
              responsiveStyles={responsiveStyles}
              absolute={false}
            />
          </div>
        ) : (
          <>
            <DatePicker
              id={element.servar.key}
              selected={internalDate}
              preventOpenOnFocus
              autoComplete='off'
              onSelect={onDateChange} // when day is clicked
              onChange={onDateChange} // only when value has changed
              onFocus={(e: any) => {
                if (isMobile()) {
                  // hide keyboard on mobile focus
                  e.target.readOnly = true;
                }
                setFocused(true);
              }}
              onBlur={() => setFocused(false)}
              required={required}
              placeholder=''
              readOnly={disabled}
              filterDate={filterPassedDate}
              filterTime={filterPassedTime}
              showTimeSelect={servarMeta.choose_time ?? false}
              dateFormat={dateMask}
              timeFormat={timeMask}
              maxDate={servarMeta.no_future ? new Date() : undefined}
              minDate={servarMeta.no_past ? new Date() : undefined}
              showMonthDropdown
              showYearDropdown
              forceShowMonthNavigation={false}
              dropdownMode='select'
              aria-label={element.properties.aria_label}
              css={{
                height: '100%',
                width: '100%',
                border: 'none',
                background: 'transparent',
                ...bootstrapStyles,
                ...responsiveStyles.getTarget('field'),
                ...(focused || value || !element.properties.placeholder
                  ? {}
                  : { color: 'transparent !important' })
              }}
              ref={(ref: any) => {
                pickerRef.current = ref;
                setRef(ref);
              }}
              // NEW
              withPortal={isMobile()}
            />
            <InlineTooltip
              id={element.id}
              text={element.properties.tooltipText}
              responsiveStyles={responsiveStyles}
            />
          </>
        )}
        <Placeholder
          value={value}
          element={element}
          responsiveStyles={responsiveStyles}
          inputFocused={focused}
          rightToLeft={rightToLeft}
          repeatIndex={repeatIndex}
        />
      </div>
    </div>
  );
}

export default memo(DateSelectorField);

// formats a js Date to the 'yyyy-mm-dd' required for date inputs max and min
function formatDateForInput(date: Date, includeTime = false) {
  const offsetMinutes = date.getTimezoneOffset();
  const offsetMs = offsetMinutes * 60 * 1000;
  const offsetDate = new Date(date.getTime() - offsetMs);
  // yyyy-mm-dd is the first 10 chars of ISO string;
  // yyyy-mm-ddTHH:MM is the first 16 chars of ISO string;
  const sliceCharCount = includeTime ? 16 : 10;
  return offsetDate.toISOString().substring(0, sliceCharCount);
}
