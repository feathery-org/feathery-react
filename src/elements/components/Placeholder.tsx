import React from 'react';

export default function Placeholder({
  value,
  element,
  responsiveStyles,
  type = 'input',
  inputFocused = false,
  repeatIndex = null
}: any) {
  const props = element.properties;
  const repeatPlaceholders = props.repeat_placeholder ?? [];
  const placeholder =
    repeatPlaceholders[repeatIndex ?? 0] ?? (props.placeholder || '');

  // getTargets, not a spread of getTarget calls: each target carries its own
  // @media block, and spreading two of them lets the second replace the first.
  // That dropped the resting label's mobile lineHeight -- the line box the
  // pinned label's reserve is computed from -- whenever the label was pinned.
  const focusedStyles = responsiveStyles.getTargets(
    'placeholderFocus',
    'placeholderActive'
  );
  return (
    <span
      css={{
        position: 'absolute',
        pointerEvents: 'none',
        insetInlineStart: '0.75rem',
        transition: '0.2s ease all',
        top: type === 'input' ? '50%' : '0.6rem',
        ...responsiveStyles.getTargets(
          'placeholder',
          value ? 'placeholderFocus' : '',
          inputFocused ? 'placeholderFocus' : '',
          inputFocused ? 'placeholderActive' : ''
        ),
        [`${type}:focus ~ &`]: focusedStyles
      }}
    >
      {placeholder}
    </span>
  );
}
