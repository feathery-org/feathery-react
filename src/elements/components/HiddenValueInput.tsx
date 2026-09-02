import React from 'react';

/**
 * Mirrors a field's value into a named, non-interactive form control.
 *
 * Some fields are built from divs and canvases rather than native inputs
 * (button groups, ratings, sliders, color pickers), so their value
 * never appears in the DOM under the field's key. Lead-certification scanners
 * such as TrustedForm read the submitted DOM to build their certificate, and
 * without this they record only "[unnamed div]".
 *
 * This is deliberately type="hidden" rather than reusing ErrorInput:
 * hidden inputs are barred from constraint validation, and setFormElementError
 * filters them out, so mirroring a value never interferes with error display.
 */
export default function HiddenValueInput({
  name,
  value
}: {
  name: string;
  value: any;
}) {
  return (
    <input
      type='hidden'
      name={name}
      value={value === null || value === undefined ? '' : String(value)}
    />
  );
}
