import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/Tooltip';
import { bootstrapStyles, ERROR_COLOR } from '../../styles';
import countryData from './countryData';
import exampleNumbers from './exampleNumbers';
import { Overlay } from 'react-bootstrap';
import { isNum } from '../../../utils/primitives';
import DropdownArrow from '../../components/DropdownArrow';

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
  const listItemRef = useRef<Record<string, any>>({});
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
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!show) setQuery('');
  }, [show]);

  useEffect(() => {
    const input = inputRef.current;
    if (input) input.setSelectionRange(cursor, cursor);
  }, [inputRef, cursor, cursorChange]);

  useEffect(() => {
    if (fullNumber === curFullNumber) return;

    const ayt = new global.libphonenumber.AsYouType();
    ayt.input(`+${fullNumber}`);
    const numberObj = ayt.getNumber();
    if (numberObj) {
      setRawNumber(numberObj.nationalNumber);
      setFormattedNumber(numberObj.formatNational());
      setCurCountryCode(numberObj.country ?? DEFAULT_COUNTRY);
    }
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
    setPlaceholder(
      global.libphonenumber
        .parsePhoneNumber(exampleNumber, curCountryCode)
        .formatNational()
    );
  }, [curCountryCode, element]);

  useEffect(() => {
    const phoneCode = countryMap[curCountryCode].phoneCode;
    const newNumber = `${phoneCode}${rawNumber}`;
    if ((fullNumber || rawNumber) && newNumber !== fullNumber) {
      setCurFullNumber(newNumber);
      onChange(newNumber);
    }
  }, [onChange, triggerOnChange, curCountryCode]);

  const supportedCountries = useMemo(() => {
    const filteredData = countryData.filter(
      ({ countryCode, countryName, phoneCode }) => {
        if (!global.libphonenumber?.isSupportedCountry(countryCode))
          return false;
        return (
          !query ||
          countryCode.toLowerCase().includes(query) ||
          countryName.toLowerCase().includes(query) ||
          `+${phoneCode}`.includes(query)
        );
      }
    );
    return (
      <>
        <input
          autoFocus
          placeholder='Search'
          css={{
            width: '100%',
            height: '30px',
            outline: 'none',
            border: 'none',
            borderBottom: '1px solid grey',
            padding: '5px 10px',
            fontSize: '14px'
          }}
          onKeyDown={(e) => {
            const disable = () => {
              e.preventDefault();
              e.stopPropagation();
            };
            if (e.key === 'ArrowDown') {
              disable();
              const firstCountry = filteredData[0];
              if (firstCountry)
                listItemRef.current[firstCountry.countryCode].focus();
            } else if (e.key === 'Escape') {
              disable();
              setShow(false);
            } else if (e.key === 'Enter') disable();
          }}
          onChange={(e) => setQuery(e.target.value.toLowerCase())}
          tabIndex={0}
        />
        {filteredData.map(({ flag, countryCode, countryName, phoneCode }) => {
          const onClick = () => {
            setCurCountryCode(countryCode);
            setRawNumber('');
            setFormattedNumber('');
            setShow(false);
            inputRef.current.focus();
          };
          return (
            <li
              key={countryCode}
              ref={(ref) => (listItemRef.current[countryCode] = ref)}
              css={{
                padding: '2px 10px',
                display: 'flex',
                alignItems: 'center',
                transition: '0.1s ease all',
                fontSize: '14px',
                '&:hover': {
                  backgroundColor: '#e6e6e6'
                },
                '&:focus-visible': {
                  outline: 'none',
                  backgroundColor: '#e6e6e6'
                }
              }}
              tabIndex={0}
              onKeyDown={(e) => {
                const disable = () => {
                  e.preventDefault();
                  e.stopPropagation();
                };
                if (e.key === 'Enter') {
                  disable();
                  onClick();
                } else if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
                  disable();
                  listItemRef.current[countryCode].nextSibling?.focus();
                } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
                  disable();
                  listItemRef.current[countryCode].previousSibling?.focus();
                }
              }}
              onClick={onClick}
            >
              <span css={{ fontSize: '24px', marginRight: '7px' }}>{flag}</span>
              {countryName}
              <span css={{ marginLeft: '7px', color: 'grey' }}>
                +{phoneCode}
              </span>
            </li>
          );
        })}
      </>
    );
  }, [query]);

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
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          overflowX: 'hidden',
          ...applyStyles.getTarget('sub-fc')
        }}
      >
        <div
          css={{
            position: 'absolute',
            cursor: 'pointer',
            height: '100%',
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
              <ul
                css={{
                  listStyleType: 'none',
                  padding: 0,
                  margin: 0,
                  backgroundColor: 'white',
                  cursor: 'pointer',
                  boxShadow: '0 0 4px rgb(0 0 0 / 15%)',
                  maxHeight: '210px',
                  overflowY: 'scroll',
                  overflowX: 'hidden',
                  width: '400px'
                }}
                {...props}
                ref={(ref) => {
                  dropdownRef.current = ref;
                  props.ref(ref);
                }}
              >
                {supportedCountries}
              </ul>
            );
          }}
        </Overlay>
        <input
          id={servar.key}
          css={{
            height: '100%',
            width: '100%',
            ...bootstrapStyles,
            ...applyStyles.getTarget('field'),
            ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
            '&:focus': applyStyles.getTarget('active'),
            '&:hover': applyStyles.getTarget('hover'),
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
                      (start <= formatted.length && !isNum(formatted[start])) ||
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
  );
}

export default memo(PhoneField);
