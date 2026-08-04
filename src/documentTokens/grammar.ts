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

// Only these may be called. Anything else is rejected at parse time.
export const FUNCTIONS = new Set(['SUM', 'ROUND', 'MIN', 'MAX', 'ABS']);

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

type Lexeme = { kind: 'number' | 'wildcard' | 'ident' | 'op'; text: string };

// ── Lexer ───────────────────────────────────────────────────────────────────
const PATTERNS: Array<[Lexeme['kind'] | 'space', RegExp]> = [
  ['space', /^\s+/],
  ['number', /^(?:\d+\.\d+|\d+)/],
  ['wildcard', /^[A-Za-z_][A-Za-z0-9_]*\*/],
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

  constructor(private readonly lexemes: Lexeme[]) {}

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

    if (token.kind === 'wildcard') {
      // Only meaningful as a function argument; expr() never accepts it.
      throw new FormulaError(
        `wildcard ${JSON.stringify(
          token.text
        )} is only valid as a function argument`
      );
    }

    if (token.kind === 'ident') {
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
      const token = this.peek();
      if (token?.kind === 'wildcard') {
        this.pos += 1;
        args.push({ kind: 'wildcard', prefix: token.text.slice(0, -1) });
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
 */
const roundHalfAwayFromZero = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * factor)) / factor;
};

const flatten = (node: Node, values: Map<string, number>): number[] => {
  if (node.kind !== 'wildcard') return [evaluateNode(node, values)];
  return [...values.entries()]
    .filter(([id]) => id.startsWith(node.prefix))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => value);
};

const evaluateNode = (node: Node, values: Map<string, number>): number => {
  switch (node.kind) {
    case 'num':
      return node.value;

    case 'ref': {
      const value = values.get(node.id);
      if (value === undefined) {
        throw new FormulaError(`unknown token ${JSON.stringify(node.id)}`);
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
  values: Map<string, number> | Record<string, number>
): number => {
  const node = typeof formula === 'string' ? parse(formula) : formula;
  const map = values instanceof Map ? values : new Map(Object.entries(values));
  return evaluateNode(node, map);
};
