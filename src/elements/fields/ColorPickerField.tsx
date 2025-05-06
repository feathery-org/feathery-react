import React, { useState } from 'react';
import { FORM_Z_INDEX } from '../../utils/styles';
import { Sketch } from '@uiw/react-color';

function alphaToHex(alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const hexVal = Math.round(clampedAlpha * 255);
  return hexVal.toString(16).toUpperCase().padStart(2, '0');
}

function ColorPickerField({
  element,
  fieldLabel,
  responsiveStyles,
  fieldVal = 'FFFFFFFF',
  editMode,
  onChange = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
  const [showPicker, setShowPicker] = useState(false);
  return (
    <div
      css={{
        maxWidth: '100%',
        width: '100%',
        position: 'relative',
        pointerEvents: editMode || disabled ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          width: '100%',
          background: `#${fieldVal}`,
          cursor: 'pointer',
          ...responsiveStyles.getTarget('field')
        }}
        onClick={() => {
          if (!editMode && !disabled)
            setShowPicker((showPicker) => !showPicker);
        }}
      />
      {showPicker ? (
        <div
          css={{
            position: 'absolute',
            zIndex: FORM_Z_INDEX + 1
          }}
        >
          <div
            css={{
              position: 'fixed',
              top: '0px',
              right: '0px',
              bottom: '0px',
              left: '0px'
            }}
            onClick={() => setShowPicker(false)}
          />
          <Sketch
            aria-label={element.properties.aria_label}
            color={`#${fieldVal}`}
            onChange={(color) => {
              const hex = color.hex.substring(1, 7);
              const alpha = alphaToHex(color.rgba.a);
              onChange(`${hex}${alpha}`);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default ColorPickerField;
