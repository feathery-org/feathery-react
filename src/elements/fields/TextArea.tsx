import React, { memo, useState } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import useBorder from '../components/useBorder';

function TextArea({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  editMode,
  onChange = () => {},
  setRef = () => {},
  rawValue = '',
  inlineError,
  children
}: any) {
  const [focused, setFocused] = useState(false);
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });

  const servar = element.servar;
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
          ...responsiveStyles.getTarget('sub-fc'),
          '&:hover': {
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
        <textarea
          id={servar.key}
          css={{
            position: 'relative',
            height: '100%',
            width: '100%',
            border: 'none',
            backgroundColor: 'transparent',
            resize: 'none',
            ...bootstrapStyles,
            padding: '0.5rem 0.75rem',
            ...responsiveStyles.getTarget('field'),
            ...(focused || rawValue || !element.properties.placeholder
              ? {}
              : { color: 'transparent !important' })
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoComplete={servar.metadata.autocomplete || 'on'}
          placeholder=''
          value={rawValue}
          rows={element.styles.num_rows}
          ref={setRef}
        />
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
          type='textarea'
        />
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}

export default memo(TextArea);
