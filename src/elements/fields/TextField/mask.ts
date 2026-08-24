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
// imask rejects the radix outright at scale 0, and a rejected radix silently
// folds the fraction digits into the integer part: "12.5" becomes 125, "-0.4"
// becomes -4. Dropping the radix also drops the user's intent for the digits
// that follow it, so blocking the keystroke cannot help — the mask has to
// accept a decimal, and precision is applied on commit instead.
const MIN_ENTRY_SCALE = 1;
const DEFAULT_DECIMAL_PLACES = 2;
const DEFAULT_CURRENCY = 'USD';
const FALLBACK_CURRENCY_SYMBOL = '$';

/**
 * Decimal places the *input* accepts, as opposed to the precision the value is
 * stored at. Only ever wider than the configured precision, and only for
 * whole-number fields — see MIN_ENTRY_SCALE.
 */
export function getEntryDecimalPlaces(servar: any) {
  // Only whole-number fields are widened, and only by the one place needed to
  // make the radix typeable. Fields that already accept decimals keep their
  // exact entry behaviour, so this change cannot alter them.
  const scale = getDecimalPlaces(servar);
  return scale === 0 ? MIN_ENTRY_SCALE : scale;
}

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
 * The literal text a format wraps around the number. Returned unescaped —
 * callers building an imask pattern escape them for the mask grammar.
 */
function getFormatAffixes(servar: any) {
  const meta = servar?.metadata ?? {};
  switch (servar?.format) {
    case 'currency':
      return { prefix: getCurrencyPrefix(meta.currency), suffix: '' };
    case 'percentage':
      return { prefix: '', suffix: '%' };
    case 'custom':
      return { prefix: meta.prefix ?? '', suffix: meta.suffix ?? '' };
    default:
      return { prefix: '', suffix: '' };
  }
}

/**
 * Renders a stored number the way this field's own input mask renders it, for
 * consumers outside that input. Mirrors getNumberMaskProps: same precision,
 * grouping, zero-padding, affixes, and sign placement, so a value never reads
 * one way in the field and another way in a text variable pointed at it.
 */
export function formatNumberValue(servar: any, value: any) {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  // Anything non-numeric is passed through rather than rendered as NaN.
  if (isNaN(num)) return String(value);

  const meta = servar?.metadata ?? {};
  const scale = getDecimalPlaces(servar);
  // Format the magnitude, so the sign can go outside the affixes below.
  const body = new Intl.NumberFormat('en-US', {
    useGrouping: meta.thousands_separator !== false,
    // imask only pads when padFractionalZeros is set; otherwise it shows just
    // the digits present, which is a floor of 0 fraction digits.
    minimumFractionDigits: meta.pad_decimals === true ? scale : 0,
    maximumFractionDigits: scale
  }).format(Math.abs(num));

  const { prefix, suffix } = getFormatAffixes(servar);
  // The sign goes outside the prefix — "-$100", not "$-100" — matching the
  // input mask and how money reads everywhere else. A value that rounds away
  // to zero at this precision has no sign left to show, which is also what the
  // input renders once imask commits the rounding.
  const sign = num < 0 && /[1-9]/.test(body) ? '-' : '';
  return `${sign}${prefix}${body}${suffix}`;
}

// A sign the user has typed before any magnitude exists: "-", "-0", "-0.".
// imask reports these as soon as the key lands, but they carry no number to
// store.
const SIGN_WITHOUT_MAGNITUDE = /^-0*\.?0*$/;

/**
 * Whether a number field's in-progress value is only a sign. Form casts
 * integer_field values with parseFloat, so "-" becomes NaN and "-0"
 * stringifies back as "0"; either way, feeding one of these through form state
 * re-renders the controlled input without the sign the user just typed. Hold
 * the sign in the input instead, until a magnitude arrives.
 */
export function isSignWithoutMagnitude(value: any) {
  return typeof value === 'string' && SIGN_WITHOUT_MAGNITUDE.test(value);
}

function stringifyValue(value: any) {
  return value === null || value === undefined ? '' : String(value);
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

// `{}` marks a mask literal that stays in the *unmasked* value, so a sign
// carried by the pattern rather than by the number block still reaches the
// stored value.
const SIGN_LITERAL = '{-}';

// Whether a negative value is actually in range. imask derives a number
// block's own allowNegative from its bounds, so a floor at or above zero means
// there is no sign to render or accept.
function allowsNegative(servar: any) {
  if (servar.metadata?.allow_negative !== true) return false;
  return !(typeof servar.min_length === 'number' && servar.min_length >= 0);
}

// Bounds for a number block that holds the whole signed value.
function getValueBounds(servar: any) {
  return {
    // Larger numbers get converted to scientific notation when sent to backend
    max: servar.max_length ?? Number.MAX_SAFE_INTEGER,
    // A negative min is what enables imask's leading "-" (allowNegative is
    // derived from min < 0 || max < 0). `??` so a configured 0 is honored.
    min: allowsNegative(servar)
      ? servar.min_length ?? -Number.MAX_SAFE_INTEGER
      : Math.max(0, servar.min_length ?? 0)
  };
}

// Bounds for a number block whose sign has been pulled out into the pattern,
// leaving the block a magnitude. For the negative variant the value is -m, so
// min <= -m <= max is the same as -max <= m <= -min: the bounds invert and
// swap. Clamped at 0 because a magnitude is never negative.
function getMagnitudeBounds(servar: any, negative: boolean) {
  const low = servar.min_length ?? -Number.MAX_SAFE_INTEGER;
  const high = servar.max_length ?? Number.MAX_SAFE_INTEGER;
  const [min, max] = negative ? [-high, -low] : [low, high];
  return { min: Math.max(0, min), max: Math.max(0, max) };
}

/**
 * Whether the split-sign mask should use its signed variant.
 *
 * Reads the unmasked value, never the rendered one: the rendered value carries
 * the prefix, so a prefix like "-" or "US-" would read back as a sign, select
 * the signed variant, and have its `{-}` literal poison the stored number —
 * self-sustaining once it happens, since the sign then really is in the
 * unmasked value. The unmasked value is the user's number alone, and a sign the
 * user entered reaches it through the `{-}` literal by design.
 */
function isNegative(dynamicMasked: any, appended: string) {
  // A sign arriving as this keystroke is not in the value yet. Leading-only, so
  // pasting "US-100" into a "US-" field is not read as negative.
  if (appended.startsWith('-')) return true;
  return String(dynamicMasked.unmaskedValue ?? '').includes('-');
}

export function getNumberMaskProps(servar: any, value: any, editing = false) {
  const meta = servar.metadata ?? {};
  const scale = getDecimalPlaces(servar);
  const entryScale = getEntryDecimalPlaces(servar);
  const affixes = getFormatAffixes(servar);
  // escapeMaskLiterals rather than escapeDefinitionChars for both affixes: it
  // is a superset, it leaves every currency symbol we render untouched, and an
  // unescaped `{` in an affix would otherwise leak into the stored value.
  const prefix = escapeMaskLiterals(affixes.prefix);
  const suffix = escapeMaskLiterals(affixes.suffix);
  const pattern = `${prefix}num${suffix}`;

  const numberBlock = {
    mask: Number,
    radix: '.',
    thousandsSeparator: meta.thousands_separator === false ? '' : ',',
    scale: entryScale,
    // Guarded on the configured scale, not the entry scale, so a whole-number
    // field never renders "13.0".
    padFractionalZeros: meta.pad_decimals === true && scale > 0
  };
  const props = {
    // Rounding mid-entry would erase the radix the moment it is typed, so the
    // display only snaps to the configured precision once editing stops.
    value: editing ? stringifyValue(value) : roundToDecimalPlaces(value, scale),
    // Number values must stay numeric downstream; saving the mask would make
    // parseFloat('$1,234.56') NaN.
    unmask: true
  };

  // A prefix is a mask literal and imask keeps a number block's sign inside
  // that block, so "$num" renders -100 as "$-100". Where a prefix and negative
  // values meet, split the sign out as its own literal ahead of the prefix and
  // switch between the two patterns as the value's sign changes, so it reads
  // "-$100" the way money is written everywhere else.
  if (prefix && allowsNegative(servar))
    return {
      ...props,
      mask: [
        {
          mask: pattern,
          blocks: {
            num: { ...numberBlock, ...getMagnitudeBounds(servar, false) }
          },
          lazy: false
        },
        {
          mask: `${SIGN_LITERAL}${pattern}`,
          blocks: {
            num: { ...numberBlock, ...getMagnitudeBounds(servar, true) }
          },
          lazy: false
        }
      ],
      // A "-" typed at any caret position means the value is negative, and
      // dispatching on that is what moves the sign to the front. lazy has to be
      // set per variant above: MaskedDynamic does not pass it down.
      dispatch: (appended: string, dynamicMasked: any) =>
        dynamicMasked.compiledMasks[isNegative(dynamicMasked, appended) ? 1 : 0]
    };

  return {
    ...props,
    mask: pattern,
    blocks: { num: { ...numberBlock, ...getValueBounds(servar) } }
  };
}
