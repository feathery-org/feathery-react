import countryData from '../../components/data/countries';
import timeZoneCountries from './timeZoneCountries';

const countryPhoneCodeMap: Record<string, string> = countryData.reduce(
  (acc, { countryCode, phoneCode }) => {
    acc[countryCode] = phoneCode;
    return acc;
  },
  {} as Record<string, string>
);

export const countryMaxLengthMap: Record<string, number> = {
  // India (+91) numbers are 10-digits except for machine to machine communication
  IN: 2 + 10,
  // Singapore (+65) numbers are 8-digits except for special service numbers
  SG: 2 + 8
};

/**
 * Best-effort country detection from the browser's timezone. Returns
 * undefined if no timezone is available or it doesn't map to a known
 * country in countryData. Safe to call in non-browser environments.
 */
export function getBrowserCountry(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return undefined;
    const country = timeZoneCountries[tz]?.c?.[0];
    if (country && country in countryPhoneCodeMap) return country;
    return undefined;
  } catch {
    return undefined;
  }
}

export function isValidPhoneLength(
  phoneNumber: string, // includes country code digits
  countryCode: string
): boolean {
  // country not in override mapping
  if (!(countryCode in countryMaxLengthMap)) return true;
  if (phoneNumber.length > countryMaxLengthMap[countryCode]) return false;
  return true;
}

export interface ResolvedPhoneNumber {
  /** Digits-only number, possibly with a country code prepended. */
  fullNumber: string;
  /** Country to display in the dropdown. */
  countryCode: string;
  /** True if `fullNumber` differs from the input — caller should propagate via onComplete. */
  changed: boolean;
}

const parseAsInternational = (LPN: any, candidate: string) =>
  LPN.parsePhoneNumberFromString?.(`+${candidate}`) ?? null;

const validateStrict = (LPN: any, candidate: string) => {
  const parsed = parseAsInternational(LPN, candidate);
  return parsed?.isValid?.() ? parsed : null;
};

const validatePossible = (LPN: any, candidate: string) => {
  const parsed = parseAsInternational(LPN, candidate);
  return parsed?.isPossible?.() ? parsed : null;
};

/**
 * Resolve a phone number to a complete international number plus matching
 * country. Used for both external loads (form value, logic rule) and
 * interactive paste.
 *
 * Resolution order:
 *   1. The value as-is, strictly valid international.
 *   2. Every country — accept only if exactly one strictly validates.
 *      (Dedupes NANP — US/CA/BS share +1, count as one match.)
 *   3. Selected country, length-possible (paste only; pass undefined for
 *      external loads — external data shouldn't be reinterpreted under
 *      whichever country the user happens to be looking at).
 *   4. Default country, length-possible (catches reserved-area-code numbers
 *      like the US 555-prefix that strict validation rejects).
 *   5. Browser-detected country, length-possible.
 *
 * If nothing matches, the value is left unchanged with country set to the
 * configured default — better than mis-classifying via prefix match.
 */
export function resolvePhoneNumber(
  LPN: any,
  fullNumber: string,
  defaultCountry: string,
  browserCountry?: string,
  selectedCountry?: string
): ResolvedPhoneNumber {
  const hasExplicitPlus =
    typeof fullNumber === 'string' && fullNumber.includes('+');
  const digitsOnly = fullNumber ? LPN.parseDigits(fullNumber) : '';
  if (!digitsOnly) {
    return { fullNumber, countryCode: defaultCountry, changed: false };
  }

  // 1) Strictly valid international — only when the input had an explicit
  // "+". Without that signal, a 10-digit NANP number like "6465553210" would
  // strict-validate as +64 NZ (libphonenumber considers it a real number),
  // even though the user clearly meant a US 646 area code. The "+" is the
  // user's intent flag for "treat this as international".
  if (hasExplicitPlus) {
    const asInternational = validateStrict(LPN, digitsOnly);
    if (asInternational) {
      return reconcileCountry(LPN, {
        fullNumber: digitsOnly,
        countryCode: asInternational.country ?? defaultCountry,
        changed: digitsOnly !== fullNumber
      });
    }
  }

  // 2) Try every country; accept only if exactly one strict match.
  // Dedupe by candidate so NANP countries (sharing +1) count as one match.
  const candidates = new Map<string, string>();
  for (const { countryCode, phoneCode } of countryData) {
    const candidate = `${phoneCode}${digitsOnly}`;
    if (candidates.has(candidate)) continue;
    const parsed = validateStrict(LPN, candidate);
    if (parsed) {
      candidates.set(candidate, parsed.country ?? countryCode);
    }
  }
  if (candidates.size === 1) {
    const [candidate, country] = candidates.entries().next().value as [
      string,
      string
    ];
    return reconcileCountry(LPN, {
      fullNumber: candidate,
      countryCode: country,
      changed: true
    });
  }

  // 3-5) Try selected (paste only), default, then browser, length-possible.
  // For each priority country we try TWO interpretations:
  //   (a) digits already include the country code (e.g. "14165550199" under
  //       US/CA — CA fictional ranges fall here),
  //   (b) digits are national-format, prepend the country code.
  // Only accept the parsed country when it shares the same phone code as
  // the iteration country — otherwise libphonenumber may have re-interpreted
  // the digits as a different country (e.g. "+5551234567" → BR), which is
  // exactly the misclassification we want to avoid for external loads.
  const lenientCountries = [
    ...new Set(
      [selectedCountry, defaultCountry, browserCountry].filter(
        (c): c is string => !!c
      )
    )
  ];
  for (const country of lenientCountries) {
    const phoneCode = countryPhoneCodeMap[country];
    if (!phoneCode) continue;

    // (a) digits-as-is — only when they start with this country's phone code.
    if (digitsOnly.startsWith(phoneCode)) {
      const parsed = validatePossible(LPN, digitsOnly);
      if (
        parsed?.country &&
        countryPhoneCodeMap[parsed.country] === phoneCode
      ) {
        return reconcileCountry(LPN, {
          fullNumber: digitsOnly,
          countryCode: parsed.country,
          changed: digitsOnly !== fullNumber
        });
      }
    }

    // (b) prepend the country code.
    const candidate = `${phoneCode}${digitsOnly}`;
    const parsed = validatePossible(LPN, candidate);
    if (parsed) {
      const useParsed =
        parsed.country && countryPhoneCodeMap[parsed.country] === phoneCode;
      return reconcileCountry(LPN, {
        fullNumber: candidate,
        countryCode: useParsed ? parsed.country : country,
        changed: true
      });
    }
  }

  // No match. Keep the value, country = configured default, but verified
  // by the safety check below.
  return reconcileCountry(LPN, {
    fullNumber: digitsOnly,
    countryCode: defaultCountry,
    changed: digitsOnly !== fullNumber
  });
}

/**
 * Final safety check: ensure the resolved country's phoneCode is actually a
 * prefix of the resolved digits. If not, override with whatever
 * libphonenumber detects from the digits — keeps the dropdown flag in sync
 * with the value and prevents the input becoming uneditable (the onChange
 * guard requires the rawNumber to start with the active country's phoneCode).
 */
function reconcileCountry(
  LPN: any,
  result: ResolvedPhoneNumber
): ResolvedPhoneNumber {
  if (!result.fullNumber || !result.countryCode) return result;
  const phoneCode = countryPhoneCodeMap[result.countryCode];
  if (phoneCode && result.fullNumber.startsWith(phoneCode)) return result;

  const parsed = LPN.parsePhoneNumberFromString?.(`+${result.fullNumber}`);
  const detectedCountry = parsed?.country;
  if (detectedCountry && countryPhoneCodeMap[detectedCountry]) {
    return { ...result, countryCode: detectedCountry };
  }
  return result;
}
