import React, { memo } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/Tooltip';
import { bootstrapStyles } from '../styles';
import useBorder from '../components/useBorder';

function PasswordField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  editMode,
  onChange = () => {},
  onEnter = () => {},
  setRef = () => {},
  rawValue = '',
  inlineError,
  children
}: any) {
  const { borderStyles, customBorder, borderId } = useBorder({
    element,
    error: inlineError
  });

  const servar = element.servar;
  const disabled = element.properties.disabled ?? false;
  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
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
          whiteSpace: 'nowrap',
          overflowX: 'hidden',
          ...responsiveStyles.getTarget('sub-fc'),
          '&:hover': disabled
            ? {}
            : {
                ...responsiveStyles.getTarget('hover'),
                ...borderStyles.hover
              }
        }}
      >
        <input
          id={servar.key}
          css={{
            position: 'relative',
            // Position input above the border div
            zIndex: 1,
            height: '100%',
            width: '100%',
            border: 'none',
            backgroundColor: 'transparent',
            ...bootstrapStyles,
            ...responsiveStyles.getTarget('field'),
            [`&:focus ~ #${borderId}`]: Object.values(borderStyles.active)[0],
            '&:not(:focus)':
              rawValue || !element.properties.placeholder
                ? {}
                : { color: 'transparent !important' }
          }}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onChange={onChange}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter(e);
          }}
          autoComplete={servar.metadata.autocomplete || 'on'}
          placeholder=''
          disabled={disabled}
          value={rawValue}
          ref={setRef}
          type='password'
        />
        {customBorder}
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
        />
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}

export default memo(PasswordField);
