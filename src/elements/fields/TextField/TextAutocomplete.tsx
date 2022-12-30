import React, { memo } from 'react';

import { OverlayTrigger } from 'react-bootstrap';

function TextAutocomplete({
  allOptions = [],
  showOptions,
  onSelect = () => {},
  value = '',
  children
}: {
  allOptions: string[];
  showOptions: boolean;
  onSelect: (a: string) => void;
  value: string;
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
              listStyleType: 'none',
              padding: 0,
              margin: 0,
              backgroundColor: 'white',
              cursor: 'pointer',
              boxShadow: '0 0 4px rgb(0 0 0 / 15%)'
            }}
          >
            {options.map((opt) => (
              <li
                key={opt}
                css={{
                  padding: '16px',
                  transition: '0.1s ease all',
                  '&:hover': { backgroundColor: '#e6e6e6' }
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
