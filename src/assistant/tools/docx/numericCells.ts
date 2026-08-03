// Deterministic numeric-cell parsing, arithmetic and rendering for the
// document engine's computed table writes (`set_cell_formula`).
//
// The contract this module exists to keep: THE ENGINE COMPUTES, NOT THE MODEL.
// The model supplies a formula naming cells and ranges; every numeric decision
// below - what a cell is worth, and what bytes land in the target cell - is
// deterministic code with unit tests.
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
// refusal, never a silently-wrong float. `cellFormula.ts` lifts these values
// into exact rationals so division is exact too.

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
export function unitToken(prefix: string, suffix: string): string {
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

/**
 * How much a cell's text looks like a NUMBER rather than prose that happens to
 * contain digits, and - if it is a number - whether it is an AMOUNT or an
 * identifier. Used by the `table_facts` read (so a model interpreting a table
 * can tell an id column from a money column) and by the engine's gate against
 * model-authored numbers.
 *
 * Three tiers, each read off the document's own notation:
 *
 * - not numeric: `parseNumericCell` cannot read it at all, OR its decoration
 *   carries real prose. `parseNumericCell` is deliberately permissive so that a
 *   label survives a rewrite ("Total: $1,284,350" keeps its prefix), which also
 *   means "1 King St W" parses as 1. For CLASSIFICATION that permissiveness is
 *   wrong, so more than three letters of decoration disqualifies a cell here.
 *   The classification is therefore strictly narrower than what the compute path
 *   will parse - a cell can never be advertised as numeric and then refused.
 * - numeric but not a quantity: an identifier. A zero-padded integer (`0093`)
 *   can only be an id, and a bare unpadded integer (`9999`) carries no evidence
 *   either way, so it is treated as an id too.
 * - a quantity: numeric AND carrying a unit, decimal places, or observed
 *   thousands grouping - `$36,803`, `984.00`, `12.5%`, `1,284,350`.
 */
export interface NumericTextClass {
  numeric: boolean;
  quantity: boolean;
  /** Present when numeric: the unit token ('' for a bare number). */
  unit?: string;
  /** Present when numeric: decimal places as written. */
  decimals?: number;
}

const MAX_DECORATION_LETTERS = 3; // "USD", "EUR", "CAD"

export function classifyNumericText(rawText: string): NumericTextClass {
  const text = String(rawText ?? '').trim();
  if (!text || !/\d/.test(text)) return { numeric: false, quantity: false };
  const parsed = parseNumericCell(text);
  if (!parsed) return { numeric: false, quantity: false };
  const { format } = parsed;
  const decorationLetters = `${format.prefix}${format.suffix}`.replace(
    /[^A-Za-z]/g,
    ''
  );
  if (decorationLetters.length > MAX_DECORATION_LETTERS)
    return { numeric: false, quantity: false };
  const base = {
    numeric: true,
    unit: parsed.unit,
    decimals: format.decimals
  };
  // A zero-padded leading digit run is an identifier, never an amount.
  const firstRun = /\d+/.exec(text)?.[0] ?? '';
  if (firstRun.length > 1 && firstRun.startsWith('0'))
    return { ...base, quantity: false };
  const hasUnit = `${format.prefix}${format.suffix}`.trim() !== '';
  const hasDecimals = format.decimals > 0;
  const hasGrouping =
    format.groupingObserved && format.thousandsSeparator !== '';
  return { ...base, quantity: hasUnit || hasDecimals || hasGrouping };
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

/**
 * Where a rendered result's number format came from. Either way it came from
 * the DOCUMENT: there is no "plain number" mode in the render path.
 */
export type RenderFormatSource = 'target_cell' | 'column_majority';

export interface ParsedColumnCell {
  row: number;
  anchor?: string;
  text: string;
  parsed: ParsedNumericCell;
}

// A separator no cell prefix/suffix can contain, so two distinct formats can
// never collide into one signature. Written as an escape rather than a literal
// NUL byte, which would make this whole source file binary to grep.
const SIGNATURE_SEPARATOR = '\u0000';

function formatSignature(format: CellNumberFormat): string {
  return [
    format.prefix,
    format.suffix,
    format.thousandsSeparator,
    format.decimalSeparator,
    String(format.decimals)
  ].join(SIGNATURE_SEPARATOR);
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
export function upgradeNegativeStyle(
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
 * Resolve the format a result is rendered in: the target cell's own parsed
 * format when it parses, otherwise the dominant format of the cells that fed
 * the computation. Either way the format comes from the DOCUMENT - there is no
 * "plain number" mode, which is why `$36,803` can never come back as `36803`.
 * Shared by every render path in the formula evaluator.
 */
export function resolveRenderFormat(
  targetCellText: string | null,
  inputs: ParsedColumnCell[]
): {
  format: CellNumberFormat;
  formatSource: RenderFormatSource;
} {
  const targetParsed =
    targetCellText != null && targetCellText.trim()
      ? parseNumericCell(targetCellText)
      : null;
  const base = targetParsed
    ? targetParsed.format
    : columnMajorityFormat(inputs);
  return {
    format: upgradeUnobservedGrouping(base, inputs),
    formatSource: targetParsed ? 'target_cell' : 'column_majority'
  };
}

export interface CollectedNumericCells {
  ok: true;
  /** Cells whose values may enter arithmetic, in row order. */
  parsed: ParsedColumnCell[];
  /** Every considered cell excluded from the arithmetic, named. */
  skipped: SkippedCell[];
  /** The single explicit unit the cells agree on ('' when all bare). */
  unit: string;
}

/**
 * Parse a set of cells, apply the skip-and-name policy, the majority backstop
 * and the unit-compatibility check - the stage every formula range aggregate
 * shares, so there is exactly ONE implementation of "which cells count and
 * which are named as skipped" in the engine.
 *
 * Skip-and-report policy: a blank / non-numeric / missing cell is EXCLUDED
 * from the arithmetic and NAMED in `skipped`, never treated as zero
 * (zero-defaulting is a wrong-total generator) - real schedules legitimately
 * contain "Included"/"N/A" rows, so refusing outright would make the engine
 * useless on the documents it exists for. The honesty valve: when non-blank
 * cells are MOSTLY unparseable the range was probably the wrong pick, and the
 * engine refuses (`column_not_numeric`) instead of aggregating a minority and
 * calling it a total.
 */
export function collectNumericCells(
  cells: ColumnCellInput[]
): CollectedNumericCells | ColumnComputationFailure {
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
  const nameRows = (list: SkippedCell[]) =>
    list
      .slice(0, 10)
      .map((s) => `row ${s.row}: ${JSON.stringify(shortText(s.text ?? ''))}`);
  if (!parsed.length) {
    return {
      ok: false,
      error: 'no_numeric_cells',
      message:
        'No cell in the requested column range parses as a number; there is nothing to compute. Re-check the column and row range.',
      details: nameRows(nonNumeric)
    };
  }
  if (nonNumeric.length > parsed.length) {
    return {
      ok: false,
      error: 'column_not_numeric',
      message: `Most non-blank cells in this column do not parse as numbers (${nonNumeric.length} non-numeric vs ${parsed.length} numeric); this does not look like a numeric column. Refusing to compute a misleading result - re-check the column index.`,
      details: nameRows(nonNumeric)
    };
  }

  // Unit compatibility: bare numbers ride along with one explicit unit, but
  // two DIFFERENT explicit units (or % against a currency) never combine.
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

  return {
    ok: true,
    parsed,
    skipped,
    unit: Array.from(units.keys())[0] ?? ''
  };
}
