const DEFAULT_LENGTH = 1024; // Default limit on backend
const MAX_FIELD_LENGTHS: Record<string, number> = {
  text_area: 16384, // Max storage limit on backend column
  url: 256,
  gmap_zip: 10
};

export const maxFieldLength = (type: string) =>
  MAX_FIELD_LENGTHS[type] ?? DEFAULT_LENGTH;

function escapeDefinitionChars(str: string | undefined) {
  return (str ?? '')
    .replaceAll('0', '\\0')
    .replaceAll('a', '\\a')
    .replaceAll('b', '\\b')
    .replaceAll('*', '\\*');
}

// Stricter than escapeDefinitionChars, for affixes typed by form builders. An
// unescaped `{}` pulls its contents into the *unmasked* value (a suffix of
// "{x}" makes 1234.5 submit as "1234.5x"), and `[]` is silently swallowed.
function escapeMaskLiterals(str: string | undefined) {
  return (str ?? '').replace(/[\\0abc*[\]{}]/g, (char) => `\\${char}`);
}

function constraintChar(allowed: any) {
  switch (allowed) {
    case 'letters':
      return 'a';
    case 'alphanumeric':
      return 'b';
    case 'alphaspace':
      return 'c';
    case 'digits':
      return '0';
    default:
      return '*';
  }
}

export function getTextFieldMask(servar: any) {
  const data = servar.metadata;
  const prefix = escapeDefinitionChars(data.prefix);
  const suffix = escapeDefinitionChars(data.suffix);

  let mask = '';
  if (data.mask) mask = data.mask;
  else {
    let allowed = data.allowed_characters;
    if (servar.type === 'gmap_zip' && !allowed) allowed = 'alphaspace';
    const definitionChar = constraintChar(allowed);

    let numOptional =
      maxFieldLength(servar.type) - prefix.length - suffix.length;
    if (servar.max_length)
      numOptional = Math.min(servar.max_length, numOptional);

    mask = `[${definitionChar.repeat(numOptional)}]`;
  }

  // Approximate dynamic input by making each character optional
  return `${prefix}${mask}${suffix}`;
}

// Capped at 2 because submitted values land in a DecimalField(decimal_places=2)
// column, not because of any UI constraint.
const VALID_DECIMAL_PLACES = [0, 1, 2];
const DEFAULT_DECIMAL_PLACES = 2;
const DEFAULT_CURRENCY = 'USD';
const FALLBACK_CURRENCY_SYMBOL = '$';

// Defaults to 2 so number fields saved before decimal_places existed (metadata
// is `{}`) keep rendering exactly as they do today.
export function getDecimalPlaces(servar: any) {
  const raw = servar?.metadata?.decimal_places;
  if (typeof raw === 'number' || (typeof raw === 'string' && raw.trim()))
    return VALID_DECIMAL_PLACES.includes(Number(raw))
      ? Number(raw)
      : DEFAULT_DECIMAL_PLACES;
  return DEFAULT_DECIMAL_PLACES;
}

// en-US renders every currency we offer as a prefix, so one pattern covers all
// codes. Suffix placement is a locale property, and this mask is already
// en-US-only (hardcoded radix and separator).
function getCurrencyPrefix(code: string | undefined) {
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code || DEFAULT_CURRENCY
    }).formatToParts(1);
    const index = parts.findIndex((part) => part.type === 'currency');
    if (index < 0) return FALLBACK_CURRENCY_SYMBOL;
    const next = parts[index + 1];
    // Keep the trailing space of symbols like "CHF ".
    return parts[index].value + (next?.type === 'literal' ? next.value : '');
  } catch {
    // Intl throws RangeError on a malformed currency code.
    return FALLBACK_CURRENCY_SYMBOL;
  }
}

// Whether a number field renders its format wherever the value is shown
// outside its own input — today, text variables. Opt-in per field: fields saved
// before this existed have no key, so they keep interpolating the raw number.
export function showsFormatInText(servar: any) {
  return (
    servar?.type === 'integer_field' &&
    servar?.metadata?.show_format_in_text === true
  );
}

/**
 * Renders a stored number the way this field's own input mask renders it, for
 * consumers outside that input. Mirrors getNumberMaskProps: same precision,
 * grouping, zero-padding, and affixes, so a value never reads one way in the
 * field and another way in a text variable pointed at it.
 */
export function formatNumberValue(servar: any, value: any) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  // Anything non-numeric is passed through rather than rendered as NaN.
  if (isNaN(num)) return String(value);

  const meta = servar?.metadata ?? {};
  const scale = getDecimalPlaces(servar);
  const body = new Intl.NumberFormat('en-US', {
    useGrouping: meta.thousands_separator !== false,
    // imask only pads when padFractionalZeros is set; otherwise it shows just
    // the digits present, which is a floor of 0 fraction digits.
    minimumFractionDigits: meta.pad_decimals === true ? scale : 0,
    maximumFractionDigits: scale
  }).format(num);

  // imask keeps its mask literals outside the number block, so a negative
  // currency value renders as "$-1,234.56" in the input. Concatenate the same
  // way rather than using Intl's currency style, which would render
  // "-$1,234.56" and disagree with the field the value came from.
  if (servar?.format === 'currency')
    return `${getCurrencyPrefix(meta.currency)}${body}`;
  if (servar?.format === 'percentage') return `${body}%`;
  if (servar?.format === 'custom')
    return `${meta.prefix ?? ''}${body}${meta.suffix ?? ''}`;
  return body;
}

// imask discards the radix character entirely at scale 0, which would rewrite a
// stored 1234.56 as 123456 and echo that back through onAccept on mount. Snap
// to the configured precision first so the value only ever rounds.
export function roundToDecimalPlaces(value: any, scale: number) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return String(Number(num.toFixed(scale)));
}

export function getNumberMaskProps(servar: any, value: any) {
  const meta = servar.metadata ?? {};
  const scale = getDecimalPlaces(servar);
  const allowNegative = meta.allow_negative === true;

  let mask = 'num';
  if (servar.format === 'currency')
    mask = `${escapeDefinitionChars(getCurrencyPrefix(meta.currency))}num`;
  else if (servar.format === 'percentage') mask = 'num%';
  else if (servar.format === 'custom')
    mask = `${escapeMaskLiterals(meta.prefix)}num${escapeMaskLiterals(
      meta.suffix
    )}`;

  return {
    mask,
    blocks: {
      num: {
        mask: Number,
        radix: '.',
        thousandsSeparator: meta.thousands_separator === false ? '' : ',',
        scale,
        padFractionalZeros: meta.pad_decimals === true,
        // Larger numbers get converted to scientific notation when sent to backend
        max: servar.max_length ?? Number.MAX_SAFE_INTEGER,
        // A negative min is what enables imask's leading "-" (allowNegative is
        // derived from min < 0 || max < 0). `??` so a configured 0 is honored.
        min: allowNegative
          ? servar.min_length ?? -Number.MAX_SAFE_INTEGER
          : Math.max(0, servar.min_length ?? 0)
      }
    },
    value: roundToDecimalPlaces(value, scale),
    // Number values must stay numeric downstream; saving the mask would make
    // parseFloat('$1,234.56') NaN.
    unmask: true
  };
}
