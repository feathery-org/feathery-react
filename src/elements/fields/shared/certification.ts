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
