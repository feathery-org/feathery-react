/**
 * Resolves the accessible name for a field's interactive control.
 *
 * Feathery renders its placeholder as an absolutely-positioned <span> and only
 * renders a <label htmlFor> when the field has a name, so a placeholder-only
 * field is completely anonymous in the DOM. That breaks assistive tech and it
 * breaks lead-certification scanners like TrustedForm, which fall back to
 * "[unnamed div]" when a control has no name, id, or label to read.
 *
 * A visible <label> already names the control and an aria-label would override
 * it for screen readers, so we only fall back when there is no visible label.
 */
export function fieldAriaLabel(element: any): string | undefined {
  const properties = element?.properties ?? {};
  if (properties.aria_label) return properties.aria_label;

  const servar = element?.servar;
  // A visible <label htmlFor> is rendered whenever the servar has a name
  if (servar?.name) return undefined;

  return properties.placeholder || servar?.key || undefined;
}
