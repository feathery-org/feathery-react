import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/InlineTooltip';
import { resetStyles } from '../styles';
import FeatheryClient from '../../utils/featheryClient';
import useMounted from '../../hooks/useMounted';
import debounce from 'lodash.debounce';
import useBorder from '../components/useBorder';
import Overlay from '../components/Overlay';
import { DROPDOWN_Z_INDEX } from './index';
import { hoverStylesGuard, iosScrollOnFocus } from '../../utils/browser';

const SEARCH_DELAY_TIME_MS = 500;
const EXIT_DELAY_TIME_MS = 200;

function AddressLine1({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  disabled = false,
  autoComplete,
  editMode,
  repeatIndex = null,
  onSelect = () => {},
  onChange = () => {},
  required,
  onBlur = () => {},
  onEnter = () => {},
  setRef = () => {},
  value = '',
  inlineError,
  children
}: any) {
  const servar = element.servar;
  const options = useAddressSearch(value, servar);
  const [showOptions, setShowOptions] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef(null);

  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });

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
        css={{
          position: 'relative',
          width: '100%',
          // Prevent placeholder overflow
          overflowX: 'clip',
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
        <input
          id={servar.key}
          name={servar.key}
          css={{
            position: 'relative',
            height: '100%',
            width: '100%',
            border: 'none',
            margin: 0,
            backgroundColor: 'transparent',
            ...resetStyles,
            ...responsiveStyles.getTarget('field'),
            ...(focused || value || !element.properties.placeholder
              ? {}
              : { color: 'transparent !important' })
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          placeholder=''
          disabled={disabled}
          aria-label={element.properties.aria_label}
          autoComplete={
            autoComplete === 'on' ? 'street-address' : 'new-password'
          }
          value={value}
          ref={(ref) => {
            inputRef.current = ref;
            setRef(ref);
          }}
          onKeyDown={(e) => {
            if (!e.isTrusted || !e.code) return;
            if (e.key === 'Enter') onEnter(e);
            else setShowOptions(e.key !== 'Escape');
          }}
          onFocus={(event) => {
            setFocused(true);
            iosScrollOnFocus(event);
          }}
          onBlur={(e) => {
            setTimeout(() => setShowOptions(false), EXIT_DELAY_TIME_MS);
            onBlur(e);
            setFocused(false);
          }}
          onChange={onChange}
          required={required}
        />

        <Overlay
          show={showOptions && options.length > 0}
          target={inputRef.current}
          container={containerRef.current}
          placement='bottom-start'
          offset={4}
          onHide={() => setShowOptions(false)}
        >
          <ul
            css={{
              zIndex: DROPDOWN_Z_INDEX,
              listStyleType: 'none',
              padding: 0,
              margin: 0,
              backgroundColor: 'white',
              cursor: 'pointer',
              boxShadow: '0 0 4px rgb(0 0 0 / 15%)',
              ...responsiveStyles.getTarget('dropdown')
            }}
          >
            {options.map(({ display, address_id: addressId }) => (
              <li
                key={display}
                css={{
                  padding: '8px 14px',
                  transition: '0.1s ease all',
                  '&:hover': hoverStylesGuard({
                    backgroundColor: '#e6e6e633'
                  })
                }}
                onClick={async () => {
                  const details = await new FeatheryClient().addressDetail(
                    addressId
                  );
                  onSelect(details, addressId);
                  setShowOptions(false);
                  inputRef.current?.focus();
                }}
              >
                {display}
              </li>
            ))}
          </ul>
        </Overlay>
        <Placeholder
          value={value}
          element={element}
          responsiveStyles={responsiveStyles}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          container={containerRef.current}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}

function useAddressSearch(searchTerm: any, servar: any) {
  const meta = servar.metadata;
  const active = meta.address_autocomplete;
  const country = meta.autocomplete_country ?? '';
  const mounted = useMounted();
  const [term, setTerm] = useState(searchTerm);
  const [results, setResults] = useState<any[]>([]);

  const fetchAddresses = useCallback(
    debounce((newTerm: string) => {
      new FeatheryClient()
        .addressSearchResults(newTerm, country, servar.type === 'gmap_city')
        .then((addresses) => {
          if (mounted.current) {
            setResults(addresses);
            setTerm(newTerm);
          }
        });
    }, SEARCH_DELAY_TIME_MS),
    [setResults, setTerm]
  );

  useEffect(() => {
    const trimmedTerm = searchTerm.trim();
    if (!active || trimmedTerm === term) return;
    if (trimmedTerm.length > 3) fetchAddresses(trimmedTerm);
    else {
      if (results.length) setResults([]);
      setTerm(trimmedTerm);
    }
  }, [searchTerm]);

  return results;
}

export default memo(AddressLine1);
