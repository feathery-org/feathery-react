import React, { memo } from 'react';

import { OverlayTrigger } from 'react-bootstrap';

function TextAutocomplete({
  allOptions = [],
  showOptions,
  onSelect = () => {},
  value = '',
  responsiveStyles,
  children
}: {
  allOptions: string[];
  showOptions: boolean;
  onSelect: (a: string) => void;
  value: string;
  responsiveStyles: any;
  children: any;
}) {
  const options = allOptions.filter((opt) =>
    opt.toLowerCase().includes(value.toLowerCase())
  );

  if (allOptions.length === 0) return children;
  else
    return (
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
            {options.map((opt) => (
              <li
                key={opt}
                css={{
                  padding: '8px 14px',
                  transition: '0.1s ease all',
                  '&:hover': { backgroundColor: '#e6e6e61a' }
                }}
                onClick={() => onSelect(opt)}
              >
                {opt}
              </li>
            ))}
          </ul>
        }
      >
        {children}
      </OverlayTrigger>
    );
}

export default memo(TextAutocomplete);
