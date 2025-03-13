import React, { memo } from 'react';

import { OverlayTrigger } from 'react-bootstrap';
import { FORM_Z_INDEX } from '../../../utils/styles';

function TextAutocomplete({
  allOptions = [],
  showOptions,
  onSelect = () => {},
  value = '',
  container,
  responsiveStyles,
  children
}: {
  allOptions: string[];
  showOptions: boolean;
  onSelect: (a: string) => void;
  value: string;
  container?: any;

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
        container={() => container?.current}
        overlay={
          <ul
            css={{
              zIndex: FORM_Z_INDEX,
              listStyleType: 'none',
              padding: 0,
              margin: 0,
              maxHeight: '210px',
              overflowY: 'scroll',
              overflowX: 'auto',
              width: '400px',
              backgroundColor: 'white',
              cursor: 'pointer',
              boxShadow: '0 0 4px rgb(0 0 0 / 15%)',
              ...responsiveStyles.getTarget('dropdown')
            }}
          >
            {options.map((opt, index) => (
              <li
                key={`${opt}-${index}`}
                css={{
                  padding: '8px 14px',
                  transition: '0.1s ease all',
                  '&:hover': { backgroundColor: '#e6e6e633' }
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
