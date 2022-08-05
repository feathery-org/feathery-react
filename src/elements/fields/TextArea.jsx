import React, { memo } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';

function TextArea({
  element,
  applyStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  editable = false,
  onChange = () => {},
  setRef = () => {},
  rawValue = '',
  inlineError,
  children
}) {
  const servar = element.servar;
  return (
    <div
      css={{
        maxWidth: '100%',
        position: 'relative',
        pointerEvents: editable ? 'none' : 'auto',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          ...applyStyles.getTarget('sub-fc')
        }}
      >
        <textarea
          id={servar.key}
          css={{
            height: '100%',
            width: '100%',
            resize: 'none',
            ...bootstrapStyles,
            ...applyStyles.getTarget('field'),
            ...(inlineError ? { borderColor: '#F42525' } : {}),
            '&:focus': applyStyles.getTarget('active'),
            '&:hover': applyStyles.getTarget('hover'),
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
          applyStyles={applyStyles}
          type='textarea'
        />
        <InlineTooltip element={element} applyStyles={applyStyles} />
      </div>
      {children}
    </div>
  );
}

export default memo(TextArea);
