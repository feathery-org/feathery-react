import React from 'react';

export default function Placeholder({
  value,
  element,
  applyStyles,
  type = 'input'
}) {
  return (
    <span
      css={{
        position: 'absolute',
        pointerEvents: 'none',
        left: '0.75rem',
        transition: '0.2s ease all',
        top: '0.375rem',
        ...applyStyles.getTarget('placeholder'),
        ...(value ? applyStyles.getTarget('placeholderFocus') : {}),
        [`${type}:focus + &`]: {
          ...applyStyles.getTarget('placeholderFocus'),
          ...applyStyles.getTarget('placeholderActive')
        }
      }}
    >
      {element.properties.placeholder || ''}
    </span>
  );
}
