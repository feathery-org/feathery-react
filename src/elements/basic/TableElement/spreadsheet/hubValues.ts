import countryData from '../../../components/data/countries';
import usStates from '../../../components/data/states/us';

/**
 * Hub values in the form the hub stores them.
 *
 * The hub converts loose zip, state and country input before validating it
 * ("California" -> CA, 021341234 -> 02134-1234). A cell has to do the same, or
 * it flags as invalid a value the hub would accept. Mirrors
 * `coerce_location_value` and `apps/hub/locations.py` in feathery-backend.
 */

type Place = { code: string; name: string };

export const US_STATES: Place[] = usStates;

// The data predates the Netherlands Antilles' 2010 dissolution (AN) and lacks
// a few current codes; this matches the hub's own country list.
export const COUNTRIES: Place[] = [
  ...countryData
    .filter(({ countryCode }) => countryCode !== 'AN')
    .map(({ countryCode, countryName }) => ({
      code: countryCode,
      name: countryName
    })),
  { code: 'AQ', name: 'Antarctica' },
  { code: 'BQ', name: 'Caribbean Netherlands' },
  { code: 'CW', name: 'Curaçao' },
  { code: 'EH', name: 'Western Sahara' },
  { code: 'SX', name: 'Sint Maarten' },
  { code: 'UM', name: 'U.S. Outlying Islands' }
];

// Common names the lists don't use; the backend's `_COUNTRY_ALIASES`.
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  'great britain': 'GB',
  'ivory coast': 'CI',
  'dr congo': 'CD',
  'cabo verde': 'CV'
};

/** Case, accents, punctuation and a leading "the" don't change a name. */
function nameKey(text: string) {
  const key = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.'’]/g, '')
    .replace(/[\W_]+/g, ' ')
    .trim();
  return key.startsWith('the ') ? key.slice(4) : key;
}

// The browser's English region names ("Czechia", "Türkiye") are CLDR's, the
// same short names the backend reads from babel.
function cldrNames(codes: string[]): Array<[string, string]> {
  try {
    const names = new Intl.DisplayNames(['en'], {
      type: 'region',
      fallback: 'none'
    });
    return codes.flatMap((code) => {
      const name = names.of(code);
      return name ? [[name, code] as [string, string]] : [];
    });
  } catch {
    return [];
  }
}

const byName = (pairs: Array<[string, string]>) =>
  new Map(pairs.map(([name, code]) => [nameKey(name), code]));

const STATE_CODES = new Set(US_STATES.map(({ code }) => code));
const STATE_BY_NAME = byName(US_STATES.map(({ code, name }) => [name, code]));
const COUNTRY_CODES = new Set(COUNTRIES.map(({ code }) => code));
const COUNTRY_BY_NAME = byName([
  ...COUNTRIES.map(({ code, name }): [string, string] => [name, code]),
  ...cldrNames([...COUNTRY_CODES]),
  ...Object.entries(COUNTRY_ALIASES)
]);

/** An upper-case code, or a name in any spelling. Lower-case codes aren't
 * trusted: "na" and "no" are missing-value markers, not Namibia and Norway. */
function placeCode(
  text: string,
  codes: Set<string>,
  names: Map<string, string>
) {
  if (codes.has(text)) return text;
  return names.get(nameKey(text)) ?? null;
}

// Digit counts a zip or zip+4 can have once a spreadsheet drops leading zeros.
const ZIP_NUMBER_LENGTHS = new Set([3, 4, 5, 7, 8, 9]);
// The dash, if any, has to sit after the fifth digit: 123-45-6789 isn't a zip.
const ZIP_INPUT = /^(\d{5})(?:[\s-]?(\d{4}))?$/;

function zipCode(text: string) {
  let digits = text;
  if (/^\d+$/.test(text) && ZIP_NUMBER_LENGTHS.has(text.length)) {
    digits = text.padStart(text.length <= 5 ? 5 : 9, '0');
  }
  const match = ZIP_INPUT.exec(digits);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

const CONVERTERS: Record<string, (text: string) => string | null> = {
  zip_code: zipCode,
  us_state: (text) => placeCode(text, STATE_CODES, STATE_BY_NAME),
  country_code: (text) => placeCode(text, COUNTRY_CODES, COUNTRY_BY_NAME)
};

/**
 * `text` in the form the hub stores for `type`, or `text` itself when the hub
 * wouldn't convert it either, so validation reports it.
 */
export function toStoredForm(type: string | undefined, text: string): string {
  const convert = type ? CONVERTERS[type] : undefined;
  if (!convert) return text;
  const trimmed = text.trim();
  return convert(trimmed) ?? text;
}
