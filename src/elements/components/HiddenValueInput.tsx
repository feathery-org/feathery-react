import React from 'react';

/**
 * Mirrors a field's value into a named, non-interactive form control.
 *
 * Some fields are built from divs, svgs or third-party widgets rather than
 * native inputs (button groups, ratings, sliders, color pickers, multiselects),
 * so their value never appears in the DOM under the field's key and anything
 * that reads the form DOM (autofill, analytics, form scanners) sees nothing.
 *
 * This is deliberately type="hidden" rather than reusing ErrorInput: hidden
 * inputs are barred from constraint validation, and setFormElementError
 * filters them out, so mirroring a value never interferes with error display.
 */
export default function HiddenValueInput({
  name,
  value
}: {
  name: string;
  value: any;
}) {
  const rendered = value === null || value === undefined ? '' : String(value);
  return <input type='hidden' name={name} value={rendered} />;
}
