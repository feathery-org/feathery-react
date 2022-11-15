import React from 'react';

export default function Placeholder({
  value,
  element,
  applyStyles,
  type = 'input',
  inputFocused = false
}: any) {
  const focusedStyles = {
    ...applyStyles.getTarget('placeholderFocus'),
    ...applyStyles.getTarget('placeholderActive')
  };
  return (
    <span
      css={{
        position: 'absolute',
        pointerEvents: 'none',
        left: '0.75rem',
        transition: '0.2s ease all',
        top: type === 'input' ? '50%' : '0.375rem',
        ...applyStyles.getTarget('placeholder'),
        ...(value ? applyStyles.getTarget('placeholderFocus') : {}),
        ...(inputFocused ? focusedStyles : {}),
        [`${type}:focus + &`]: focusedStyles
      }}
    >
      {element.properties.placeholder || ''}
    </span>
  );
}
