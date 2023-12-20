import React, { memo, useState } from 'react';

import Placeholder from '../components/Placeholder';
import InlineTooltip from '../components/InlineTooltip';
import { bootstrapStyles } from '../styles';
import useBorder from '../components/useBorder';
import BorderlessEyeIcon from '../components/icons/BorderlessEyeIcon';
import { FORM_Z_INDEX } from '../../utils/styles';

function PasswordField({
  element,
  responsiveStyles,
  fieldLabel,
  elementProps = {},
  required = false,
  disabled = false,
  editMode,
  rightToLeft,
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

  const servar = element.servar;
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
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
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
              right: '8px',
              // We need to subtract half the height of the icon to center it
              top: 'calc(50% - 12px)',
              zIndex: FORM_Z_INDEX
            }}
          >
            <BorderlessEyeIcon
              open={showPassword}
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label='Toggle password visibility'
            />
          </div>
        )}
        {customBorder}
        <Placeholder
          value={rawValue}
          element={element}
          responsiveStyles={responsiveStyles}
          rightToLeft={rightToLeft}
        />
        <InlineTooltip element={element} responsiveStyles={responsiveStyles} />
      </div>
    </div>
  );
}

export default memo(PasswordField);
