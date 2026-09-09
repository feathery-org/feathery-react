import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';

import {
  cleanPhoneNumberInput,
  getDefaultPhoneCountry,
  isCanonicalPhoneNumber,
  normalizePhoneNumber
} from '../../../utils/phoneNumber';
import Placeholder from '../../components/Placeholder';
import InlineTooltip from '../../components/InlineTooltip';
import { inputBoxAttrs, resetStyles } from '../../styles';
import countryData from '../../components/data/countries';
import exampleNumbers from './exampleNumbers';
import { isNum } from '../../../utils/primitives';
import * as validation from '../../../utils/validation';
import CountryDropdown from './CountryDropdown';
import useBorder from '../../components/useBorder';
import { hoverStylesGuard, iosScrollOnFocus } from '../../../utils/browser';
import { isValidPhoneLength } from './validation';
import Overlay from '../../components/Overlay';
import useElementSize from '../../../hooks/useElementSize';

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
  const triggerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLElement>(null);
  const fieldWrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<any>(null);
  const inputRef = useRef<any>(null);
  const replacingNumber = useRef(false);
  const replacementCountry = useRef<string | null>(null);
  const [replacementDraft, setReplacementDraft] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [cursorTick, setCursorTick] = useState(0);
  const [show, setShow] = useState(false);
  // The number parsed from the fullNumber prop, updated via triggerOnChange to rawNumber
  const [curFullNumber, setCurFullNumber] = useState('');
  const servar = element.servar;
  const defaultCountry = useMemo(
    () => getDefaultPhoneCountry(servar.metadata.default_country),
    [servar.metadata.default_country]
  );
  const [curCountryCode, setCurCountryCode] = useState<string>(defaultCountry);

  useEffect(() => setCurCountryCode(defaultCountry), [defaultCountry]);

  useEffect(() => {
    try {
      // Serve the flag font from our own bundle rather than the polyfill's
      // default jsDelivr CDN, so all resources load from Feathery-controlled
      // origins. The .woff2 is vendored from country-flag-emoji-polyfill and
      // emitted as a sibling asset by webpack/rollup; `new URL(...,
      // import.meta.url)` resolves it relative to wherever the bundle is served.
      const fontUrl = new URL('./TwemojiCountryFlags.woff2', import.meta.url)
        .href;
      polyfillCountryFlagEmojis('Twemoji Country Flags', fontUrl);
    } catch {
      // Gracefully degrade if polyfill fails (e.g. in test environments)
    }
  }, []);

  const phoneCode = countryMap[curCountryCode].phoneCode;
  // The raw number entered by the user, including phone code
  const [rawNumber, setRawNumber] = useState('');
  const [placeholder, setPlaceholder] = useState<string>(
    element.properties.placeholder
  );
  const [focused, setFocused] = useState(false);
  const { width: dropdownWidth } = useElementSize(fieldWrapperRef);

  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });

  const minCursorForPhoneCode = (code: string) =>
    code.length + (code.length > 3 ? 2 : 1);

  // cursorTick forces the effect to re-run even when position is unchanged
  // (e.g. re-focusing on the "+1" prefix)
  const moveCursor = (pos: number) => {
    setCursor(pos);
    setCursorTick((t) => t + 1);
  };

  const resetToPhoneCode = (code: string) => {
    moveCursor(minCursorForPhoneCode(code));
  };

  const clampCursorAfterPhoneCode = (input: HTMLInputElement | null) => {
    if (!input) return;
    if (replacingNumber.current) {
      setCursor(input.selectionStart);
      return;
    }
    const minCursor = minCursorForPhoneCode(phoneCode);
    const start = input.selectionStart ?? minCursor;
    if (start >= minCursor) {
      setCursor(start);
      return;
    }
    const cursor =
      rawNumber.length > phoneCode.length ? input.value.length : minCursor;
    input.setSelectionRange(cursor, cursor);
    setCursor(cursor);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (input && cursor !== null) input.setSelectionRange(cursor, cursor);
  }, [cursorTick]);

  useEffect(() => {
    // Keep an untouched empty field available for the focus prefix, but reparse
    // saved values when the default country changes so their flag stays correct.
    if (
      ((!fullNumber || replacingNumber.current) &&
        fullNumber === curFullNumber) ||
      editMode
    )
      return;

    let cancelled = false;
    validation.phoneLibPromise.then((LPN: any) => {
      if (!LPN || cancelled) return;

      const normalized = normalizePhoneNumber(
        fullNumber,
        servar.metadata,
        LPN,
        true
      );
      const value = normalized == null ? '' : String(normalized);
      const ayt = new LPN.AsYouType();
      ayt.input(`+${value}`);
      const numberObj = ayt.getNumber() ?? '';
      setCurFullNumber(fullNumber);
      setRawNumber(value);
      replacingNumber.current = false;
      setReplacementDraft(null);
      if (numberObj) {
        setCurCountryCode(
          countryMap[numberObj.country] ? numberObj.country : defaultCountry
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fullNumber, defaultCountry, editMode]);

  const formattedNumber = useMemo(() => {
    if (replacementDraft !== null) return replacementDraft;
    // handle blurred and empty input
    if (rawNumber === '') return '';
    // Unrecognized external values must remain visible for correction.
    if (!/^\d+$/.test(rawNumber)) return rawNumber;
    const LPN = validation.phoneLib;
    if (!LPN) return `+${rawNumber}`;

    const asYouType = new LPN.AsYouType(curCountryCode);
    const onlyDigits = LPN.parseDigits(rawNumber, curCountryCode);
    return asYouType.input(`+${onlyDigits}`);
  }, [curCountryCode, rawNumber, replacementDraft]);

  useEffect(() => {
    const elPlaceholder = element.properties.placeholder ?? '';
    if (editMode || elPlaceholder) {
      setPlaceholder(elPlaceholder);
      return;
    }

    const exampleNumber = exampleNumbers[curCountryCode];
    validation.phoneLibPromise.then((LPN: any) => {
      if (!LPN) return;

      setPlaceholder(
        LPN.parsePhoneNumber(
          exampleNumber,
          curCountryCode
        ).formatInternational()
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
    >
      {children}
      {fieldLabel}
      <div
        ref={fieldWrapperRef}
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
        {...inputBoxAttrs(servar.type)}
      >
        {customBorder}
        <div
          data-testid='country-trigger'
          css={{
            transition: '0.2s ease all',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 6px',
            position: 'relative',
            cursor: 'default',
            fontFamily: '"Twemoji Country Flags", sans-serif',
            ...responsiveStyles.getTarget('fieldToggle'),
            ...enabledCountryStyles
          }}
          ref={triggerRef}
          onClick={() => {
            if (countriesEnabled && !disabled) setShow(!show);
          }}
        >
          {countryMap[curCountryCode].flag}
        </div>
        <Overlay
          key={`overlay-${curCountryCode}`}
          show={show}
          onHide={() => setShow(false)}
          targetRef={triggerRef}
          containerRef={containerRef}
          placement='bottom-start'
          offset={0}
        >
          <CountryDropdown
            itemOnClick={(countryCode: string, phoneCode: string) => {
              replacingNumber.current = false;
              setReplacementDraft(null);
              setCurCountryCode(countryCode);
              setRawNumber(phoneCode);
              resetToPhoneCode(phoneCode);
              setShow(false);
              handleOnComplete(phoneCode);
              inputRef.current.focus();
            }}
            responsiveStyles={responsiveStyles}
            dropdownWidth={dropdownWidth}
            ref={(ref: any) => {
              dropdownRef.current = ref;
            }}
            show={show}
          />
        </Overlay>
        <div
          css={{
            position: 'relative',
            width: '100%',
            whiteSpace: 'nowrap',
            // Prevent placeholder overflow
            overflowX: 'clip'
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
              margin: 0,
              ...(rightToLeft ? { textAlign: 'right' } : {}),
              ...resetStyles,
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
            // Many modern browsers do not support autocomplete="off".
            // In order to avoid the autoComplete, use autocomplete="new-password"
            // @See: https://developer.mozilla.org/en-US/docs/Web/Security/Practical_implementation_guides/Turning_off_form_autocompletion
            autoComplete={autoComplete === 'on' ? 'tel' : 'new-password'}
            dir='ltr' // always left-to-right numbers but will be right justified in RTL
            onFocus={(e) => {
              iosScrollOnFocus(e);
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
            onClick={(e) => {
              clampCursorAfterPhoneCode(e.currentTarget);
            }}
            onBlur={() => {
              replacingNumber.current = false;
              setReplacementDraft(null);
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
              const input = e.currentTarget;
              if (
                (e.key.length === 1 ||
                  e.key === 'Backspace' ||
                  e.key === 'Delete') &&
                !e.ctrlKey &&
                !e.metaKey &&
                input.selectionStart === 0 &&
                input.selectionEnd === input.value.length
              ) {
                replacingNumber.current = true;
                replacementCountry.current = curCountryCode;
              }
              if (e.key === 'Enter') {
                replacingNumber.current = false;
                setReplacementDraft(null);
                handleOnComplete(rawNumber);
                onEnter(e);
              } else if (
                e.key === '+' &&
                countriesEnabled &&
                !disabled &&
                !replacingNumber.current
              ) {
                setShow(true);
              }
            }}
            onChange={(e) => {
              let start = e.target.selectionStart;
              let newNum = e.target.value;
              if (newNum) {
                const LPN = validation.phoneLib;
                if (!LPN) return;
                // Handle pasted numbers:
                // If there are multiple plus symbols, take everything after the last one
                const plusCount = (newNum.match(/\+/g) || []).length;
                if (plusCount > 1) {
                  const lastPlusIndex = newNum.lastIndexOf('+');
                  newNum = newNum.slice(lastPlusIndex);
                }

                // Complete replacements (paste, autocomplete and autofill) can
                // contain national trunk prefixes or a different country code.
                let normalized = normalizePhoneNumber(
                  newNum,
                  {
                    ...servar.metadata,
                    default_country: replacingNumber.current
                      ? replacementCountry.current
                      : curCountryCode
                  },
                  LPN
                );
                // A full number may be typed after the focus prefix. Keep
                // both interpretations until a duplicated prefix is provable.
                const inputDigits = LPN.parseDigits(newNum);
                const duplicatePrefix =
                  !replacingNumber.current &&
                  inputDigits.startsWith(`${phoneCode}${phoneCode}`)
                    ? `+${inputDigits.slice(phoneCode.length)}`
                    : null;
                if (duplicatePrefix && !isCanonicalPhoneNumber(normalized, LPN))
                  normalized = normalizePhoneNumber(
                    duplicatePrefix,
                    servar.metadata,
                    LPN
                  );
                const complete = isCanonicalPhoneNumber(normalized, LPN);
                if (replacingNumber.current) {
                  const cleaned = cleanPhoneNumberInput(newNum, LPN);
                  // A lone + is a meaningful intermediate international input.
                  if (cleaned === null && newNum !== '+') return;
                  const draft = cleaned ?? '+';
                  setReplacementDraft(draft);
                  setRawNumber(complete ? normalized : draft);
                  if (complete) {
                    const parsed = LPN.parsePhoneNumberFromString(
                      `+${normalized}`
                    );
                    if (countryMap[parsed?.country])
                      setCurCountryCode(parsed.country);
                    handleOnComplete(normalized);
                  }
                  moveCursor(start ?? draft.length);
                  return;
                }
                replacingNumber.current = false;
                setReplacementDraft(null);
                let nextCountry = curCountryCode;
                if (complete) {
                  newNum = `+${normalized}`;
                  const parsed = LPN.parsePhoneNumberFromString(newNum);
                  if (countryMap[parsed?.country]) nextCountry = parsed.country;
                } else {
                  // Keep partial typing, but never extract a plausible phone
                  // number from prose, extensions or otherwise invalid input.
                  const cleaned = cleanPhoneNumberInput(newNum, LPN);
                  if (cleaned === null) return;
                  newNum = cleaned.replace(/\s/g, '');
                  if (!newNum.includes('+')) {
                    newNum = newNum.startsWith(phoneCode)
                      ? `+${newNum}`
                      : `+${phoneCode}${newNum}`;
                  }
                  // Protect the selected prefix while editing a partial number.
                  if (!newNum.startsWith(`+${phoneCode}`)) return;
                  if (newNum.startsWith('+11')) return;
                }
                const onlyDigits = LPN.parseDigits(newNum);
                if (
                  LPN.validatePhoneNumberLength(
                    duplicatePrefix && !complete
                      ? duplicatePrefix
                      : `+${onlyDigits}`
                  ) === 'TOO_LONG' ||
                  !isValidPhoneLength(
                    duplicatePrefix && !complete
                      ? duplicatePrefix.slice(1)
                      : onlyDigits,
                    nextCountry
                  )
                )
                  return;

                const asYouType = new LPN.AsYouType(nextCountry);
                const newFormatted = asYouType.input(`+${onlyDigits}`);
                setCurCountryCode(nextCountry);
                const prevNumDigits = LPN.parseDigits(
                  formattedNumber.slice(0, cursor ?? 0)
                ).length;

                setRawNumber(onlyDigits);
                // Commit valid numbers immediately (same check as the form
                // validator) so a stale "invalid phone" error clears while
                // typing instead of waiting for blur
                if (isCanonicalPhoneNumber(onlyDigits, LPN))
                  handleOnComplete(onlyDigits);
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
              } else if (replacingNumber.current) {
                setReplacementDraft('');
                setRawNumber('');
                start = 0;
              } else {
                setReplacementDraft(null);
                setRawNumber(phoneCode);
                start = minCursorForPhoneCode(phoneCode);
              }

              moveCursor(start ?? 0);
            }}
          />
          {placeholder && (
            <Placeholder
              value={formattedNumber}
              element={{ properties: { placeholder } }}
              responsiveStyles={responsiveStyles}
              repeatIndex={repeatIndex}
            />
          )}
          <InlineTooltip
            containerRef={containerRef}
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
