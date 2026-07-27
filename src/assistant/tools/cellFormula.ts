// Cell formulas: the model supplies an expression over cell REFERENCES, the
// engine supplies every number.
//
// This is the general form of `set_cell_computed`. That op offered five named
// column operations, so the first real request past them - "add 13% tax to the
// proposed premium, then re-total" - had no route and the model wrote
// "$95,139.18" into a cell as a literal string: a number nobody can verify and
// a failure nobody can see. A named-operation list can only ever move that
// wall; an expression grammar removes it.
//
// The invariant, and the reason every design choice below looks the way it
// does: NO NUMBER IN A CELL WRITE COMES FROM THE MODEL. The model names cells
// and ranges; this module resolves those references against the live document,
// reads the verbatim text, parses it with the same `numericCells` parser the
// column operations use, evaluates the expression in EXACT rational arithmetic,
// and renders the result through a format descriptor read from the document.
//
// Numeric literals in the formula (`1.13`, `13%`, `12`) are the only numbers
// the model authors, and they are the FORMULA, not a value: a tax rate or a
// divisor is the user's stated intent, and it stays legible next to the result
// instead of being folded invisibly into a total. A formula with no reference
// at all is refused (`no_reference`) - that would just be a model-authored
// number wearing a formula's clothes.
//
// There is no `eval`, no `Function`, no regex-driven "close enough" numeric
// extraction: a hand-written tokenizer and recursive-descent parser accept
// exactly the grammar below and REFUSE everything else.
//
//   formula  ::= expr
//   expr     ::= term { ("+" | "-") term }
//   term     ::= unary { ("*" | "/") unary }
//   unary    ::= ("-" | "+") unary | primary
//   primary  ::= number | percent | cellRef | call | "(" expr ")"
//   number   ::= digit+ [ "." digit+ ]                 -- ASCII only, no grouping
//   percent  ::= number "%"                            -- 13% is exactly 13/100
//   cellRef  ::= "[" section ";" block ";" row ";" cell ";" para "]"
//   rangeRef ::= "[" section ";" block ";" startRow ".." endRow ";" column "]"
//   call     ::= ("sum"|"average"|"min"|"max"|"count") "(" rangeRef ")"
//
// A reference is written exactly like the anchors the model already copies out
// of an inventory read, wrapped in brackets: `[0;7;5;3;0]` is one cell, and
// `[0;7;1..93;3]` is rows 1 to 93 of column 3 of the table at `0;7` (the same
// section;block;row;column order as a cell anchor, with the row slot widened to
// a range). One notation, two arities - nothing new for the model to learn.

import {
  CellNumberFormat,
  ColumnCellInput,
  NumericValue,
  ParsedColumnCell,
  SkippedCell,
  collectNumericCells,
  parseNumericCell,
  rescaleExact,
  renderNumericCell,
  resolveRenderFormat,
  unitToken,
  upgradeNegativeStyle
} from './numericCells';

// ---------------------------------------------------------------------------
// Exact rational arithmetic
// ---------------------------------------------------------------------------
//
// `numericCells` computes in scaled integers, which is exact for +/-/min/max
// but not for division: `sum(...) / 12` has no terminating decimal expansion.
// Rounding an intermediate result would be exactly the implicit rounding this
// op exists to outlaw, so intermediates are exact RATIONALS (safe-integer
// numerator over safe-integer denominator, reduced after every operation) and
// rounding happens once, at the very end, only where the caller asked for it.
// Anything that would leave the safe-integer range is a refusal
// (`magnitude_overflow`), never a silently-drifting float.

export interface Rational {
  /** Signed numerator; always a JS safe integer. */
  n: number;
  /** Denominator; always a positive JS safe integer. */
  d: number;
}

export type FormulaErrorCode =
  | 'missing_formula'
  | 'formula_syntax'
  | 'bad_reference'
  | 'bad_function_argument'
  | 'unknown_function'
  | 'no_reference'
  | 'reference_not_found'
  | 'cell_not_numeric'
  | 'no_numeric_cells'
  | 'column_not_numeric'
  | 'mixed_units'
  | 'unit_product_undefined'
  | 'division_by_zero'
  | 'magnitude_overflow'
  | 'rounding_required'
  | 'result_unit_mismatch';

class FormulaRefusal extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    readonly detail: string,
    readonly extra?: string[]
  ) {
    super(detail);
  }
}

const refuse = (
  code: FormulaErrorCode,
  detail: string,
  extra?: string[]
): never => {
  throw new FormulaRefusal(code, detail, extra);
};

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function safe(value: number, what: string): number {
  if (!Number.isSafeInteger(value)) {
    refuse(
      'magnitude_overflow',
      `The exact arithmetic exceeds the safe integer range while computing ${what}, so the result cannot be produced without precision loss. Refusing to write an approximate number - compute over a smaller range or with fewer decimal places.`
    );
  }
  return value;
}

function makeRational(n: number, d: number): Rational {
  if (d === 0) {
    refuse(
      'division_by_zero',
      'The formula divides by zero. Nothing is written; check the divisor.'
    );
  }
  const sign = d < 0 ? -1 : 1;
  const divisor = gcd(n, d);
  return {
    n: safe((sign * n) / divisor, 'a value'),
    d: safe((sign * d) / divisor, 'a value')
  };
}

export const rationalFromNumeric = (value: NumericValue): Rational => {
  let d = 1;
  for (let i = 0; i < value.scale; i++) d = safe(d * 10, 'a cell value');
  return makeRational(value.units, d);
};

const ratAdd = (a: Rational, b: Rational): Rational =>
  makeRational(
    safe(a.n * (b.d / gcd(a.d, b.d)), 'a sum') +
      safe(b.n * (a.d / gcd(a.d, b.d)), 'a sum'),
    safe((a.d / gcd(a.d, b.d)) * b.d, 'a sum')
  );
const ratSub = (a: Rational, b: Rational): Rational =>
  ratAdd(a, { n: -b.n, d: b.d });
const ratMul = (a: Rational, b: Rational): Rational =>
  makeRational(safe(a.n * b.n, 'a product'), safe(a.d * b.d, 'a product'));
const ratDiv = (a: Rational, b: Rational): Rational => {
  if (b.n === 0) {
    refuse(
      'division_by_zero',
      'The formula divides by zero. Nothing is written; check the divisor.'
    );
  }
  return makeRational(
    safe(a.n * b.d, 'a quotient'),
    safe(a.d * b.n, 'a quotient')
  );
};
const ratCompare = (a: Rational, b: Rational): number => {
  const left = safe(a.n * b.d, 'a comparison');
  const right = safe(b.n * a.d, 'a comparison');
  return left === right ? 0 : left < right ? -1 : 1;
};

/**
 * The rounding modes the op may ask for. `half_up` is half-away-from-zero, the
 * convention every money jurisdiction that rounds at all uses; `half_even` is
 * banker's rounding; `toward_zero` truncates; `away_from_zero` always inflates
 * the magnitude. Names say what they do to a negative value, because "up" and
 * "down" do not.
 */
export type RoundingMode =
  | 'half_up'
  | 'half_even'
  | 'toward_zero'
  | 'away_from_zero';

export const ROUNDING_MODES: readonly RoundingMode[] = [
  'half_up',
  'half_even',
  'toward_zero',
  'away_from_zero'
];

export interface RationalToScaled {
  value: NumericValue;
  /** True when the exact value did not fit in `decimals` and was rounded. */
  rounded: boolean;
}

/**
 * Convert an exact rational to a fixed number of decimals. THE ONE AND ONLY
 * ROUNDING POINT in the whole formula path: every intermediate is exact, so
 * there is no double rounding and no place for an unreported approximation to
 * hide. `mode` null means "exact or nothing" - the caller then refuses rather
 * than approximating.
 */
export function rationalToScaled(
  value: Rational,
  decimals: number,
  mode: RoundingMode | null
): RationalToScaled | null {
  let numerator = value.n;
  let denominator = value.d;
  for (let i = 0; i < decimals; i++) {
    numerator = safe(numerator * 10, 'the result');
  }
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  const truncated =
    numerator < 0
      ? Math.ceil(numerator / denominator)
      : Math.floor(numerator / denominator);
  const remainder = numerator - truncated * denominator;
  if (remainder === 0) {
    return { value: { units: truncated, scale: decimals }, rounded: false };
  }
  if (!mode) return null;
  const sign = numerator < 0 ? -1 : 1;
  const twice = Math.abs(remainder) * 2;
  let units = truncated;
  if (mode === 'away_from_zero') units += sign;
  else if (mode === 'half_up') {
    if (twice >= denominator) units += sign;
  } else if (mode === 'half_even') {
    if (twice > denominator) units += sign;
    else if (twice === denominator && Math.abs(units % 2) === 1) units += sign;
  }
  // 'toward_zero' keeps the truncated value.
  return {
    value: { units: safe(units, 'the result'), scale: decimals },
    rounded: true
  };
}

// ---------------------------------------------------------------------------
// Grammar: tokens
// ---------------------------------------------------------------------------

export const FORMULA_FUNCTIONS = [
  'sum',
  'average',
  'min',
  'max',
  'count'
] as const;
export type FormulaFunction = typeof FORMULA_FUNCTIONS[number];

export interface CellReference {
  kind: 'cell';
  /** The five-component cell anchor, verbatim. */
  anchor: string;
}

export interface RangeReference {
  kind: 'range';
  tableAnchor: string;
  column: number;
  startRow: number;
  endRow: number;
}

export type FormulaReference = CellReference | RangeReference;

type Token =
  | { t: 'num'; text: string; percent: boolean }
  | { t: 'ref'; ref: FormulaReference; text: string }
  | { t: 'fn'; name: FormulaFunction }
  | { t: 'op'; op: '+' | '-' | '*' | '/' }
  | { t: '(' }
  | { t: ')' };

const FUNCTION_NAMES: readonly string[] = FORMULA_FUNCTIONS;

const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const isAlpha = (ch: string) => /[a-z]/i.test(ch);

/**
 * Parse the contents of a `[...]` reference. Exactly two shapes are legal, and
 * everything else - a 3-component anchor, a non-numeric component, a reversed
 * or open-ended range, a spreadsheet-style `A1` - is a refusal naming both
 * legal shapes rather than a guess at what was meant.
 */
export function parseReference(body: string): FormulaReference | null {
  const parts = body.split(';');
  if (parts.every((p) => /^\d+$/.test(p))) {
    if (parts.length === 5) return { kind: 'cell', anchor: parts.join(';') };
    return null;
  }
  if (parts.length !== 4) return null;
  const [section, block, rows, column] = parts;
  if (!/^\d+$/.test(section) || !/^\d+$/.test(block) || !/^\d+$/.test(column))
    return null;
  const range = /^(\d+)\.\.(\d+)$/.exec(rows);
  if (!range) return null;
  const startRow = Number(range[1]);
  const endRow = Number(range[2]);
  if (startRow > endRow) return null;
  return {
    kind: 'range',
    tableAnchor: `${section};${block}`,
    column: Number(column),
    startRow,
    endRow
  };
}

const REFERENCE_SHAPES =
  'A reference is either one cell - [section;block;row;cell;paragraph], e.g. [0;7;5;3;0] - or a row range of one column - [section;block;startRow..endRow;column], e.g. [0;7;1..93;3]. Copy the anchor components from an inventory read; do not invent them.';

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: ')' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ t: 'op', op: ch });
      i++;
      continue;
    }
    if (ch === '[') {
      const end = source.indexOf(']', i);
      if (end < 0) {
        refuse(
          'formula_syntax',
          `Unclosed "[" in the formula: a reference must end with "]". ${REFERENCE_SHAPES}`
        );
      }
      const body = source.slice(i + 1, end).trim();
      const ref = parseReference(body);
      if (!ref) {
        refuse(
          'bad_reference',
          `"[${body}]" is not a valid reference. ${REFERENCE_SHAPES}`
        );
      }
      tokens.push({
        t: 'ref',
        ref: ref as FormulaReference,
        text: `[${body}]`
      });
      i = end + 1;
      continue;
    }
    if (isDigit(ch)) {
      let j = i;
      while (j < source.length && isDigit(source[j])) j++;
      if (source[j] === '.') {
        j++;
        if (!isDigit(source[j])) {
          refuse(
            'formula_syntax',
            `A decimal point must be followed by digits (at "${source.slice(
              i,
              j + 1
            )}"). Write numbers as plain ASCII digits with an optional "." decimal point - no thousands separators, no exponents.`
          );
        }
        while (j < source.length && isDigit(source[j])) j++;
      }
      const text = source.slice(i, j);
      // A grouping separator or an exponent in a literal is ambiguous, so it is
      // refused rather than interpreted.
      if (source[j] === ',' || source[j] === 'e' || source[j] === 'E') {
        refuse(
          'formula_syntax',
          `"${text}${source[j]}" is not a valid number literal. Write literals as plain ASCII digits with an optional "." decimal point - no thousands separators (write 1234.5, not 1,234.5) and no exponent notation.`
        );
      }
      const percent = source[j] === '%';
      tokens.push({ t: 'num', text, percent });
      i = percent ? j + 1 : j;
      continue;
    }
    if (isAlpha(ch)) {
      let j = i;
      while (j < source.length && isAlpha(source[j])) j++;
      const word = source.slice(i, j);
      if (FUNCTION_NAMES.indexOf(word.toLowerCase()) < 0) {
        refuse(
          'unknown_function',
          `"${word}" is not a formula function. The complete set is ${FORMULA_FUNCTIONS.join(
            ', '
          )}, each taking exactly one row-range reference, e.g. sum([0;7;1..93;3]).`
        );
      }
      tokens.push({ t: 'fn', name: word.toLowerCase() as FormulaFunction });
      i = j;
      continue;
    }
    refuse(
      'formula_syntax',
      `Unexpected character ${JSON.stringify(
        ch
      )} in the formula. The grammar is + - * / ( ), numeric literals (13, 1.13, 13%), bracketed cell/range references and the functions ${FORMULA_FUNCTIONS.join(
        ', '
      )}.`
    );
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Grammar: AST + recursive-descent parser (never eval)
// ---------------------------------------------------------------------------

export type FormulaNode =
  | { kind: 'literal'; value: Rational; text: string }
  | { kind: 'ref'; ref: FormulaReference; text: string }
  | { kind: 'call'; fn: FormulaFunction; ref: RangeReference; text: string }
  | { kind: 'neg'; operand: FormulaNode }
  | {
      kind: 'binary';
      op: '+' | '-' | '*' | '/';
      left: FormulaNode;
      right: FormulaNode;
    };

function literalRational(text: string, percent: boolean): Rational {
  const dot = text.indexOf('.');
  const digits = dot < 0 ? text : text.slice(0, dot) + text.slice(dot + 1);
  const scale = dot < 0 ? 0 : text.length - dot - 1;
  let denominator = 1;
  for (let i = 0; i < scale; i++) denominator = safe(denominator * 10, text);
  if (percent) denominator = safe(denominator * 100, text);
  const numerator = Number(digits);
  safe(numerator, text);
  return makeRational(numerator, denominator);
}

function parseTokens(tokens: Token[]): FormulaNode {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const parseExpr = (): FormulaNode => {
    let left = parseTerm();
    for (;;) {
      const token = peek();
      if (token?.t !== 'op' || (token.op !== '+' && token.op !== '-'))
        return left;
      pos++;
      left = { kind: 'binary', op: token.op, left, right: parseTerm() };
    }
  };

  const parseTerm = (): FormulaNode => {
    let left = parseUnary();
    for (;;) {
      const token = peek();
      if (token?.t !== 'op' || (token.op !== '*' && token.op !== '/'))
        return left;
      pos++;
      left = { kind: 'binary', op: token.op, left, right: parseUnary() };
    }
  };

  const parseUnary = (): FormulaNode => {
    const token = peek();
    if (token?.t === 'op' && (token.op === '-' || token.op === '+')) {
      pos++;
      const operand = parseUnary();
      return token.op === '-' ? { kind: 'neg', operand } : operand;
    }
    return parsePrimary();
  };

  const parsePrimary = (): FormulaNode => {
    const token = peek();
    if (!token) {
      return refuse(
        'formula_syntax',
        'The formula ends where a value was expected. Every operator needs a value on both sides.'
      );
    }
    if (token.t === 'num') {
      pos++;
      return {
        kind: 'literal',
        value: literalRational(token.text, token.percent),
        text: token.percent ? `${token.text}%` : token.text
      };
    }
    if (token.t === 'ref') {
      pos++;
      return { kind: 'ref', ref: token.ref, text: token.text };
    }
    if (token.t === '(') {
      pos++;
      const inner = parseExpr();
      if (peek()?.t !== ')') {
        refuse(
          'formula_syntax',
          'Unbalanced parentheses in the formula: a "(" has no matching ")".'
        );
      }
      pos++;
      return inner;
    }
    if (token.t === 'fn') {
      pos++;
      if (peek()?.t !== '(') {
        return refuse(
          'formula_syntax',
          `"${token.name}" must be called with a parenthesised row-range reference, e.g. ${token.name}([0;7;1..93;3]).`
        );
      }
      pos++;
      const argument = peek();
      if (argument?.t !== 'ref') {
        return refuse(
          'bad_function_argument',
          `${token.name}() takes exactly one row-range reference, e.g. ${token.name}([0;7;1..93;3]) - not an expression. Aggregate first, then do arithmetic on the result.`
        );
      }
      if (argument.ref.kind !== 'range') {
        return refuse(
          'bad_function_argument',
          `${token.name}() needs a ROW RANGE, not a single cell: ${token.name}([0;7;1..93;3]). A single cell needs no aggregation - reference it directly as ${argument.text}.`
        );
      }
      pos++;
      if (peek()?.t !== ')') {
        return refuse(
          'bad_function_argument',
          `${token.name}() takes exactly one row-range reference and nothing else; the call is not closed after its argument.`
        );
      }
      pos++;
      return {
        kind: 'call',
        fn: token.name,
        ref: argument.ref,
        text: `${token.name}(${argument.text})`
      };
    }
    return refuse(
      'formula_syntax',
      'Unexpected ")" where a value was expected in the formula.'
    );
  };

  const root = parseExpr();
  if (pos !== tokens.length) {
    refuse(
      'formula_syntax',
      'Trailing content after the end of the formula; the whole string must be a single expression.'
    );
  }
  return root;
}

/** Tokenize + parse a formula string into an AST. Throws a FormulaRefusal. */
function parseFormula(source: string): FormulaNode {
  const text = String(source ?? '').trim();
  if (!text) {
    refuse(
      'missing_formula',
      `set_cell_formula needs a \`formula\`: an expression over cell references, e.g. "[0;7;5;3;0] * 1.13" or "sum([0;7;1..93;3])". ${REFERENCE_SHAPES}`
    );
  }
  return parseTokens(tokenize(text));
}

/** Every reference the AST mentions, in source order. */
export function collectReferences(node: FormulaNode): FormulaReference[] {
  const out: FormulaReference[] = [];
  const walk = (current: FormulaNode): void => {
    if (current.kind === 'ref') out.push(current.ref);
    else if (current.kind === 'call') out.push(current.ref);
    else if (current.kind === 'neg') walk(current.operand);
    else if (current.kind === 'binary') {
      walk(current.left);
      walk(current.right);
    }
  };
  walk(node);
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * How the evaluator reaches the document. Injected so the grammar, the
 * arithmetic and the refusals are unit-testable with no editor in sight, and so
 * the live path resolves against the CURRENT block map - which is what makes
 * chaining work: an earlier op in the same change set has already written, the
 * executor has already refreshed, and this resolver reads the new text.
 */
export interface FormulaResolver {
  /** Verbatim text of one cell, or null when no such cell exists. */
  cell(anchor: string): string | null;
  /**
   * Every cell of a column row range as data, or null when the table does not
   * exist. `outOfRange` reports a row range that runs past the table's rows,
   * so an over-long range is a refusal rather than a silently shorter one.
   */
  range(
    reference: RangeReference
  ): { cells: ColumnCellInput[]; rowCount: number; columns: number } | null;
}

/**
 * One resolved reference: what the engine ACTUALLY read, in resolved terms.
 *
 * This is the answer to the failure mode a correct-looking number cannot
 * expose - right arithmetic on the wrong cells. A receipt built from these says
 * "summed rows 2-93 of column 3 of the table at 0;7, 92 of 92 cells read"
 * rather than just naming a total, so a range that quietly started at the wrong
 * row is visible at a glance. It is also the baseline for the post-write
 * integrity re-read.
 */
export interface ResolvedReferenceRead {
  reference: FormulaReference;
  /** The reference as written in the formula. */
  text: string;
  /** The aggregate applied, for a range reference. */
  fn?: FormulaFunction;
  /** Verbatim text read, keyed by anchor - the post-write comparison baseline. */
  readCells: Array<{
    anchor: string | null;
    row?: number;
    text: string | null;
  }>;
  /** Cells whose values entered the arithmetic from THIS reference. */
  counted: number;
  /** Cells excluded from the arithmetic from THIS reference, named. */
  skipped: SkippedCell[];
}

export interface FormulaEvaluationSuccess {
  ok: true;
  /** The exact value, before any rendering or rounding. */
  value: Rational;
  /** The unit every referenced value agreed on ('' for bare numbers). */
  unit: string;
  /** True when the result is a pure row tally rather than an amount. */
  tally: boolean;
  /** Cells whose values entered the arithmetic. */
  counted: number;
  /** Every considered cell excluded from the arithmetic, named. */
  skipped: SkippedCell[];
  /** The parsed cells, for format resolution by the caller. */
  inputs: ParsedColumnCell[];
  /** Each reference and the verbatim cell texts it resolved to. */
  reads: ResolvedReferenceRead[];
  references: FormulaReference[];
}

export interface FormulaEvaluationFailure {
  ok: false;
  error: FormulaErrorCode;
  message: string;
  details?: string[];
}

export type FormulaEvaluationResult =
  | FormulaEvaluationSuccess
  | FormulaEvaluationFailure;

interface Typed {
  value: Rational;
  /** '' means dimensionless: a literal, a count, or a bare-number cell. */
  unit: string;
  /**
   * True when this value is a pure ROW TALLY - a bare `count()`, possibly
   * negated. A tally is not an amount, so writing it into a cell formatted as
   * money would render "$3" and read as three dollars. Any arithmetic clears
   * the flag: `sum(x)/count(x)` is an average, which IS an amount.
   */
  tally: boolean;
}

/**
 * Evaluate a formula against a resolver. Every number in the result came from a
 * cell the resolver read or a literal in the formula; nothing is defaulted,
 * and every failure path is a refusal with a remedy rather than a zero.
 */
export function evaluateFormula(
  source: string,
  resolver: FormulaResolver
): FormulaEvaluationResult {
  const skipped: SkippedCell[] = [];
  const inputs: ParsedColumnCell[] = [];
  const reads: ResolvedReferenceRead[] = [];
  let counted = 0;

  const aggregate = (
    fn: FormulaFunction,
    reference: RangeReference,
    text: string
  ): Typed => {
    const resolved = resolver.range(reference);
    if (!resolved) {
      refuse(
        'reference_not_found',
        `${text} does not resolve: no table at anchor "${reference.tableAnchor}". Re-read the document structure and copy the table's anchor from it.`
      );
      throw new Error('unreachable');
    }
    if (reference.column >= resolved.columns) {
      refuse(
        'reference_not_found',
        `${text} names column ${reference.column}, but the table at "${
          reference.tableAnchor
        }" has ${resolved.columns} columns (0-${resolved.columns - 1}).`
      );
    }
    if (reference.endRow >= resolved.rowCount) {
      refuse(
        'reference_not_found',
        `${text} names rows ${reference.startRow}..${
          reference.endRow
        }, but the table at "${reference.tableAnchor}" has ${
          resolved.rowCount
        } rows (0-${
          resolved.rowCount - 1
        }). Refusing to compute over a range that runs off the end of the table.`
      );
    }
    const collected = collectNumericCells(resolved.cells);
    if (!collected.ok) {
      refuse(collected.error as FormulaErrorCode, collected.message, [
        `reference: ${text}`,
        ...(collected.details ?? [])
      ]);
      throw new Error('unreachable');
    }
    reads.push({
      reference,
      text,
      fn,
      readCells: resolved.cells.map((cellEntry) => ({
        anchor: cellEntry.anchor ?? null,
        row: cellEntry.row,
        text: cellEntry.text
      })),
      counted: collected.parsed.length,
      skipped: collected.skipped
    });
    skipped.push(...collected.skipped);
    inputs.push(...collected.parsed);
    counted += collected.parsed.length;
    const values = collected.parsed.map((cellEntry) =>
      rationalFromNumeric(cellEntry.parsed.value)
    );
    if (fn === 'count') {
      // A count is a row tally, never a currency amount: it is dimensionless
      // so it can never inherit a `$` it has no business wearing.
      return { value: makeRational(values.length, 1), unit: '', tally: true };
    }
    if (fn === 'min' || fn === 'max') {
      let extreme = values[0];
      for (const candidate of values) {
        const comparison = ratCompare(candidate, extreme);
        if (fn === 'min' ? comparison < 0 : comparison > 0) extreme = candidate;
      }
      return { value: extreme, unit: collected.unit, tally: false };
    }
    let total = makeRational(0, 1);
    for (const candidate of values) total = ratAdd(total, candidate);
    if (fn === 'sum')
      return { value: total, unit: collected.unit, tally: false };
    // An average is exact here: the division stays rational and is rounded
    // once, at the end, with the rest of the expression.
    return {
      value: ratDiv(total, makeRational(values.length, 1)),
      unit: collected.unit,
      tally: false
    };
  };

  const readCell = (reference: CellReference, text: string): Typed => {
    const raw = resolver.cell(reference.anchor);
    if (raw == null) {
      refuse(
        'reference_not_found',
        `${text} does not resolve to a cell in this document. Copy the anchor from a current inventory read - a table cell anchor is section;block;row;cell;paragraph, all 0-based.`
      );
      throw new Error('unreachable');
    }
    const parsed = parseNumericCell(raw);
    if (!parsed) {
      refuse(
        'cell_not_numeric',
        `${text} contains ${JSON.stringify(
          raw.length > 60 ? `${raw.slice(0, 60)}...` : raw
        )}, which is not a number, so it cannot enter a calculation. Refusing to treat it as zero - reference a numeric cell, or fix the cell first.`
      );
      throw new Error('unreachable');
    }
    reads.push({
      reference,
      text,
      readCells: [{ anchor: reference.anchor, text: raw }],
      counted: 1,
      skipped: []
    });
    inputs.push({ row: 0, anchor: reference.anchor, text: raw, parsed });
    counted += 1;
    return {
      value: rationalFromNumeric(parsed.value),
      unit: parsed.unit,
      tally: false
    };
  };

  const combineAdditive = (op: '+' | '-', left: Typed, right: Typed): Typed => {
    if (left.unit && right.unit && left.unit !== right.unit) {
      refuse(
        'mixed_units',
        `The formula ${
          op === '+' ? 'adds' : 'subtracts'
        } values in different units ("${left.unit}" and "${
          right.unit
        }"). Refusing to combine them - convert one side explicitly, or reference cells in the same unit.`
      );
    }
    return {
      value:
        op === '+'
          ? ratAdd(left.value, right.value)
          : ratSub(left.value, right.value),
      unit: left.unit || right.unit,
      tally: false
    };
  };

  const combineMultiplicative = (
    op: '*' | '/',
    left: Typed,
    right: Typed
  ): Typed => {
    // A dimensionless factor scales a united value ($ x 1.13 is $). Two united
    // values would produce a unit this engine has no representation for
    // ($ x $, or a ratio wearing a currency symbol), so it refuses instead of
    // labelling the result with a plausible-looking symbol.
    if (left.unit && right.unit) {
      refuse(
        'unit_product_undefined',
        `The formula ${
          op === '*' ? 'multiplies' : 'divides'
        } two values that both carry units ("${left.unit}" and "${
          right.unit
        }"); the result has no well-defined unit to render in. Multiply or divide by a plain number (or a percentage) instead.`
      );
    }
    return {
      value:
        op === '*'
          ? ratMul(left.value, right.value)
          : ratDiv(left.value, right.value),
      unit: op === '*' ? left.unit || right.unit : left.unit,
      tally: false
    };
  };

  const evaluate = (node: FormulaNode): Typed => {
    switch (node.kind) {
      case 'literal':
        return { value: node.value, unit: '', tally: false };
      case 'ref':
        return node.ref.kind === 'cell'
          ? readCell(node.ref, node.text)
          : refuseBareRange(node.text);
      case 'call':
        return aggregate(node.fn, node.ref, node.text);
      case 'neg': {
        const operand = evaluate(node.operand);
        return {
          value: { n: -operand.value.n, d: operand.value.d },
          unit: operand.unit,
          tally: operand.tally
        };
      }
      case 'binary': {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        return node.op === '+' || node.op === '-'
          ? combineAdditive(node.op, left, right)
          : combineMultiplicative(node.op, left, right);
      }
    }
  };

  const refuseBareRange = (text: string): Typed => {
    refuse(
      'bad_reference',
      `${text} is a row range, which has many values, so it cannot stand where a single value is expected. Aggregate it: sum(${text}), average(${text}), min/max/count(${text}).`
    );
    throw new Error('unreachable');
  };

  try {
    const ast = parseFormula(source);
    const references = collectReferences(ast);
    if (!references.length) {
      return {
        ok: false,
        error: 'no_reference',
        message: `The formula ${JSON.stringify(
          String(source).trim()
        )} contains no cell reference, so its result would be a number you supplied rather than one the engine read from the document. Reference the cells the value comes from. ${REFERENCE_SHAPES}`
      };
    }
    const result = evaluate(ast);
    return {
      ok: true,
      value: result.value,
      unit: result.unit,
      tally: result.tally,
      counted,
      skipped,
      inputs,
      reads,
      references
    };
  } catch (error) {
    if (error instanceof FormulaRefusal) {
      return {
        ok: false,
        error: error.code,
        message: error.detail,
        ...(error.extra ? { details: error.extra } : {})
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rendering a formula result into a target cell
// ---------------------------------------------------------------------------

export interface FormulaRenderSuccess {
  ok: true;
  value: NumericValue;
  renderedValue: string;
  format: CellNumberFormat;
  formatSource: 'target_cell' | 'column_majority';
  rounded: boolean;
  roundingMode: RoundingMode | null;
  decimals: number;
}

export interface FormulaRenderFailure {
  ok: false;
  error: 'rounding_required' | 'result_unit_mismatch' | 'magnitude_overflow';
  message: string;
  details?: string[];
}

/**
 * Render an exact formula result in the target cell's own number format.
 *
 * Rounding is EXPLICIT: without a declared `round` mode a result that does not
 * fit the target's decimals is refused (`rounding_required`) rather than
 * quietly trimmed, and the refusal names the exact remainder plus the modes on
 * offer. A tax calculation therefore cannot land in the document without the
 * change set recording where it rounded and to what.
 */
export function renderFormulaResult(
  evaluation: FormulaEvaluationSuccess,
  targetCellText: string | null,
  options: { round: RoundingMode | null; decimals?: number }
): FormulaRenderSuccess | FormulaRenderFailure {
  const resolved = resolveRenderFormat(targetCellText, evaluation.inputs);
  let format = resolved.format;
  // The unit the result WILL be dressed in if it is written, read off the
  // format actually resolved - which may be the column's, not the target
  // cell's, when the target is blank.
  const renderUnit = unitToken(format.prefix, format.suffix);
  if (renderUnit && evaluation.unit && renderUnit !== evaluation.unit) {
    return {
      ok: false,
      error: 'result_unit_mismatch',
      message: `The formula's result is in "${evaluation.unit}" but this cell would render it as "${renderUnit}"; writing it would label the number with a unit it does not have. Refusing - target a cell in the result's unit, or convert explicitly in the formula.`
    };
  }
  if (renderUnit && evaluation.tally) {
    return {
      ok: false,
      error: 'result_unit_mismatch',
      message: `The formula's result is a row COUNT, but this cell would render it as "${renderUnit}" - a tally of ${evaluation.value.n} written here would read as an amount of money, not a number of rows. Refusing to write a plausible-looking lie: target a cell without currency formatting, or divide the count into a sum if an average was meant.`
    };
  }
  const decimals =
    options.decimals != null && Number.isInteger(options.decimals)
      ? options.decimals
      : format.decimals;
  if (decimals !== format.decimals) format = { ...format, decimals };
  try {
    const exact = rationalToScaled(evaluation.value, decimals, null);
    const scaled =
      exact ?? rationalToScaled(evaluation.value, decimals, options.round);
    if (!scaled) {
      // Best-effort hint only: on a large figure the extra scaling can leave
      // the safe integer range, and a diagnostic that cannot be produced must
      // never change the refusal the caller actually receives.
      let exactAt: RationalToScaled | null = null;
      try {
        exactAt = rationalToScaled(evaluation.value, decimals + 6, 'half_up');
      } catch {
        exactAt = null;
      }
      return {
        ok: false,
        error: 'rounding_required',
        message: `The exact result does not fit the ${decimals} decimal place${
          decimals === 1 ? '' : 's'
        } of the target cell's format, and no rounding was requested. Rounding a money figure is a decision, not a detail: re-send with round set to one of ${ROUNDING_MODES.join(
          ', '
        )} (use "half_up" for ordinary currency rounding), optionally with \`decimals\` to widen the target format instead.`,
        details: [
          `exact result: ${evaluation.value.n}/${evaluation.value.d}`,
          ...(exactAt
            ? [
                `approximately ${
                  exactAt.value.units / Math.pow(10, exactAt.value.scale)
                }`
              ]
            : []),
          `target decimals: ${decimals}`
        ]
      };
    }
    if (scaled.value.units < 0)
      format = upgradeNegativeStyle(format, evaluation.inputs);
    const finalValue = rescaleExact(scaled.value, format.decimals);
    if (!finalValue) {
      return {
        ok: false,
        error: 'magnitude_overflow',
        message:
          'The computed result cannot be represented exactly at the target format scale. Refusing to write an approximate number.'
      };
    }
    return {
      ok: true,
      value: finalValue,
      renderedValue: renderNumericCell(finalValue, format),
      format,
      formatSource: resolved.formatSource,
      rounded: scaled.rounded,
      roundingMode: scaled.rounded ? options.round : null,
      decimals
    };
  } catch (error) {
    if (error instanceof FormulaRefusal) {
      return {
        ok: false,
        error: 'magnitude_overflow',
        message: error.detail
      };
    }
    throw error;
  }
}
