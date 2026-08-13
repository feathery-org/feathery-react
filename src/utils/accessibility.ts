/**
 * Resolves the accessible description of an image element.
 *
 * aria_label is the legacy property that alt_text replaced. The fallback is on
 * a blank alt_text rather than a missing one because both properties default to
 * '' rather than undefined, so an unset alt_text must still defer to a legacy
 * aria_label. Element properties come from a free-form JSON field, so neither
 * value is guaranteed to be a string.
 */
export function getImageAltText(properties: any): string {
  const altText = properties?.alt_text;
  if (typeof altText === 'string' && altText) return altText;
  const ariaLabel = properties?.aria_label;
  return typeof ariaLabel === 'string' ? ariaLabel : '';
}
