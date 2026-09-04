// Field types whose values must never be recorded in plain text by a
// lead-certification scanner.
const SENSITIVE_SERVAR_TYPES = new Set(['ssn', 'password', 'payment_method']);

/**
 * Attributes telling a certification scanner to hash a value rather than
 * record it. TrustedForm reads data-tf-sensitive; other scanners ignore it.
 */
export function sensitiveFieldProps(element: any) {
  return SENSITIVE_SERVAR_TYPES.has(element?.servar?.type)
    ? { 'data-tf-sensitive': 'true' }
    : {};
}

export const MAX_CERTIFICATION_NAME_LENGTH = 64;

/**
 * First non-empty candidate, whitespace-collapsed and capped, for use as the
 * readable name a certification scanner records against an element.
 */
export function certificationName(...candidates: any[]): string | undefined {
  for (const candidate of candidates) {
    const name = (candidate ?? '').toString().replace(/\s+/g, ' ').trim();
    if (name) return name.slice(0, MAX_CERTIFICATION_NAME_LENGTH);
  }
  return undefined;
}

/**
 * Spread onto elements with no native naming attribute (div, span, video).
 * TrustedForm documents `name` as the attribute it reads, and browsers ignore
 * it outside form controls, so it names the element for a certificate without
 * changing behaviour or accessibility. Not for inputs: their name is their key.
 */
export function certificationNameProps(
  ...candidates: any[]
): Record<string, string> {
  const name = certificationName(...candidates);
  return name ? { name } : {};
}

/** The file name from an asset URL, since a full signed URL is unreadable. */
export function assetName(src: any): string | undefined {
  if (!src || typeof src !== 'string') return undefined;
  let path = src.split(/[?#]/)[0];
  try {
    path = new URL(src).pathname;
  } catch {
    // relative or data URL: keep the raw path
  }
  const file = path.split('/').filter(Boolean).pop();
  return file || src;
}
