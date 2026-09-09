import countryData from '../elements/components/data/countries';
import timeZoneCountries from '../elements/fields/PhoneField/timeZoneCountries';

export function getDefaultPhoneCountry(setting?: string): string {
  const country =
    setting === 'auto'
      ? timeZoneCountries[Intl.DateTimeFormat().resolvedOptions().timeZone]
          ?.c[0]
      : setting;
  return countryData.some(({ countryCode }) => countryCode === country)
    ? (country as string)
    : 'US';
}

export function normalizePhoneNumber(value: any, metadata: any, lib: any): any {
  if (!lib || !['string', 'number'].includes(typeof value)) return value;
  const input = String(value).trim();
  // Accept formatting, but do not extract numbers from prose or drop extensions.
  if (!/^\+?[\d\s().-]+$/.test(input)) return value;
  const digits = lib.parseDigits(input);
  const international = lib.parsePhoneNumberFromString(`+${digits}`);
  if (!input.startsWith('+')) {
    // Without an explicit international prefix, prefer the configured country
    // when both interpretations are valid (e.g. US area code 661 vs Thailand).
    const national = lib.parsePhoneNumberFromString(input, {
      defaultCountry: getDefaultPhoneCountry(metadata?.default_country),
      extract: false
    });
    if (national?.isValid()) return national.number.slice(1);
  }
  return international?.isValid() ? international.number.slice(1) : value;
}
