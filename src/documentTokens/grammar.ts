/**
 * The token formula grammar — parse and evaluate, without eval().
 *
 * Formulas arrive inside uploaded documents, so this must never execute
 * arbitrary input. A hand-written recursive-descent parser over a deliberately
 * tiny grammar is the whole defence: anything outside the grammar is a syntax
 * error, not code.
 *
 * The Python twin lives at
 * feathery-backend/apps/document/utils/tokens/grammar.py and must agree with
 * this module case for case — see grammarCases.json.
 *
 * Grammar:
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/') unary)*
 *   unary   := '-' unary | primary
 *   primary := NUMBER | IDENT | FUNC '(' args ')' | '(' expr ')'
 *   args    := (expr | WILDCARD) (',' (expr | WILDCARD))*
 */

/**
 * Functions that change how a value LOOKS, not what it is. A token displayed
 * through these stays editable: the field holds what was typed and this only
 * decides the rendering. Text in, text out.
 *
 * The Python twin is grammar.py's DISPLAY_FUNCTIONS — keep them identical.
 */
export const DISPLAY_FUNCTIONS = new Set(['UPPER', 'LOWER', 'TITLE', 'TRIM']);

const DISPLAY: Record<string, (text: string) => string> = {
  UPPER: (text) => text.toUpperCase(),
  LOWER: (text) => text.toLowerCase(),
  // Word-initial capitals, matching Python's str.title(): a word is a run of
  // LETTERS in the Unicode sense, or an accented name capitalises differently
  // on the two sides — pinned by the fixture's display cases.
  TITLE: (text) =>
    text.replace(
      /\p{L}+/gu,
      (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()
    ),
  TRIM: (text) => text.trim()
};

// Only these may be called. Anything else is rejected at parse time.
export const FUNCTIONS = new Set([
  'SUM',
  'ROUND',
  'MIN',
  'MAX',
  'ABS',
  ...DISPLAY_FUNCTIONS
]);

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaError';
  }
}

// ── AST ─────────────────────────────────────────────────────────────────────
export type Node =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; id: string }
  | { kind: 'wildcard'; prefix: string }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'unary'; operand: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node };

type Lexeme = { kind: 'number' | 'ident' | 'op'; text: string };

/** A token's value: a number, or every row of a repeated token. */
export type TokenValues = Map<string, number | number[]>;

// ── Lexer ───────────────────────────────────────────────────────────────────
// A wildcard (`item_total_*`) is NOT a lexer token: a trailing `*` here is
// whitespace-blind and would swallow the `*` of a spaceless product like
// `qty*cost`. The `*` always lexes as an operator; the parser recognises a
// wildcard only where one is legal — see Parser.wildcardPrefixAt.
const PATTERNS: Array<[Lexeme['kind'] | 'space', RegExp]> = [
  ['space', /^\s+/],
  ['number', /^(?:\d+\.\d+|\d+)/],
  ['ident', /^[A-Za-z_][A-Za-z0-9_]*/],
  ['op', /^[+\-*/(),]/]
];

const lex = (source: string): Lexeme[] => {
  const lexemes: Lexeme[] = [];
  let rest = source;

  while (rest.length > 0) {
    const hit = PATTERNS.map(
      ([kind, re]) => [kind, re.exec(rest)] as const
    ).find(([, m]) => m !== null);

    if (!hit || !hit[1]) {
      throw new FormulaError(
        `syntax error: unexpected ${JSON.stringify(rest[0])}`
      );
    }
    const [kind, match] = hit;
    if (kind !== 'space') lexemes.push({ kind, text: match[0] });
    rest = rest.slice(match[0].length);
  }

  return lexemes;
};

// ── Parser ──────────────────────────────────────────────────────────────────
class Parser {
  private pos = 0;

  private readonly lexemes: Lexeme[];

  constructor(lexemes: Lexeme[]) {
    this.lexemes = lexemes;
  }

  private peek(): Lexeme | undefined {
    return this.lexemes[this.pos];
  }

  private eat(text: string): boolean {
    if (this.peek()?.text === text) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private expect(text: string): void {
    if (!this.eat(text)) {
      throw new FormulaError(`syntax error: expected ${JSON.stringify(text)}`);
    }
  }

  /**
   * If the current position is a wildcard (`ident` then a lone `*`), return its
   * prefix; otherwise null. A `*` is "lone" when nothing multipliable follows —
   * so `item_total_*)` is a wildcard, while `qty*cost` is a product because an
   * operand (an ident) follows the star. This is the whole reason the lexer no
   * longer treats a trailing `*` as a wildcard.
   */
  private wildcardPrefixAt(): string | null {
    const id = this.lexemes[this.pos];
    const star = this.lexemes[this.pos + 1];
    if (id?.kind !== 'ident' || star?.text !== '*') return null;
    const after = this.lexemes[this.pos + 2];
    const startsOperand =
      after !== undefined &&
      (after.kind === 'number' ||
        after.kind === 'ident' ||
        after.text === '(' ||
        after.text === '-');
    return startsOperand ? null : id.text;
  }

  parse(): Node {
    if (this.lexemes.length === 0) {
      throw new FormulaError('syntax error: empty formula');
    }
    const node = this.expr();
    const trailing = this.peek();
    if (trailing) {
      throw new FormulaError(
        `syntax error: unexpected ${JSON.stringify(trailing.text)}`
      );
    }
    return node;
  }

  expr(): Node {
    let node = this.term();
    for (
      let t = this.peek();
      t && (t.text === '+' || t.text === '-');
      t = this.peek()
    ) {
      this.pos += 1;
      node = { kind: 'binary', op: t.text, left: node, right: this.term() };
    }
    return node;
  }

  term(): Node {
    let node = this.unary();
    for (
      let t = this.peek();
      t && (t.text === '*' || t.text === '/');
      t = this.peek()
    ) {
      this.pos += 1;
      node = { kind: 'binary', op: t.text, left: node, right: this.unary() };
    }
    return node;
  }

  unary(): Node {
    if (this.eat('-')) return { kind: 'unary', operand: this.unary() };
    return this.primary();
  }

  primary(): Node {
    const token = this.peek();
    if (!token)
      throw new FormulaError('syntax error: unexpected end of formula');

    if (token.kind === 'number') {
      this.pos += 1;
      return { kind: 'num', value: Number(token.text) };
    }

    if (token.kind === 'ident') {
      // A wildcard reaching here is outside an argument list — args() consumes
      // legal ones before ever calling expr(), so this is the illegal case.
      const prefix = this.wildcardPrefixAt();
      if (prefix !== null) {
        throw new FormulaError(
          `wildcard ${JSON.stringify(
            `${prefix}*`
          )} is only valid as a function argument`
        );
      }
      this.pos += 1;
      if (this.eat('(')) {
        if (!FUNCTIONS.has(token.text)) {
          throw new FormulaError(
            `unknown function ${JSON.stringify(token.text)}`
          );
        }
        return { kind: 'call', name: token.text, args: this.args() };
      }
      return { kind: 'ref', id: token.text };
    }

    if (token.text === '(') {
      this.pos += 1;
      const node = this.expr();
      this.expect(')');
      return node;
    }

    throw new FormulaError(
      `syntax error: unexpected ${JSON.stringify(token.text)}`
    );
  }

  private args(): Node[] {
    const args: Node[] = [];
    if (this.eat(')')) return args;

    for (;;) {
      const prefix = this.wildcardPrefixAt();
      if (prefix !== null) {
        this.pos += 2; // consume the ident and its lone '*'
        args.push({ kind: 'wildcard', prefix });
      } else {
        args.push(this.expr());
      }
      if (this.eat(')')) return args;
      this.expect(',');
    }
  }
}

/** Parse a formula into an AST. Throws FormulaError on anything invalid. */
export const parse = (formula: string): Node =>
  new Parser(lex(formula)).parse();

// ── Dependencies ────────────────────────────────────────────────────────────
const collect = (node: Node, pick: (n: Node) => string[]): Set<string> => {
  const found = new Set(pick(node));
  const children =
    node.kind === 'unary'
      ? [node.operand]
      : node.kind === 'binary'
      ? [node.left, node.right]
      : node.kind === 'call'
      ? node.args
      : [];
  for (const child of children) {
    for (const value of collect(child, pick)) found.add(value);
  }
  return found;
};

/** Every token id referenced directly. Wildcards resolve at evaluation. */
export const dependencies = (node: Node): Set<string> =>
  collect(node, (n) => (n.kind === 'ref' ? [n.id] : []));

/** Prefixes this formula sums over, so a plan knows when membership shifts. */
export const wildcardPrefixes = (node: Node): Set<string> =>
  collect(node, (n) => (n.kind === 'wildcard' ? [n.prefix] : []));

// ── Evaluation ──────────────────────────────────────────────────────────────
/**
 * Half away from zero, matching Python's Decimal(ROUND_HALF_UP). Math.round
 * alone rounds -2.5 to -2, which would silently disagree with the server.
 * Exported for format.ts — ONE rounding rule, or a formatted display could
 * disagree with the formula that produced it.
 */
export const roundHalfAwayFromZero = (
  value: number,
  digits: number
): number => {
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * factor)) / factor;
};

const flatten = (node: Node, values: TokenValues): number[] => {
  // A repeated token resolves to every row's value, so SUM(item_total)
  // aggregates a column without the caller naming the rows.
  if (node.kind === 'ref') {
    const value = values.get(node.id);
    if (Array.isArray(value)) return value.filter((v) => Number.isFinite(v));
  }
  if (node.kind !== 'wildcard') return [evaluateNode(node, values)];
  return [...values.entries()]
    .filter(([id]) => id.startsWith(node.prefix))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]));
};

/**
 * A display function's argument, as text.
 *
 * Strings live only inside display functions, so the arithmetic evaluator stays
 * purely numeric and a text value can never be coerced into a number.
 */
const evaluateText = (node: Node, values: TokenValues): string => {
  if (node.kind === 'ref') {
    const value = values.get(node.id);
    if (value === undefined) {
      throw new FormulaError(`unknown token ${JSON.stringify(node.id)}`);
    }
    if (Array.isArray(value)) {
      throw new FormulaError(`${node.id} is a repeated field`);
    }
    return String(value);
  }
  if (node.kind === 'call' && DISPLAY_FUNCTIONS.has(node.name)) {
    if (node.args.length !== 1) {
      throw new FormulaError(`${node.name} takes exactly 1 argument`);
    }
    return DISPLAY[node.name](evaluateText(node.args[0], values));
  }
  if (node.kind === 'num') return String(node.value);
  throw new FormulaError('a display function takes a field or another display');
};

const evaluateNode = (node: Node, values: TokenValues): number => {
  switch (node.kind) {
    case 'num':
      return node.value;

    case 'ref': {
      const value = values.get(node.id);
      if (value === undefined) {
        throw new FormulaError(`unknown token ${JSON.stringify(node.id)}`);
      }
      if (Array.isArray(value)) {
        throw new FormulaError(
          `${node.id} is a repeated field; use an aggregate such as SUM(${node.id})`
        );
      }
      return value;
    }

    case 'wildcard':
      throw new FormulaError(
        `wildcard ${node.prefix}* is only valid as a function argument`
      );

    case 'unary':
      return -evaluateNode(node.operand, values);

    case 'binary': {
      const left = evaluateNode(node.left, values);
      const right = evaluateNode(node.right, values);
      if (node.op === '+') return left + right;
      if (node.op === '-') return left - right;
      if (node.op === '*') return left * right;
      if (right === 0) throw new FormulaError('division by zero');
      return left / right;
    }

    case 'call': {
      if (DISPLAY_FUNCTIONS.has(node.name)) {
        // A display function reached the numeric evaluator, which means it was
        // nested in arithmetic (e.g. SUM(UPPER(name), 5)). Its text result has
        // no numeric meaning, so reject it rather than silently casting. A
        // legitimate top-level display formula never lands here — evaluate()
        // routes it straight to evaluateText.
        throw new FormulaError(
          `display function ${node.name} cannot be used in a numeric formula`
        );
      }
      const args = node.args.flatMap((arg) => flatten(arg, values));

      if (node.name === 'SUM') return args.reduce((a, b) => a + b, 0);
      if (node.name === 'ABS') {
        if (args.length !== 1) {
          throw new FormulaError('ABS takes exactly 1 argument');
        }
        return Math.abs(args[0]);
      }
      if (node.name === 'ROUND') {
        if (args.length === 0) {
          throw new FormulaError('ROUND takes 1 or 2 arguments');
        }
        return roundHalfAwayFromZero(
          args[0],
          args.length > 1 ? Math.trunc(args[1]) : 0
        );
      }
      if (args.length === 0) {
        throw new FormulaError(`${node.name} takes at least 1 argument`);
      }
      return node.name === 'MIN' ? Math.min(...args) : Math.max(...args);
    }

    default:
      throw new FormulaError('syntax error: unrecognised expression');
  }
};

/** Evaluate a formula (or a pre-parsed AST) against a map of token values. */
export const evaluate = (
  formula: string | Node,
  values: TokenValues | Record<string, number | number[]>
): number => {
  const node = typeof formula === 'string' ? parse(formula) : formula;
  const map = values instanceof Map ? values : new Map(Object.entries(values));
  if (node.kind === 'call' && DISPLAY_FUNCTIONS.has(node.name)) {
    // The single place a display formula is text, returned through the numeric
    // signature for tokenCycle's expectedText. Nested display calls are caught
    // inside evaluateNode instead.
    return evaluateText(node, map) as unknown as number;
  }
  return evaluateNode(node, map);
};
