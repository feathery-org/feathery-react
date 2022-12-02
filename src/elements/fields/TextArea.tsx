import React, { memo } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles, ERROR_COLOR } from '../styles';

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
          ...responsiveStyles.getTarget('sub-fc')
        }}
      >
        <textarea
          id={servar.key}
          css={{
            height: '100%',
            width: '100%',
            resize: 'none',
            ...bootstrapStyles,
            ...responsiveStyles.getTarget('field'),
            ...(inlineError ? { borderColor: ERROR_COLOR } : {}),
            '&:focus': responsiveStyles.getTarget('active'),
            '&:hover': responsiveStyles.getTarget('hover'),
            '&:not(:focus)':
              rawValue || !element.properties.placeholder
                ? {}
                : { color: 'transparent !important' }
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onChange={onChange}
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
