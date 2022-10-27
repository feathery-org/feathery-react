import React, { memo, useEffect, useRef, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/Tooltip';
import { bootstrapStyles, ERROR_COLOR } from '../../styles';
import countryData from './countryData';
import exampleNumbers from './exampleNumbers';
import { Overlay } from 'react-bootstrap';
import { isNum } from '../../../utils/primitives';
import DropdownArrow from '../../components/DropdownArrow';
import { phoneLibPromise } from '../../../utils/validation';
import CountryDropdown from './CountryDropdown';

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
  applyStyles,
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
  const [curCountryCode, setCurCountryCode] = useState(DEFAULT_COUNTRY);
  const [rawNumber, setRawNumber] = useState('');
  const [formattedNumber, setFormattedNumber] = useState('');
  const [triggerOnChange, setTriggerOnChange] = useState(false);
  const [placeholder, setPlaceholder] = useState(
    element.properties.placeholder
  );

  useEffect(() => {
    const input = inputRef.current;
    if (input) input.setSelectionRange(cursor, cursor);
  }, [inputRef, cursor, cursorChange]);

  useEffect(() => {
    if (fullNumber === curFullNumber) return;

    phoneLibPromise.then(() => {
      const ayt = new global.libphonenumber.AsYouType();
      ayt.input(`+${fullNumber}`);
      const numberObj = ayt.getNumber();
      if (numberObj) {
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
    if (element.properties.placeholder) return;

    const exampleNumber = exampleNumbers[curCountryCode];
    phoneLibPromise.then(() => {
      setPlaceholder(
        global.libphonenumber
          .parsePhoneNumber(exampleNumber, curCountryCode)
          .formatNational()
      );
    });
  }, [curCountryCode, element]);

  useEffect(() => {
    const phoneCode = countryMap[curCountryCode].phoneCode;
    const newNumber = `${phoneCode}${rawNumber}`;
    if ((fullNumber || rawNumber) && newNumber !== fullNumber) {
      setCurFullNumber(newNumber);
      onChange(newNumber);
    }
  }, [onChange, triggerOnChange, curCountryCode]);

  const servar = element.servar;
  return (
    <div
      css={{
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          display: 'flex',
          ...applyStyles.getTarget('sub-fc'),
          ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
          '&:focus': applyStyles.getTarget('active'),
          '&:hover': { ...applyStyles.getTarget('hover'), padding: 0 }
        }}
      >
        <div
          css={{
            cursor: 'pointer',
            transition: '0.2s ease all',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: '1px solid #e6e6e6',
            ...applyStyles.getTarget('fieldToggle'),
            '&:hover': {
              backgroundColor: '#e6e6e6'
            }
          }}
          ref={triggerRef}
          onClick={() => setShow(!show)}
        >
          {countryMap[curCountryCode].flag}
          <DropdownArrow css={{ marginLeft: '3px' }} />
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
                  inputRef.current.focus();
                }}
                dropdownRef={(ref: any) => {
                  dropdownRef.current = ref;
                  props.ref(ref);
                }}
                {...props}
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
              height: '100%',
              width: '100%',
              border: 'none',
              ...bootstrapStyles,
              ...applyStyles.getTarget('field'),
              '&:not(:focus)':
                formattedNumber || !placeholder
                  ? {}
                  : { color: 'transparent !important' }
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
            onBlur={() => setTriggerOnChange(!triggerOnChange)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setTriggerOnChange(!triggerOnChange);
              else if (e.key === '+') setShow(true);
            }}
            onChange={(e) => {
              let start = e.target.selectionStart;
              const newNum = e.target.value;
              if (newNum) {
                const LPN = global.libphonenumber;
                const onlyDigits = LPN.parseDigits(newNum, curCountryCode);
                const validate = LPN.validatePhoneNumberLength;
                if (validate(onlyDigits, curCountryCode) !== 'TOO_LONG') {
                  const asYouType = new LPN.AsYouType(curCountryCode);
                  const formatted = asYouType.input(onlyDigits);
                  // Only update if nationally significant numbers added
                  if (asYouType.getNumber()) {
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
                        (start <= formatted.length &&
                          !isNum(formatted[start])) ||
                        LPN.parseDigits(formatted.slice(0, start)).length <=
                          prevNumDigits
                      )
                        start++;
                    }
                  }
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
            applyStyles={applyStyles}
          />
          <InlineTooltip element={element} applyStyles={applyStyles} />
        </div>
      </div>
    </div>
  );
}

export default memo(PhoneField);
