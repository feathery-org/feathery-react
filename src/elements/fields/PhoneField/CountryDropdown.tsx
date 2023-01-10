import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';

import countryData, { firebaseSMSCountries } from './countryData';

function CountryDropdown({ show, hide, itemOnClick, ...props }: any, ref: any) {
  const listItemRef = useRef<Record<string, any>>({});
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!show) setQuery('');
  }, [show]);

  const countryItems = useMemo(() => {
    const filteredData = countryData.filter(
      ({ countryCode, countryName, phoneCode }) => {
        if (
          !global.libphonenumber?.isSupportedCountry(countryCode) ||
          (global.firebase && !firebaseSMSCountries.has(countryCode))
        )
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
              hide();
            } else if (e.key === 'Enter') disable();
          }}
          onChange={(e) => setQuery(e.target.value.toLowerCase())}
          tabIndex={0}
        />
        {filteredData.map(({ flag, countryCode, countryName, phoneCode }) => {
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
                '&:hover': { backgroundColor: '#e6e6e633' },
                '&:focus-visible': {
                  outline: 'none',
                  backgroundColor: '#e6e6e633'
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
                  itemOnClick(countryCode);
                } else if (['ArrowDown', 'ArrowRight'].includes(e.key)) {
                  disable();
                  listItemRef.current[countryCode].nextSibling?.focus();
                } else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) {
                  disable();
                  listItemRef.current[countryCode].previousSibling?.focus();
                }
              }}
              onClick={() => itemOnClick(countryCode)}
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

  return (
    <ul
      css={{
        zIndex: 1,
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
      ref={ref}
      {...props}
    >
      {countryItems}
    </ul>
  );
}

export default forwardRef(CountryDropdown);
