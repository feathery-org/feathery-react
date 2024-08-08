import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

import timeZoneCountries from './timeZoneCountries';
import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
import { bootstrapStyles } from '../../styles';
import countryData from '../../components/data/countries';
import exampleNumbers from './exampleNumbers';
import { Overlay } from 'react-bootstrap';
import { isNum } from '../../../utils/primitives';
import { phoneLibPromise } from '../../../utils/validation';
import CountryDropdown from './CountryDropdown';
import useBorder from '../../components/useBorder';
import { featheryDoc, hoverStylesGuard } from '../../../utils/browser';

const DEFAULT_COUNTRY = 'US';

const countryMap = countryData.reduce(
  (countryMap, { flag, countryCode, phoneCode }) => {
    countryMap[countryCode] = { flag, phoneCode };
    return countryMap;
  },
  {} as Record<string, { flag: string; phoneCode: string }>
);

function PhoneField({
  element,
  responsiveStyles,
  fieldLabel,
  fullNumber,
  elementProps = {},
  required = false,
  disabled = false,
  repeatIndex = null,
  autoComplete,
  editMode,
  onComplete = () => {},
  setRef = () => {},
  inlineError,
  rightToLeft,
  onEnter,
  children
}: any) {
  const triggerRef = useRef(null);
  const dropdownRef = useRef<any>(null);
  const inputRef = useRef<any>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  // Track cursorChange since cursor may stay in same place but need to be
  // re-applied (e.g. delete)
  const [cursorChange, setCursorChange] = useState(false);

  const [show, setShow] = useState(false);
  // The number parsed from the fullNumber prop, updated via triggerOnChange to rawNumber
  const [curFullNumber, setCurFullNumber] = useState('');
  const servar = element.servar;
  const defaultCountry = useMemo(() => {
    if (servar.metadata.default_country === 'auto') {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!timezone) return DEFAULT_COUNTRY;
      const timeZoneCountry = timeZoneCountries[timezone];
      if (!timeZoneCountry) return DEFAULT_COUNTRY;

      const countryCode = timeZoneCountry.c[0];
      return countryCode in countryMap ? countryCode : DEFAULT_COUNTRY;
    } else {
      return servar.metadata.default_country || DEFAULT_COUNTRY;
    }
  }, [servar.metadata.default_country]);
  const [curCountryCode, setCurCountryCode] = useState<string>(defaultCountry);

  useEffect(() => setCurCountryCode(defaultCountry), [defaultCountry]);

  const phoneCode = countryMap[curCountryCode].phoneCode;
  // The raw number entered by the user, including phone code
  const [rawNumber, setRawNumber] = useState('');
  const [placeholder, setPlaceholder] = useState<string>(
    element.properties.placeholder
  );
  const [focused, setFocused] = useState(false);

  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });

  const resetToPhoneCode = (code: string) => {
    const delta = code.length > 3 ? 2 : 1;
    setCursor(code.length + delta);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (input && cursor !== null) input.setSelectionRange(cursor, cursor);
  }, [cursorChange]);

  useEffect(() => {
    if (fullNumber === curFullNumber || editMode) return;

    phoneLibPromise.then(() => {
      if (!global.libphonenumber) return;

      const ayt = new global.libphonenumber.AsYouType();
      ayt.input(`+${fullNumber}`);
      const numberObj = ayt.getNumber() ?? '';
      setCurFullNumber(fullNumber);
      setRawNumber(fullNumber);
      if (numberObj) {
        setCurCountryCode(numberObj.country ?? curCountryCode);
      }
    });
  }, [fullNumber]);

  const formattedNumber = useMemo(() => {
    const LPN = global.libphonenumber;
    if (rawNumber === '' || !LPN) return '';

    const asYouType = new LPN.AsYouType(curCountryCode);
    const onlyDigits = LPN.parseDigits(rawNumber, curCountryCode);
    return asYouType.input(`+${onlyDigits}`);
  }, [curCountryCode, rawNumber]);

  useEffect(() => {
    function hideOnClickAway(event: any) {
      const clickedWithin = [triggerRef, dropdownRef].some((ref: any) =>
        ref.current?.contains(event.target)
      );
      if (!clickedWithin) setShow(false);
    }
    featheryDoc().addEventListener('mousedown', hideOnClickAway);
    return () =>
      featheryDoc().removeEventListener('mousedown', hideOnClickAway);
  }, []);

  useEffect(() => {
    const elPlaceholder = element.properties.placeholder ?? '';
    if (editMode || elPlaceholder) {
      setPlaceholder(elPlaceholder);
      return;
    }

    const exampleNumber = exampleNumbers[curCountryCode];
    phoneLibPromise.then(() => {
      if (!global.libphonenumber) return;

      setPlaceholder(
        global.libphonenumber
          .parsePhoneNumber(exampleNumber, curCountryCode)
          .formatInternational()
      );
    });
  }, [curCountryCode, element]);

  const handleOnComplete = (curRawNumber: string) => {
    if ((fullNumber || curRawNumber) && curRawNumber !== fullNumber) {
      setCurFullNumber(curRawNumber);
      onComplete(curRawNumber);
    }
  };

  const countriesEnabled = !servar.metadata.disable_other_countries;
  const enabledCountryStyles = countriesEnabled
    ? {
        cursor: 'pointer',
        '&:hover': hoverStylesGuard({
          backgroundColor: '#e6e6e633'
        })
      }
    : {};

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
          display: 'flex',
          position: 'relative',
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
        <div
          css={{
            transition: '0.2s ease all',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            position: 'relative',
            cursor: 'default',
            ...responsiveStyles.getTarget('fieldToggle'),
            ...enabledCountryStyles
          }}
          ref={triggerRef}
          onClick={() => countriesEnabled && setShow(!show)}
        >
          {countryMap[curCountryCode].flag}
        </div>
        <Overlay
          // CONTEXT: The key prop will force React to remount the component if the container changes.
          // This is helpful when react is dealing with left over components.
          // It will be able to perform cleanup and avoid the node not found type of errors.
          key={`overlay-${curCountryCode}`}
          target={triggerRef.current}
          show={show}
          onHide={() => setShow(false)}
          placement='bottom-start'
          // CONTEXT: The container prop of the overlay lets us specify which element will hold the overlay.
          // If we do not specify the container, there are chances that the page's body is taken as the container.
          // This can cause the auto-scrolling issue that we observed.
          container={triggerRef.current}
        >
          {(props) => {
            ['placement', 'arrowProps', 'show', 'popper'].forEach(
              (prop) => delete props[prop]
            );
            return (
              <CountryDropdown
                hide={() => setShow(false)}
                itemOnClick={(countryCode: string, phoneCode: string) => {
                  setCurCountryCode(countryCode);
                  setRawNumber(phoneCode);
                  resetToPhoneCode(phoneCode);
                  setShow(false);
                  handleOnComplete(phoneCode);
                  inputRef.current.focus();
                }}
                responsiveStyles={responsiveStyles}
                {...props}
                ref={(ref: any) => {
                  dropdownRef.current = ref;
                  props.ref(ref);
                }}
                show={show}
              />
            );
          }}
        </Overlay>
        <div
          css={{
            position: 'relative',
            width: '100%',
            whiteSpace: 'nowrap'
          }}
        >
          <input
            id={servar.key}
            name={servar.key}
            css={{
              backgroundColor: 'transparent',
              height: '100%',
              width: '100%',
              border: 'none',
              ...(rightToLeft ? { textAlign: 'right' } : {}),
              ...bootstrapStyles,
              ...responsiveStyles.getTarget('field'),
              ...(focused || formattedNumber || !placeholder
                ? {}
                : { color: 'transparent !important' })
            }}
            required={required}
            disabled={disabled}
            placeholder=''
            aria-label={element.properties.aria_label}
            value={formattedNumber}
            ref={(ref) => {
              inputRef.current = ref;
              setRef(ref);
            }}
            type='tel'
            autoComplete={autoComplete ? 'tel' : 'off'}
            dir='ltr' // always left-to-right numbers but will be right justified in RTL
            onFocus={() => {
              setRawNumber((prevNum) => {
                // We only want to set the country code if the field is empty
                if (prevNum === '') {
                  resetToPhoneCode(phoneCode);
                  return phoneCode;
                }
                return prevNum;
              });
              setFocused(true);
            }}
            onBlur={() => {
              let newRawNumber = rawNumber;
              if (phoneCode.startsWith(rawNumber)) {
                setCursor(null);
                newRawNumber = '';
                setRawNumber(newRawNumber);
              }
              handleOnComplete(newRawNumber);
              setFocused(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleOnComplete(rawNumber);
                onEnter(e);
              } else if (e.key === '+') setShow(true);
            }}
            onChange={(e) => {
              let start = e.target.selectionStart;
              let newNum = e.target.value;
              if (newNum) {
                const LPN = global.libphonenumber;
                if (!LPN) return;
                const validateLength = LPN.validatePhoneNumberLength;

                // Phone codes with >3 characters will have a whitespace
                newNum = newNum.replace(/\s/g, '');

                // Number is being pasted in (iphone autofill)...
                // if the number is valid but missing the country code, add it
                if (
                  !newNum.includes('+') &&
                  !validateLength(newNum, curCountryCode) // undefined = valid
                ) {
                  newNum = `+${phoneCode}${newNum}`;
                }

                // Don't let user delete the country code
                if (!newNum.startsWith(`+${phoneCode}`)) return;
                // Prevent US phone numbers from starting with a 1
                if (newNum.startsWith('+11')) return;

                const onlyDigits = LPN.parseDigits(newNum, curCountryCode);

                if (validateLength(onlyDigits, curCountryCode) === 'TOO_LONG')
                  return;

                const asYouType = new LPN.AsYouType(curCountryCode);
                const newFormatted = asYouType.input(`+${onlyDigits}`);
                const prevNumDigits = LPN.parseDigits(
                  formattedNumber.slice(0, cursor ?? 0)
                ).length;

                setRawNumber(onlyDigits);
                const diff =
                  LPN.parseDigits(newFormatted, curCountryCode).length -
                  LPN.parseDigits(formattedNumber, curCountryCode).length;
                if (start && diff > 0) {
                  // When inserting characters, skip non-digits
                  // Also cursor must be in front of at least 1 more digit now
                  while (
                    (start <= newFormatted.length &&
                      !isNum(newFormatted[start])) ||
                    LPN.parseDigits(newFormatted.slice(0, start)).length <=
                      prevNumDigits
                  )
                    start++;
                }
              } else {
                setRawNumber(phoneCode);
                const delta = phoneCode.length > 3 ? 2 : 1;
                start = phoneCode.length + delta;
              }

              setCursor(start);
              setCursorChange(!cursorChange);
            }}
          />
          <Placeholder
            value={formattedNumber}
            element={{ properties: { placeholder } }}
            responsiveStyles={responsiveStyles}
            repeatIndex={repeatIndex}
          />
          <InlineTooltip
            id={element.id}
            text={element.properties.tooltipText}
            responsiveStyles={responsiveStyles}
            repeat={element.repeat}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(PhoneField);
