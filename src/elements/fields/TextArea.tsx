import React, { memo, useState } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/InlineTooltip';
import { bootstrapStyles } from '../styles';
import useBorder from '../components/useBorder';
import { hoverStylesGuard } from '../../utils/browser';

function TextArea({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  disabled = false,
  editMode,
  rightToLeft,
  onChange = () => {},
  setRef = () => {},
  rawValue = '',
  inlineError,
  repeatIndex = null,
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
        width: '100%',
        height: '100%',
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
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:hover': hoverStylesGuard(
            disabled
              ? {}
              : {
                  ...responsiveStyles.getTarget('hover'),
                  ...borderStyles.hover
                }
          ),
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
          aria-label={element.properties.aria_label}
          maxLength={servar.max_length || 4096}
          minLength={servar.min_length}
          required={required}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder=''
          disabled={disabled}
          value={rawValue}
          rows={element.styles.num_rows}
          ref={setRef}
        />
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
          type='textarea'
          rightToLeft={rightToLeft}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
        />
      </div>
    </div>
  );
}

export default memo(TextArea);
