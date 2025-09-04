import React, {
  memo,
  useEffect,
  useRef,
  useState,
  Suspense,
  lazy
} from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
import DateSelectorStyles, {
  DATEPICKER_ALIGN_VALUE,
  DATEPICKER_PADDING_TOP_VALUE,
  PORTAL_CONTAINER_CLASS
} from './styles';
import { resetStyles } from '../../styles';
import { parseISO } from 'date-fns';
import useBorder from '../../components/useBorder';
import {
  featheryDoc,
  featheryWindow,
  hoverStylesGuard,
  isMobile as _isMobile
} from '../../../utils/browser';
import { useCustomDateLocale } from './useDateLocale';
const DatePicker = lazy(() => import('react-datepicker'));

// Due to issues with imask and react-imask package exports, we need
// to bundle the packages and import them using this format

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IMaskInput } = require('react-imask');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MaskedRange, MaskedEnum } = require('imask');

type InternalDate = Date | null;

export interface DateSelectorProps {
  element?: any;
  responsiveStyles?: any;
  fieldLabel?: string;
  elementProps?: any;
  required?: boolean;
  disabled?: boolean;
  repeatIndex?: number;
  editMode?: boolean;
  onComplete: (value: string) => void;
  onEnter: any;
  setRef: any;
  value: string;
  inlineError?: any;
  children?: any;
}

// Helper function to parse time limits
const parseTimeThreshold = (timeThreshold: string) =>
  timeThreshold.split(':').map(Number);

export function formatDateString(
  date: InternalDate,
  meta: Record<string, any>
): string {
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

const stopTouchPropagation = (e: TouchEvent) => e.stopPropagation();

function DateSelectorField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  disabled = false,
  repeatIndex,
  editMode,
  onComplete = () => {},
  onEnter = () => {},
  setRef = () => {},
  value = '',
  inlineError,
  children
}: DateSelectorProps) {
  const servarMeta = element.servar.metadata;

  const pickerRef = useRef<any>(undefined);
  const [internalDate, setInternalDate] = useState<InternalDate>(null);
  const containerRef = useRef(null);

  const translation = element.properties.translate || {};
  const locale = useCustomDateLocale({
    monthNames: translation.months,
    shortDayNames: translation.weekdays
  });

  const [curPointerY, setCurPointerY] = useState(0);

  const isMobile = _isMobile();
  const isEmbedded = featheryWindow()?.self !== featheryWindow()?.top;

  // disables mobile devices from focusing inputs through a portal
  // https://github.com/Hacker0x01/react-datepicker/issues/2524
  const handleCalendarOpen = () => {
    featheryDoc().addEventListener('touchstart', stopTouchPropagation, true);

    if (isEmbedded && isMobile) {
      featheryDoc()
        .querySelector(PORTAL_CONTAINER_CLASS)
        ?.style.setProperty(DATEPICKER_PADDING_TOP_VALUE, `${curPointerY}px`);

      featheryDoc()
        .querySelector(PORTAL_CONTAINER_CLASS)
        ?.style.setProperty(DATEPICKER_ALIGN_VALUE, 'flex-start');
    }
  };

  const handleCalendarClose = () => {
    featheryDoc().removeEventListener('touchstart', stopTouchPropagation, true);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isEmbedded && isMobile) {
      setCurPointerY(e.clientY);
    }
  };

  useEffect(() => {
    if (pickerRef.current != null) {
      pickerRef.current.input.inputMode = 'none';
    }
  }, [pickerRef.current]);

  useEffect(() => {
    let internalVal = null;
    if (value) {
      internalVal = parseISO(value);
      if (internalVal.toString() === 'Invalid Date') internalVal = null;
      else if (!servarMeta.choose_time) internalVal.setHours(0, 0, 0);
    }
    setInternalDate(internalVal);
  }, [value]);

  const filterPassedTime = (time: Date) => {
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

  const filterPassedDate = (date: Date) => {
    if (servarMeta.no_weekends && [0, 6].includes(date.getDay())) return false;

    const disabledDates = servarMeta.disabled_dates ?? [];
    return !disabledDates.includes(`${date.getMonth() + 1}-${date.getDate()}`);
  };

  // Updates the date value on change, if the calendar is closed,
  // picking date is complete and onComplete is run
  // onSelect cannot run onComplete because it runs on day click and
  // not when time is selected if enabled
  const onDateChange = (newDate: InternalDate, isComplete = false) => {
    newDate = newDate ?? null;
    setInternalDate(newDate);
    if (isComplete) onComplete(formatDateString(newDate, servarMeta));
  };

  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });
  const [focused, setFocused] = useState(false);

  let dateMask = servarMeta.display_format ? 'dd/MM/yyyy' : 'MM/dd/yyyy';
  const timeMask = servarMeta.time_format === '24hr' ? 'HH:mm' : 'hh:mm aa';
  if (servarMeta.choose_time) dateMask = `${dateMask} ${timeMask}`;

  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
      onPointerDown={handlePointerDown}
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
            : {},
          // withPortal adds an extra unstyled div
          // this selects it and fixes its height
          // TODO: better selector using :has()
          '&>div:not([class])': {
            height: '100%'
          }
        }}
      >
        {customBorder}
        <DateSelectorStyles />
        <Suspense fallback={<div>Loading...</div>}>
          <DatePicker
            id={element.servar.key}
            selected={internalDate}
            // Many modern browsers do not support autocomplete="off".
            // In order to avoid the autoComplete, use autocomplete="new-password"
            // @See: https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion
            autoComplete='new-password'
            locale={locale}
            timeCaption={translation.time_label}
            preventOpenOnFocus={isMobile}
            onCalendarOpen={handleCalendarOpen}
            onCalendarClose={() => {
              handleCalendarClose();
              setFocused(false);
              // the calendar closes on blur, select, or modal close on mobile
              // this ensures the date is updated on close and triggers logic rules
              onDateChange(internalDate, true);
            }}
            onSelect={(date) => onDateChange(date)} // when day is clicked
            onChange={(date) => onDateChange(date)} // only when value has changed
            onFocus={(e: any) => {
              if (isMobile) {
                // hide keyboard on mobile focus
                e.target.readOnly = true;
              }
              // select all text on focus
              e.target.select();
              setFocused(true);
            }}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter(e);
            }}
            required={required}
            readOnly={disabled}
            filterDate={filterPassedDate}
            filterTime={filterPassedTime}
            showTimeSelect={servarMeta.choose_time ?? false}
            timeIntervals={servarMeta.time_interval || 30}
            dateFormat={dateMask}
            timeFormat={timeMask}
            maxDate={servarMeta.no_future && !editMode ? new Date() : undefined}
            minDate={servarMeta.no_past && !editMode ? new Date() : undefined}
            showMonthDropdown
            showYearDropdown
            forceShowMonthNavigation={false}
            dropdownMode='select'
            // Open up calendar as a modal in mobile
            withPortal={isMobile}
            portalId={isMobile ? 'feathery-portal' : undefined}
            aria-label={element.properties.aria_label}
            css={{
              height: '100%',
              width: '100%',
              border: 'none',
              background: 'transparent',
              ...resetStyles,
              ...responsiveStyles.getTarget('field'),
              ...(focused || value || !element.properties.placeholder
                ? {}
                : { color: 'transparent !important' })
            }}
            ref={(ref) => {
              pickerRef.current = ref;
              setRef(ref);
            }}
            customInput={<CustomMaskedInput dateMask={dateMask} />}
            open={focused}
          />
        </Suspense>
        <Placeholder
          value={value}
          element={element}
          responsiveStyles={responsiveStyles}
          inputFocused={focused}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          container={containerRef}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}

export default memo(DateSelectorField);

const dateBlocks = {
  dd: { mask: MaskedRange, from: 1, to: 31, maxLength: 2 },
  MM: { mask: MaskedRange, from: 1, to: 12, maxLength: 2 },
  yyyy: { mask: MaskedRange, from: 1, to: 9999, maxLength: 4 },
  HH: { mask: MaskedRange, from: 0, to: 23, maxLength: 2 },
  hh: { mask: MaskedRange, from: 1, to: 12, maxLength: 2 },
  mm: { mask: MaskedRange, from: 0, to: 59, maxLength: 2 },
  aa: { mask: MaskedEnum, enum: ['AM', 'PM'] }
} as const;

const CustomMaskedInput = React.forwardRef(
  ({ dateMask, ...rest }: any, ref) => {
    return (
      <IMaskInput {...rest} ref={ref} mask={dateMask} blocks={dateBlocks} />
    );
  }
);

export { CustomMaskedInput };
