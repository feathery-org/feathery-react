// Deterministic numeric-cell parsing, arithmetic and rendering for the
// document engine's computed table writes (`set_cell_computed`).
//
// The contract this module exists to keep: THE ENGINE COMPUTES, NOT THE MODEL.
// The model chooses which table, which column and which target cell; every
// numeric decision below - what a cell is worth, what the total is, and what
// bytes land in the target cell - is deterministic code with unit tests.
//
// Format is inherited from the document by construction, never guessed: a cell
// is parsed into (value, format descriptor) and results are re-rendered
// through a format descriptor read from the target cell itself (falling back
// to the column's dominant format when the target is blank/non-numeric). A
// `$36,803` cell can therefore never come back as `36803`.
//
// Arithmetic is exact scaled-integer arithmetic on JS safe integers (the repo
// targets ES5, so BigInt is unavailable): a value is `units * 10^-scale` with
// `units` a safe integer. Anything that would leave the safe range is a
// refusal, never a silently-wrong float.

export interface NumericValue {
  /** Signed integer count of 10^-scale units. Always a JS safe integer. */
  units: number;
  /** Decimal places: value = units / 10^scale. */
  scale: number;
}

export interface CellNumberFormat {
  /** Verbatim text before the numeric body (currency symbol, labels). */
  prefix: string;
  /** Verbatim text after the numeric body (%, trailing currency, units). */
  suffix: string;
  /** Grouping separator character, or '' when none was observed. */
  thousandsSeparator: string;
  /**
   * True when the integer part was long enough to prove grouping presence or
   * absence. A 3-digit-or-shorter integer part observes nothing: `$984` says
   * nothing about how `$1,284,350` should group.
   */
  groupingObserved: boolean;
  decimalSeparator: '.' | ',';
  decimals: number;
  /** How this cell rendered a negative value; 'none' for non-negative cells. */
  negativeStyle: 'none' | 'minus' | 'parens';
  /** `$-12` (true) vs `-$12` (false); meaningful only for 'minus'. */
  minusAfterPrefix: boolean;
}

export interface ParsedNumericCell {
  value: NumericValue;
  format: CellNumberFormat;
  /**
   * Normalized unit token for compatibility checks (currency symbol/code or
   * '%'), '' for a bare number. Two cells with different non-empty units must
   * never be summed.
   */
  unit: string;
}

const MAX_SIGNIFICANT_DIGITS = 15; // < 2^53 in every case

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Digits plus every separator character a numeric core may contain: `.`,
// `,`, apostrophes (Swiss grouping) and space / no-break space / narrow
// no-break space (SI and French grouping).
const NUMERIC_CORE = /\d[\d.,'\u2019\u00A0\u202F ]*\d|\d/;
const MINUS_CHARS = /[-\u2212]/;

interface CoreTokens {
  groups: string[];
  seps: string[];
}

function tokenizeCore(core: string): CoreTokens | null {
  const groups: string[] = [];
  const seps: string[] = [];
  let current = '';
  for (const ch of core) {
    if (ch >= '0' && ch <= '9') {
      current += ch;
      continue;
    }
    // Two adjacent separators ("1,,234", "1, 234") are not a number.
    if (!current) return null;
    groups.push(current);
    current = '';
    seps.push(ch);
  }
  if (!current) return null;
  groups.push(current);
  return { groups, seps };
}

function isValidGrouping(groups: string[]): boolean {
  if (groups.length < 2) return false;
  if (groups[0].length < 1 || groups[0].length > 3) return false;
  // "0,500" is not five hundred; a grouped leading "0" is never grouping.
  if (groups[0] === '0' || groups[0].startsWith('0')) return false;
  for (let i = 1; i < groups.length; i++) {
    if (groups[i].length !== 3) return false;
  }
  return true;
}

function allSame(list: string[]): boolean {
  return list.every((item) => item === list[0]);
}

/** The unit token adjacent to the number, for mixed-unit refusals only. */
function unitToken(prefix: string, suffix: string): string {
  const prefixWords = prefix.trim().split(/\s+/).filter(Boolean);
  const lastPrefixWord = prefixWords[prefixWords.length - 1] ?? '';
  const prefixUnit = lastPrefixWord.length <= 4 ? lastPrefixWord : '';
  const suffixWords = suffix.trim().split(/\s+/).filter(Boolean);
  const firstSuffixWord = suffixWords[0] ?? '';
  const suffixUnit = firstSuffixWord.length <= 4 ? firstSuffixWord : '';
  return `${prefixUnit}${suffixUnit}`;
}

/**
 * Parse one cell's verbatim text into an exact value plus the format
 * descriptor needed to re-render another value in the same shape.
 *
 * Deterministic separator rules (documented behaviour, each unit-tested):
 * - Two distinct separator characters: the last one is the decimal separator
 *   (must occur exactly once, last); the other must form valid 3-digit
 *   grouping. `1.234,56` and `1,234.56` both parse.
 * - One character, several occurrences: grouping; groups must be 1-3 then 3s.
 * - One character, one occurrence: decimal separator when 1-2 or 4+ digits
 *   follow, grouping when exactly 3 digits follow with a valid leading group.
 *   (`$36,803` is 36803; `12,34` is 12.34; `3.14159` is 3.14159.)
 * - Space / apostrophe separators are grouping-only, never decimal.
 * Anything violating these rules - `1,23,456`, `1,,234`, two numbers in one
 * cell - returns null: an unparseable cell is REPORTED, never guessed at and
 * never treated as zero.
 */
export function parseNumericCell(rawText: string): ParsedNumericCell | null {
  let text = String(rawText ?? '').trim();
  if (!text) return null;

  let negativeStyle: CellNumberFormat['negativeStyle'] = 'none';
  const parens = /^\((.*)\)$/.exec(text);
  if (parens && /\d/.test(parens[1])) {
    negativeStyle = 'parens';
    text = parens[1].trim();
  }

  const coreMatch = NUMERIC_CORE.exec(text);
  if (!coreMatch) return null;
  const core = coreMatch[0];
  let prefix = text.slice(0, coreMatch.index);
  const suffix = text.slice(coreMatch.index + core.length);
  // More than one number in the cell ("$100 - $200") is not a single value.
  if (/\d/.test(prefix) || /\d/.test(suffix)) return null;
  if (MINUS_CHARS.test(suffix)) return null; // trailing minus unsupported

  let minusAfterPrefix = false;
  const minusMatches = prefix.match(/[-−]/g) ?? [];
  if (minusMatches.length > 1) return null;
  if (minusMatches.length === 1) {
    if (negativeStyle === 'parens') return null; // "(-1)" is not a format
    negativeStyle = 'minus';
    minusAfterPrefix = !/^\s*[-−]/.test(prefix);
    prefix = prefix.replace(MINUS_CHARS, '');
  }

  const tokens = tokenizeCore(core);
  if (!tokens) return null;
  const { groups, seps } = tokens;

  let intDigits: string;
  let fracDigits = '';
  let thousandsSeparator = '';
  let groupingObserved = false;
  let decimalSeparator: '.' | ',' = '.';

  const distinct = Array.from(new Set(seps));
  if (distinct.length === 0) {
    intDigits = groups[0];
    groupingObserved = groups[0].length > 3;
  } else if (distinct.length === 1) {
    const sep = distinct[0];
    if (seps.length > 1) {
      // Repeated separator: grouping only.
      if (!isValidGrouping(groups)) return null;
      intDigits = groups.join('');
      thousandsSeparator = sep;
      groupingObserved = true;
      decimalSeparator = sep === ',' ? '.' : sep === '.' ? ',' : '.';
    } else {
      const tail = groups[1];
      const groupingLegal = isValidGrouping(groups);
      if (tail.length === 3 && groupingLegal) {
        intDigits = groups.join('');
        thousandsSeparator = sep;
        groupingObserved = true;
        decimalSeparator = sep === ',' ? '.' : sep === '.' ? ',' : '.';
      } else if (sep === '.' || sep === ',') {
        decimalSeparator = sep;
        intDigits = groups[0];
        fracDigits = tail;
      } else {
        // Space/apostrophe can only group; invalid grouping is unparseable.
        return null;
      }
    }
  } else if (distinct.length === 2) {
    const decimal = seps[seps.length - 1];
    if (decimal !== '.' && decimal !== ',') return null;
    if (seps.filter((s) => s === decimal).length !== 1) return null;
    const grouping = seps.slice(0, -1);
    if (!allSame(grouping)) return null;
    if (!isValidGrouping(groups.slice(0, -1))) return null;
    decimalSeparator = decimal;
    thousandsSeparator = grouping[0];
    groupingObserved = true;
    intDigits = groups.slice(0, -1).join('');
    fracDigits = groups[groups.length - 1];
  } else {
    return null;
  }

  const significant = (intDigits + fracDigits).replace(/^0+/, '');
  if (significant.length > MAX_SIGNIFICANT_DIGITS) return null;

  const magnitude = Number(intDigits + fracDigits);
  const negative = negativeStyle !== 'none';
  const value: NumericValue = {
    units: negative ? -magnitude : magnitude,
    scale: fracDigits.length
  };
  return {
    value,
    format: {
      prefix,
      suffix,
      thousandsSeparator,
      groupingObserved,
      decimalSeparator,
      decimals: fracDigits.length,
      negativeStyle,
      minusAfterPrefix
    },
    unit: unitToken(prefix, suffix)
  };
}

// ---------------------------------------------------------------------------
// Exact scaled-integer arithmetic
// ---------------------------------------------------------------------------

function pow10(n: number): number {
  let out = 1;
  for (let i = 0; i < n; i++) out *= 10;
  return out;
}

function safeUnits(units: number): boolean {
  return Number.isSafeInteger(units);
}

/**
 * Rescale a value to `scale` decimals exactly. Scaling down is only exact when
 * the dropped digits are zero; anything else returns null (precision loss must
 * be a visible refusal, not a silent rounding).
 */
export function rescaleExact(
  value: NumericValue,
  scale: number
): NumericValue | null {
  if (scale === value.scale) return value;
  if (scale > value.scale) {
    const factor = pow10(scale - value.scale);
    const units = value.units * factor;
    return safeUnits(units) ? { units, scale } : null;
  }
  const factor = pow10(value.scale - scale);
  if (value.units % factor !== 0) return null;
  return { units: value.units / factor, scale };
}

function toCommonScale(values: NumericValue[]): NumericValue[] | null {
  const scale = values.reduce((max, v) => Math.max(max, v.scale), 0);
  const out: NumericValue[] = [];
  for (const v of values) {
    const rescaled = rescaleExact(v, scale);
    if (!rescaled) return null;
    out.push(rescaled);
  }
  return out;
}

export type ComputeOperation = 'sum' | 'average' | 'min' | 'max' | 'count';

export const COMPUTE_OPERATIONS: readonly ComputeOperation[] = [
  'sum',
  'average',
  'min',
  'max',
  'count'
];

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function groupDigits(digits: string, separator: string): string {
  if (!separator) return digits;
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += separator;
  }
  return out;
}

/**
 * Render `value` exactly as `format` describes, byte-for-byte in the target
 * cell's own shape. The caller must have rescaled `value` to exactly
 * `format.decimals` (rescaleExact); a mismatch here is a programming error.
 */
export function renderNumericCell(
  value: NumericValue,
  format: CellNumberFormat
): string {
  if (value.scale !== format.decimals) {
    throw new Error(
      `renderNumericCell: value scale ${value.scale} != format decimals ${format.decimals}`
    );
  }
  const magnitude = Math.abs(value.units);
  const digits = String(magnitude).padStart(format.decimals + 1, '0');
  const intDigits = digits.slice(0, digits.length - format.decimals);
  const fracDigits = format.decimals
    ? digits.slice(digits.length - format.decimals)
    : '';
  const body =
    groupDigits(intDigits, format.thousandsSeparator) +
    (format.decimals ? format.decimalSeparator + fracDigits : '');
  if (value.units < 0) {
    const style =
      format.negativeStyle === 'none' ? 'minus' : format.negativeStyle;
    if (style === 'parens') return `(${format.prefix}${body}${format.suffix})`;
    return format.minusAfterPrefix
      ? `${format.prefix}-${body}${format.suffix}`
      : `-${format.prefix}${body}${format.suffix}`;
  }
  return `${format.prefix}${body}${format.suffix}`;
}

// ---------------------------------------------------------------------------
// Column computation
// ---------------------------------------------------------------------------

export interface ColumnCellInput {
  /** 0-based table row index this cell came from. */
  row: number;
  /** Anchor of the cell's first paragraph, when the cell exists. */
  anchor?: string;
  /** Verbatim cell text (multi-paragraph cells joined with \n), or null when
   * the row has no cell at this column (short row / merged cells). */
  text: string | null;
}

export interface SkippedCell {
  row: number;
  anchor?: string;
  /** Verbatim text of the skipped cell; '' for blank, null for a missing cell. */
  text: string | null;
  reason: 'blank' | 'non_numeric' | 'missing_cell';
}

export interface ColumnComputationSuccess {
  ok: true;
  operation: ComputeOperation;
  /** Exact result, rescaled to the resolved format's decimals. */
  value: NumericValue;
  /** The result rendered in the target cell's shape - the bytes to write. */
  renderedValue: string;
  format: CellNumberFormat;
  /** Where the render format came from: the target cell itself, or the
   * column's dominant format when the target was blank/non-numeric. */
  formatSource: 'target_cell' | 'column_majority';
  /** Cells whose parsed values entered the arithmetic. */
  counted: number;
  /** Every considered cell that did NOT enter the arithmetic, named. */
  skipped: SkippedCell[];
  /** True when `average` rounding changed the exact quotient. */
  rounded: boolean;
}

export interface ColumnComputationFailure {
  ok: false;
  error:
    | 'no_numeric_cells'
    | 'column_not_numeric'
    | 'mixed_units'
    | 'precision_loss'
    | 'magnitude_overflow'
    | 'unsupported_operation';
  message: string;
  details?: string[];
}

export type ColumnComputationResult =
  | ColumnComputationSuccess
  | ColumnComputationFailure;

interface ParsedColumnCell {
  row: number;
  anchor?: string;
  text: string;
  parsed: ParsedNumericCell;
}

function formatSignature(format: CellNumberFormat): string {
  return [
    format.prefix,
    format.suffix,
    format.thousandsSeparator,
    format.decimalSeparator,
    String(format.decimals)
  ].join(' ');
}

/**
 * The column's dominant format: most frequent signature among parsed cells;
 * ties resolve to the signature whose LAST occurrence sits lowest in the
 * table (nearest the total row, where formatting is most representative).
 */
function columnMajorityFormat(cells: ParsedColumnCell[]): CellNumberFormat {
  interface Tally {
    count: number;
    lastRow: number;
    format: CellNumberFormat;
  }
  const bySignature = new Map<string, Tally>();
  for (const cell of cells) {
    const signature = formatSignature(cell.parsed.format);
    const entry = bySignature.get(signature);
    if (entry) {
      entry.count++;
      entry.lastRow = Math.max(entry.lastRow, cell.row);
    } else {
      bySignature.set(signature, {
        count: 1,
        lastRow: cell.row,
        format: cell.parsed.format
      });
    }
  }
  let best: Tally = { count: 0, lastRow: -1, format: cells[0].parsed.format };
  bySignature.forEach((entry) => {
    if (
      entry.count > best.count ||
      (entry.count === best.count && entry.lastRow > best.lastRow)
    ) {
      best = entry;
    }
  });
  return best.format;
}

/**
 * A short integer part observes no grouping separator; when the result is
 * long enough to need one, borrow the separator the column's own cells use
 * (else the conventional partner of the decimal separator). The upgraded
 * separator still comes from the document, never from the model.
 */
function upgradeUnobservedGrouping(
  format: CellNumberFormat,
  inputs: ParsedColumnCell[]
): CellNumberFormat {
  if (format.thousandsSeparator || format.groupingObserved) return format;
  const grouped = inputs.filter(
    (cell) =>
      cell.parsed.format.groupingObserved &&
      cell.parsed.format.thousandsSeparator
  );
  const separator = grouped.length
    ? grouped[grouped.length - 1].parsed.format.thousandsSeparator
    : format.decimalSeparator === ','
    ? '.'
    : ',';
  return { ...format, thousandsSeparator: separator };
}

/** Borrow a negative style for a format that never showed one. */
function upgradeNegativeStyle(
  format: CellNumberFormat,
  inputs: ParsedColumnCell[]
): CellNumberFormat {
  if (format.negativeStyle !== 'none') return format;
  const negative = inputs.filter(
    (cell) => cell.parsed.format.negativeStyle !== 'none'
  );
  if (!negative.length) return format; // renderNumericCell defaults to minus
  const donor = negative[negative.length - 1].parsed.format;
  return {
    ...format,
    negativeStyle: donor.negativeStyle,
    minusAfterPrefix: donor.minusAfterPrefix
  };
}

const shortText = (text: string, limit = 40): string =>
  text.length > limit ? `${text.slice(0, limit)}...` : text;

/**
 * Compute one operation over a table column's cells, deterministically.
 *
 * Skip-and-report policy (the decided behaviour for unparseable cells): a
 * blank / non-numeric / missing cell is EXCLUDED from the arithmetic and NAMED
 * in `skipped`, never treated as zero (zero-defaulting is a wrong-total
 * generator) - real schedules legitimately contain "Included"/"N/A" rows, so
 * refusing outright would make the tool useless on the documents it exists
 * for. The honesty valve: when non-blank cells are MOSTLY unparseable the
 * column was probably the wrong pick, and the engine refuses
 * (`column_not_numeric`) instead of summing a minority and calling it a total.
 */
export function computeColumn(
  cells: ColumnCellInput[],
  operation: ComputeOperation,
  targetCellText: string | null
): ColumnComputationResult {
  if (!COMPUTE_OPERATIONS.includes(operation)) {
    return {
      ok: false,
      error: 'unsupported_operation',
      message: `Unsupported operation "${operation}". Supported: ${COMPUTE_OPERATIONS.join(
        ', '
      )}.`
    };
  }

  const parsed: ParsedColumnCell[] = [];
  const skipped: SkippedCell[] = [];
  for (const cell of cells) {
    if (cell.text == null) {
      skipped.push({ row: cell.row, text: null, reason: 'missing_cell' });
      continue;
    }
    if (!cell.text.trim()) {
      skipped.push({
        row: cell.row,
        anchor: cell.anchor,
        text: '',
        reason: 'blank'
      });
      continue;
    }
    const parsedCell = parseNumericCell(cell.text);
    if (!parsedCell) {
      skipped.push({
        row: cell.row,
        anchor: cell.anchor,
        text: cell.text,
        reason: 'non_numeric'
      });
      continue;
    }
    parsed.push({
      row: cell.row,
      anchor: cell.anchor,
      text: cell.text,
      parsed: parsedCell
    });
  }

  const nonNumeric = skipped.filter((s) => s.reason === 'non_numeric');
  if (!parsed.length) {
    return {
      ok: false,
      error: 'no_numeric_cells',
      message:
        'No cell in the requested column range parses as a number; there is nothing to compute. Re-check the column and row range.',
      details: nonNumeric
        .slice(0, 10)
        .map((s) => `row ${s.row}: ${JSON.stringify(shortText(s.text ?? ''))}`)
    };
  }
  if (nonNumeric.length > parsed.length) {
    return {
      ok: false,
      error: 'column_not_numeric',
      message: `Most non-blank cells in this column do not parse as numbers (${nonNumeric.length} non-numeric vs ${parsed.length} numeric); this does not look like a numeric column. Refusing to compute a misleading result - re-check the column index.`,
      details: nonNumeric
        .slice(0, 10)
        .map((s) => `row ${s.row}: ${JSON.stringify(shortText(s.text ?? ''))}`)
    };
  }

  // Unit compatibility: bare numbers ride along with one explicit unit, but
  // two DIFFERENT explicit units (or % against a currency) never sum.
  const units = new Map<string, number>(); // unit -> example row
  for (const cell of parsed) {
    if (cell.parsed.unit && !units.has(cell.parsed.unit)) {
      units.set(cell.parsed.unit, cell.row);
    }
  }
  if (units.size > 1) {
    const listed = Array.from(units.entries())
      .map(([unit, row]) => `"${unit}" (row ${row})`)
      .join(', ');
    return {
      ok: false,
      error: 'mixed_units',
      message: `The column mixes units: ${listed}. Refusing to combine values in different units.`,
      details: parsed
        .slice(0, 10)
        .map((cell) => `row ${cell.row}: ${JSON.stringify(cell.text)}`)
    };
  }

  // Resolve the render format: the target cell itself when it parses,
  // otherwise the column's dominant format.
  const targetParsed =
    targetCellText != null && targetCellText.trim()
      ? parseNumericCell(targetCellText)
      : null;
  let format = targetParsed
    ? targetParsed.format
    : columnMajorityFormat(parsed);
  const formatSource: ColumnComputationSuccess['formatSource'] = targetParsed
    ? 'target_cell'
    : 'column_majority';
  format = upgradeUnobservedGrouping(format, parsed);

  const values = parsed.map((cell) => cell.parsed.value);
  const overflow = (): ColumnComputationFailure => ({
    ok: false,
    error: 'magnitude_overflow',
    message:
      'The exact computation exceeds the safe integer range and cannot be performed without precision loss. Refusing to write an approximate number.'
  });

  let result: NumericValue;
  let rounded = false;
  if (operation === 'count') {
    result = { units: parsed.length, scale: 0 };
  } else {
    const common = toCommonScale(values);
    if (!common) return overflow();
    if (operation === 'sum' || operation === 'average') {
      let total = 0;
      for (const v of common) {
        total += v.units;
        if (!safeUnits(total)) return overflow();
      }
      if (operation === 'sum') {
        result = { units: total, scale: common[0].scale };
      } else {
        // Average: exact quotient when it terminates within the target's
        // decimals, else round half away from zero to the target's decimals
        // (an average is a derived statistic, so rounding is inherent to
        // asking for it; the rounding is reported, never silent).
        const targetScale = Math.max(format.decimals, common[0].scale);
        const scaledUp = rescaleExact(
          { units: total, scale: common[0].scale },
          targetScale
        );
        if (!scaledUp) return overflow();
        const n = parsed.length;
        const q = scaledUp.units / n;
        const truncated = q < 0 ? Math.ceil(q) : Math.floor(q);
        const remainder = scaledUp.units - truncated * n;
        let quotient = truncated;
        if (Math.abs(remainder) * 2 >= n) quotient += q < 0 ? -1 : 1;
        rounded = remainder !== 0;
        if (!safeUnits(quotient)) return overflow();
        result = { units: quotient, scale: targetScale };
      }
    } else {
      let extreme = common[0].units;
      for (const v of common) {
        if (operation === 'min') extreme = Math.min(extreme, v.units);
        else extreme = Math.max(extreme, v.units);
      }
      result = { units: extreme, scale: common[0].scale };
    }
  }

  // Count renders as a bare integer: inheriting a currency prefix onto a row
  // count would be a plausible-looking lie.
  if (operation === 'count') {
    format = {
      prefix: '',
      suffix: '',
      thousandsSeparator: format.thousandsSeparator,
      groupingObserved: format.groupingObserved,
      decimalSeparator: format.decimalSeparator,
      decimals: 0,
      negativeStyle: 'none',
      minusAfterPrefix: false
    };
  }

  const finalValue = rescaleExact(result, format.decimals);
  if (!finalValue) {
    return {
      ok: false,
      error: 'precision_loss',
      message: `The exact ${operation} has more decimal places than the target cell's format (${format.decimals}); writing it would silently change the value. Refusing to approximate - widen the target format or pick a different target cell.`,
      details: [
        `exact result: ${result.units} x 10^-${result.scale}`,
        `target decimals: ${format.decimals}`
      ]
    };
  }

  if (finalValue.units < 0) format = upgradeNegativeStyle(format, parsed);

  return {
    ok: true,
    operation,
    value: finalValue,
    renderedValue: renderNumericCell(finalValue, format),
    format,
    formatSource,
    counted: parsed.length,
    skipped,
    rounded
  };
}
