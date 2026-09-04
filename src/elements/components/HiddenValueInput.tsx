import React, { useEffect, useRef } from 'react';

/**
 * Mirrors a field's value into a named, non-interactive form control.
 *
 * Some fields are built from divs and canvases rather than native inputs
 * (button groups, ratings, sliders, color pickers), so their value never
 * appears in the DOM under the field's key. Lead-certification scanners such
 * as TrustedForm read the submitted DOM to build their certificate, and
 * without this they record only "[unnamed div]".
 *
 * Scanners also learn values from the input/change events a native control
 * fires as the user edits it. Setting `value` programmatically fires nothing,
 * so each change is re-announced with synthetic events. They are untrusted
 * (isTrusted=false), which a scanner may choose to ignore; that is the limit
 * of what a page can do.
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
  const ref = useRef<HTMLInputElement>(null);
  const rendered = value === null || value === undefined ? '' : String(value);
  const lastAnnounced = useRef(rendered);

  useEffect(() => {
    if (rendered === lastAnnounced.current) return;
    lastAnnounced.current = rendered;
    const input = ref.current;
    if (!input) return;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [rendered]);

  return <input ref={ref} type='hidden' name={name} value={rendered} />;
}
