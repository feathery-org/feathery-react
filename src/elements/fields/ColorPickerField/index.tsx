import React, { useState } from 'react';
import { FORM_Z_INDEX } from '../../../utils/styles';
import { unstyledButton } from '../../styles';
import HiddenValueInput from '../../components/HiddenValueInput';
import Sketch from '@uiw/react-color-sketch';
import { fieldAriaLabel } from '../shared/accessibleName';

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
  const servar = element.servar;
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
      {/* A real button rather than a div so the swatch is keyboard operable
          and carries a name on TrustedForm certificates. The name is suffixed
          so setFormElementError never resolves the field key to this button:
          its BUTTON branch expects a ButtonElement with an #error_ child. */}
      <button
        type='button'
        name={`${servar.key}-swatch`}
        value={fieldVal}
        aria-label={fieldAriaLabel(element)}
        aria-expanded={showPicker}
        aria-disabled={editMode || disabled}
        css={{
          ...unstyledButton,
          width: '100%',
          cursor: 'pointer',
          ...responsiveStyles.getTarget('field'),
          background: `#${fieldVal}`
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
            aria-label={fieldAriaLabel(element)}
            color={`#${fieldVal}`}
            onChange={(color) => {
              const hex = color.hex.substring(1, 7);
              const alpha = alphaToHex(color.rgba.a);
              onChange(`${hex}${alpha}`);
            }}
          />
        </div>
      ) : null}
      <HiddenValueInput name={servar.key} value={fieldVal} />
    </div>
  );
}

export default ColorPickerField;
