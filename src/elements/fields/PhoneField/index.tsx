import React, { memo, useEffect, useRef, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/Tooltip';
import { bootstrapStyles } from '../../styles';
import countryData from './countryData';
import exampleNumbers from './exampleNumbers';
import { Overlay } from 'react-bootstrap';
import { isNum } from '../../../utils/primitives';
import { phoneLibPromise } from '../../../utils/validation';
import CountryDropdown from './CountryDropdown';
import useBorder from '../../components/useBorder';

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
  editMode,
  onChange = () => {},
  setRef = () => {},
  inlineError,
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
  const [curFullNumber, setCurFullNumber] = useState('');
  const servar = element.servar;
  const defaultCountry = servar.metadata.default_country ?? DEFAULT_COUNTRY;
  const [curCountryCode, setCurCountryCode] = useState(defaultCountry);

  useEffect(() => setCurCountryCode(defaultCountry), [defaultCountry]);

  const phoneCode = countryMap[curCountryCode].phoneCode;
  const [rawNumber, setRawNumber] = useState('');
  const [formattedNumber, setFormattedNumber] = useState('');
  const [triggerOnChange, setTriggerOnChange] = useState<boolean | null>(null);
  const [placeholder, setPlaceholder] = useState(
    element.properties.placeholder
  );
  const [focused, setFocused] = useState(false);

  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });

  useEffect(() => {
    const input = inputRef.current;
    if (input) input.setSelectionRange(cursor, cursor);
  }, [inputRef, cursor, cursorChange]);

  useEffect(() => {
    if (fullNumber === curFullNumber || editMode) return;

    phoneLibPromise.then(() => {
      if (!global.libphonenumber) return;

      const ayt = new global.libphonenumber.AsYouType();
      ayt.input(`+${fullNumber}`);
      const numberObj = ayt.getNumber();
      if (numberObj) {
        setCurFullNumber(fullNumber);
        setRawNumber(numberObj.nationalNumber);
        setFormattedNumber(numberObj.formatNational());
        setCurCountryCode(numberObj.country ?? DEFAULT_COUNTRY);
      }
    });
  }, [fullNumber]);

  useEffect(() => {
    function hideOnClickAway(event: any) {
      const clickedWithin = [triggerRef, dropdownRef].some((ref: any) =>
        ref.current?.contains(event.target)
      );
      if (!clickedWithin) setShow(false);
    }
    document.addEventListener('mousedown', hideOnClickAway);
    return () => document.removeEventListener('mousedown', hideOnClickAway);
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
          .formatNational()
      );
    });
  }, [curCountryCode, element]);

  useEffect(() => {
    if (triggerOnChange === null) return;

    const newNumber = `${phoneCode}${rawNumber}`;
    if ((fullNumber || rawNumber) && newNumber !== fullNumber) {
      setCurFullNumber(newNumber);
      onChange(newNumber);
    }
  }, [triggerOnChange]);

  return (
    <div
      css={{
        maxWidth: '100%',
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
          '&:hover': {
            ...responsiveStyles.getTarget('hover'),
            ...borderStyles.hover
          },
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
            cursor: 'pointer',
            transition: '0.2s ease all',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            position: 'relative',
            ...responsiveStyles.getTarget('fieldToggle'),
            '&:hover': { backgroundColor: '#e6e6e633' }
          }}
          ref={triggerRef}
          onClick={() => setShow(!show)}
        >
          {countryMap[curCountryCode].flag}
        </div>
        <Overlay
          target={triggerRef.current}
          show={show}
          onHide={() => setShow(false)}
          placement='bottom-start'
        >
          {(props) => {
            ['placement', 'arrowProps', 'show', 'popper'].forEach(
              (prop) => delete props[prop]
            );
            return (
              <CountryDropdown
                hide={() => setShow(false)}
                itemOnClick={(countryCode: string) => {
                  setCurCountryCode(countryCode);
                  setRawNumber('');
                  setFormattedNumber('');
                  setShow(false);
                  setTriggerOnChange(!triggerOnChange);
                  inputRef.current.focus();
                }}
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
            whiteSpace: 'nowrap',
            overflowX: 'hidden'
          }}
        >
          <input
            id={servar.key}
            css={{
              backgroundColor: 'transparent',
              height: '100%',
              width: '100%',
              border: 'none',
              ...bootstrapStyles,
              ...responsiveStyles.getTarget('field'),
              ...(focused || formattedNumber || !placeholder
                ? {}
                : { color: 'transparent !important' })
            }}
            required={required}
            autoComplete={servar.metadata.autocomplete || 'on'}
            placeholder=''
            value={formattedNumber}
            ref={(ref) => {
              inputRef.current = ref;
              setRef(ref);
            }}
            type='tel'
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setTriggerOnChange(!triggerOnChange);
              setFocused(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setTriggerOnChange(!triggerOnChange);
              else if (e.key === '+') setShow(true);
            }}
            onChange={(e) => {
              let start = e.target.selectionStart;
              const newNum = e.target.value;
              if (newNum) {
                const LPN = global.libphonenumber;
                if (!LPN) return;

                const onlyDigits = LPN.parseDigits(newNum, curCountryCode);
                // Prevent user from starting national number with country code.
                // This is valid for all countries aside from a few, like Indonesia
                // We do this because libphonenumber national number parsing
                // removes the national prefix, so we can't rely on that
                if (onlyDigits[0] === phoneCode[0]) return;
                const validate = LPN.validatePhoneNumberLength;
                if (validate(onlyDigits, curCountryCode) === 'TOO_LONG') return;

                const asYouType = new LPN.AsYouType(curCountryCode);
                const formatted = asYouType.input(onlyDigits);
                const prevNumDigits = LPN.parseDigits(
                  formattedNumber.slice(0, cursor ?? 0)
                ).length;

                setFormattedNumber(formatted);
                setRawNumber(onlyDigits);
                const diff = formatted.length - formattedNumber.length;
                if (start && diff > 0) {
                  // When inserting characters, skip non-digits
                  // Also cursor must be in front of at least 1 more digit now
                  while (
                    (start <= formatted.length && !isNum(formatted[start])) ||
                    LPN.parseDigits(formatted.slice(0, start)).length <=
                      prevNumDigits
                  )
                    start++;
                }
              } else {
                setFormattedNumber('');
                setRawNumber('');
              }

              setCursor(start);
              setCursorChange(!cursorChange);
            }}
          />
          <Placeholder
            value={formattedNumber}
            element={{ properties: { placeholder } }}
            responsiveStyles={responsiveStyles}
          />
          <InlineTooltip
            element={element}
            responsiveStyles={responsiveStyles}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(PhoneField);
