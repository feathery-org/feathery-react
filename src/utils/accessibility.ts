/**
 * Resolves the accessible description of an image element.
 *
 * aria_label is the legacy property that alt_text replaced. The fallback is
 * truthy rather than nullish because both properties default to '' rather than
 * undefined, so an unset alt_text must still defer to a legacy aria_label.
 */
export function getImageAltText(properties: any) {
  return properties?.alt_text || properties?.aria_label || '';
}
