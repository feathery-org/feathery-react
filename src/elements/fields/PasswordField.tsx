import React, { memo, useRef, useState } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/InlineTooltip';
import { bootstrapStyles } from '../styles';
import useBorder from '../components/useBorder';
import { FORM_Z_INDEX } from '../../utils/styles';
import { hoverStylesGuard } from '../../utils/browser';
import { HideEyeIcon, ShowEyeIcon } from '../components/icons';

function PasswordField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  disabled = false,
  repeatIndex = null,
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
  const [showPassword, setShowPassword] = useState(false);
  const containerRef = useRef(null);

  const servar = element.servar;
  const spacing = element.properties.tooltipText ? 30 : 8;
  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
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
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:hover': hoverStylesGuard(
            disabled
              ? {}
              : {
                  ...responsiveStyles.getTarget('hover'),
                  ...borderStyles.hover
                }
          )
        }}
      >
        <input
          id={servar.key}
          name={servar.key}
          css={{
            position: 'relative',
            // Position input above the border div
            zIndex: FORM_Z_INDEX,
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
          aria-label={element.properties.aria_label}
          maxLength={servar.max_length}
          minLength={servar.min_length}
          required={required}
          onChange={(e) => {
            if (servar.max_length && e.target.value.length > servar.max_length)
              return;
            onChange(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter(e);
          }}
          placeholder=''
          disabled={disabled}
          value={rawValue}
          ref={setRef}
          type={showPassword ? 'text' : 'password'}
        />
        {rawValue && (
          <div
            css={{
              position: 'absolute',
              cursor: 'pointer',
              insetInlineEnd: `${spacing}px`,
              // We need to subtract half the height of the icon to center it
              top: 'calc(50% - 12px)',
              zIndex: FORM_Z_INDEX
            }}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label='Toggle password visibility'
          >
            {showPassword ? <ShowEyeIcon /> : <HideEyeIcon />}
          </div>
        )}
        {customBorder}
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          container={containerRef}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}

export default memo(PasswordField);
