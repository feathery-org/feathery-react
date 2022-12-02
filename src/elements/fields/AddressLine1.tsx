import React, { memo, useCallback, useEffect, useState } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles, ERROR_COLOR } from '../styles';
import Client from '../../utils/client';
import useMounted from '../../utils/useMounted';

// @ts-expect-error TS(7016): Could not find a declaration file for module 'loda... Remove this comment to see the full error message
import debounce from 'lodash.debounce';
import { OverlayTrigger } from 'react-bootstrap';

// Milliseconds
const SEARCH_DELAY_TIME = 300;
const EXIT_DELAY_TIME = 200;

function AddressLine1({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  editMode,
  onSelect = () => {},
  onBlur = () => {},
  setRef = () => {},
  value = '',
  inlineError,
  children,
  ...props
}: any) {
  const servar = element.servar;
  const options = useAddressSearch(value, servar.metadata.address_autocomplete);
  const [showOptions, setShowOptions] = useState(false);

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
          position: 'relative',
          width: '100%',
          ...responsiveStyles.getTarget('sub-fc')
        }}
      >
        <OverlayTrigger
          placement='bottom-start'
          delay={{ show: 250, hide: 250 }}
          show={options.length > 0 && showOptions}
          overlay={
            <ul
              css={{
                listStyleType: 'none',
                padding: 0,
                margin: 0,
                backgroundColor: 'white',
                cursor: 'pointer',
                boxShadow: '0 0 4px rgb(0 0 0 / 15%)'
              }}
            >
              {options.map(({ display }) => (
                <li
                  key={display}
                  css={{
                    padding: '16px',
                    transition: '0.1s ease all',
                    '&:hover': {
                      backgroundColor: '#e6e6e6'
                    }
                  }}
                  onClick={async () => {
                    // @ts-expect-error TS(2532): Object is possibly 'undefined'.
                    const addressId = options.find(
                      (opt) => (opt as any).display === display
                    ).address_id;
                    const details = await new Client().addressDetail(addressId);
                    onSelect(details);
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
              height: '100%',
              width: '100%',
              ...bootstrapStyles,
              ...responsiveStyles.getTarget('field'),
              ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
              '&:focus': responsiveStyles.getTarget('active'),
              '&:hover': responsiveStyles.getTarget('hover'),
              '&:not(:focus)':
                value || !element.properties.placeholder
                  ? {}
                  : { color: 'transparent !important' }
            }}
            maxLength={servar.max_length}
            minLength={servar.min_length}
            placeholder=''
            value={value}
            ref={setRef}
            // Not on focus because if error is showing, it will
            // keep triggering dropdown after blur
            onKeyDown={() => setShowOptions(true)}
            onBlur={(e) => {
              // Blur may be triggered by option selection, and option
              // click logic may need to be run first. So delay option removal.
              setTimeout(() => setShowOptions(false), EXIT_DELAY_TIME);
              onBlur(e);
            }}
            {...props}
          />
        </OverlayTrigger>
        <Placeholder
          value={value}
          element={element}
          responsiveStyles={responsiveStyles}
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
