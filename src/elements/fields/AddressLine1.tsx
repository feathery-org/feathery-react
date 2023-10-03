import React, { memo, useCallback, useEffect, useState } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import Client from '../../utils/client';
import useMounted from '../../hooks/useMounted';

import debounce from 'lodash.debounce';
import { OverlayTrigger } from 'react-bootstrap';
import useBorder from '../components/useBorder';

// Milliseconds
const SEARCH_DELAY_TIME = 300;
const EXIT_DELAY_TIME = 200;

function AddressLine1({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  editMode,
  rightToLeft,
  onSelect = () => {},
  onBlur = () => {},
  onEnter = () => {},
  setRef = () => {},
  value = '',
  inlineError,
  children,
  ...props
}: any) {
  const servar = element.servar;
  const options = useAddressSearch(value, servar.metadata.address_autocomplete);
  const [showOptions, setShowOptions] = useState(false);
  const [focused, setFocused] = useState(false);
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });

  const disabled = element.properties.disabled ?? false;

  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
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
          '&:hover': disabled
            ? {}
            : {
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
        <OverlayTrigger
          placement='bottom-start'
          delay={{ show: 250, hide: 250 }}
          show={options.length > 0 && showOptions}
          overlay={
            <ul
              css={{
                zIndex: 1,
                listStyleType: 'none',
                padding: 0,
                margin: 0,
                backgroundColor: 'white',
                cursor: 'pointer',
                boxShadow: '0 0 4px rgb(0 0 0 / 15%)',
                ...responsiveStyles.getTarget('dropdown')
              }}
            >
              {options.map(({ display }) => (
                <li
                  key={display}
                  css={{
                    padding: '8px 14px',
                    transition: '0.1s ease all',
                    '&:hover': { backgroundColor: '#e6e6e633' }
                  }}
                  onClick={async () => {
                    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
                    const addressId = options.find(
                      (opt) => (opt as any).display === display
                    ).address_id;
                    const details = await new Client().addressDetail(addressId);
                    onSelect(details, addressId);
                  }}
                >
                  {display}
                </li>
              ))}
            </ul>
          }
        >
          <input
            id={servar.key}
            css={{
              position: 'relative',
              height: '100%',
              width: '100%',
              border: 'none',
              backgroundColor: 'transparent',
              ...bootstrapStyles,
              ...responsiveStyles.getTarget('field'),
              ...(focused || value || !element.properties.placeholder
                ? {}
                : { color: 'transparent !important' })
            }}
            maxLength={servar.max_length}
            minLength={servar.min_length}
            placeholder=''
            disabled={disabled}
            value={value}
            ref={setRef}
            // Not on focus because if error is showing, it will
            // keep triggering dropdown after blur
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter(e);
              else setShowOptions(e.key !== 'Escape');
            }}
            onFocus={() => setFocused(true)}
            onBlur={(e) => {
              // Blur may be triggered by option selection, and option
              // click logic may need to be run first. So delay option removal.
              setTimeout(() => setShowOptions(false), EXIT_DELAY_TIME);
              onBlur(e);
              setFocused(false);
            }}
            {...props}
          />
        </OverlayTrigger>
        <Placeholder
          value={value}
          element={element}
          responsiveStyles={responsiveStyles}
          rightToLeft={rightToLeft}
        />
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}

function useAddressSearch(searchTerm: any, active: any) {
  const mounted = useMounted();
  const [term, setTerm] = useState(searchTerm);
  const [results, setResults] = React.useState([]);

  const fetchAddresses = useCallback(
    debounce(
      (newTerm: any) =>
        new Client().addressSearchResults(newTerm).then((addresses) => {
          if (mounted.current) {
            setResults(addresses);
            setTerm(newTerm);
          }
        }),
      SEARCH_DELAY_TIME
    ),
    [setResults, setTerm]
  );

  useEffect(() => {
    const trimmedTerm = searchTerm.trim();
    if (active && trimmedTerm !== '' && searchTerm !== term) {
      fetchAddresses(trimmedTerm);
    }
  }, [searchTerm]);

  return results;
}

export default memo(AddressLine1);
