import { isValidPhoneLength } from '../elements/fields/PhoneField/validation';
import countryData from '../elements/components/data/countries';
import timeZoneCountries from '../elements/fields/PhoneField/timeZoneCountries';

export function getDefaultPhoneCountry(setting?: string): string {
  const country =
    setting === 'auto'
      ? timeZoneCountries[Intl.DateTimeFormat().resolvedOptions().timeZone]
          ?.c[0]
      : setting?.toUpperCase();
  return countryData.some(({ countryCode }) => countryCode === country)
    ? (country as string)
    : 'US';
}

const isSupportedPhoneNumber = (number: any) =>
  !!number?.isValid() &&
  isValidPhoneLength(number.number.slice(1), number.country);

export function isCanonicalPhoneNumber(value: any, lib: any): boolean {
  if (!lib || typeof value !== 'string' || !/^\d+$/.test(value)) return false;
  const parsed = lib.parsePhoneNumberFromString(`+${value}`);
  return isSupportedPhoneNumber(parsed) && parsed.number === `+${value}`;
}

/** Shared cleanup for complete values and the phone input's partial typing. */
export function cleanPhoneNumberInput(value: string, lib: any): string | null {
  const input = value
    .trim()
    .replace(/[\u0660-\u0669\u06f0-\u06f9\uff10-\uff19]/g, (digit) =>
      lib.parseDigits(digit)
    )
    .replace(
      /[＋（）．－]/g,
      (character) =>
        ({ '＋': '+', '（': '(', '）': ')', '．': '.', '－': '-' }[
          character
        ] as string)
    )
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s/g, ' ');
  // Accept common phone formatting, but never extract a number from prose,
  // silently discard an extension, or treat dial pauses as number separators.
  return /^\+?[\d\s()./-]+$/.test(input) ? input : null;
}

/** Normalize complete values; leave incomplete or unsupported values for validation. */
export function normalizePhoneNumber(
  value: any,
  metadata: any,
  lib: any,
  preserveCanonical = false
): any {
  if (!lib || !['string', 'number'].includes(typeof value)) return value;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0))
    return value;
  // Keep saved international digits stable when they also form a valid local
  // number (e.g. Thailand's 6612345678 vs US area code 661).
  if (preserveCanonical && isCanonicalPhoneNumber(value, lib)) return value;
  const input = cleanPhoneNumberInput(String(value), lib);
  if (input === null) return value;
  const digits = lib.parseDigits(input);
  // 00 is an explicit international prefix in imported/contact data even
  // when the field's default country normally uses a different dialing prefix.
  const internationalPrefix = !input.startsWith('+') && digits.startsWith('00');
  const international = lib.parsePhoneNumberFromString(
    `+${internationalPrefix ? digits.slice(2) : digits}`
  );
  if (internationalPrefix)
    return isSupportedPhoneNumber(international)
      ? international.number.slice(1)
      : value;
  if (!input.startsWith('+')) {
    const defaultCountry = getDefaultPhoneCountry(metadata?.default_country);
    // Recognize an already included calling code for the configured country.
    // Some variable-length plans (Germany) also accept it as a local area code.
    if (
      isSupportedPhoneNumber(international) &&
      international.countryCallingCode ===
        lib.getCountryCallingCode(defaultCountry)
    )
      return international.number.slice(1);
    // An explicit country setting supplies missing information. Without '+',
    // a valid national interpretation wins over an ambiguous international one.
    const national = lib.parsePhoneNumberFromString(input, {
      defaultCountry,
      extract: false
    });
    if (isSupportedPhoneNumber(national)) return national.number.slice(1);
  }
  return isSupportedPhoneNumber(international)
    ? international.number.slice(1)
    : value;
}
