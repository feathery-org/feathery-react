// Allowlisted formula expressions -> AST. Never eval, never Function().
//
//   mul(quantity, unit_cost)     multiply, 2+ args
//   sum(costs.line_total)        sum; a dotted ref aggregates a table column
//   sub(subtotal, discount)      subtract, exactly 2 args
//   A                            bare reference; mirrors another value as-is
//   sum(B2:B9)  sum(B2:end)      positional range over the formula's own table
//   summary!B3, sum(summary!B2:end)   positional refs into a named table
//
// Args are references (bare column/field names or table.column), positional
// cells/ranges, numeric literals, or nested calls. A whole expression may also
// be a single reference, but never a single literal (a constant formula is a
// typo, not a binding). Anything else is a parse error.
//
// Positional refs are Excel-shaped and classified at PARSE time: a bare token
// matching /^[A-Z]{1,2}[1-9][0-9]*$/ (uppercase only) is a cell, `:` makes a
// range, `end` is the table's last physical row and is only valid as a range
// bound. Row 1 is the first physical table row (headers count). A binding
// named like an uppercase cell is shadowed - canonical binding names are
// effectively lowercase, so this does not bite in practice.

export class FormulaError extends Error {
  constructor(message?: string) {
    super(message);
    // The package compiles to es5, where the emit runs `Error.call(this, message)
    // || this` and Error-as-a-function returns a FRESH plain Error - so the
    // constructed object is not a FormulaError at runtime and `instanceof` is false.
    // Every catch site here distinguishes an expected value/parse failure from a
    // real bug, so losing that check turns a diagnostic into a thrown reconcile.
    // Restoring the prototype and stamping the name keeps both routes working.
    Object.setPrototypeOf(this, FormulaError.prototype);
    this.name = 'FormulaError';
  }
}

/**
 * True for a FormulaError, whether or not `instanceof` survived compilation. Catch
 * sites use this rather than `instanceof` so a downlevelled build cannot silently
 * reclassify an expected failure as a crash.
 */
export function isFormulaError(error: unknown): error is FormulaError {
  return (
    error instanceof FormulaError ||
    (!!error && (error as Error).name === 'FormulaError')
  );
}

export type FormulaOperator = 'multiply' | 'sum' | 'subtract';

/** A positional cell: col/row are 0-based col index, 1-based physical row. */
export interface CellRef {
  /** Table id from a `table!` qualifier, or null = the formula's own table. */
  table: string | null;
  col: number;
  row: number;
}

/** A rectangular range; endRow 'end' = the table's last physical row. */
export interface RangeRef {
  table: string | null;
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number | 'end';
}

export type Ast =
  | { lit: string }
  | { ref: string }
  | { cell: CellRef }
  | { range: RangeRef }
  | { op: FormulaOperator; args: Ast[] };

const CELL_RE = /^[A-Z]{1,2}([1-9][0-9]*)$/;

/** 'A' -> 0, 'Z' -> 25, 'AA' -> 26, ... */
function colIndex(letters: string): number {
  let out = 0;
  for (const ch of letters) out = out * 26 + (ch.charCodeAt(0) - 64);
  return out - 1;
}

function parseCellToken(value: string): { col: number; row: number } | null {
  const match = CELL_RE.exec(value);
  if (!match) return null;
  return {
    col: colIndex(value.slice(0, value.length - match[1].length)),
    row: Number(match[1])
  };
}

// Null prototypes so names like "constructor" cannot reach Object.prototype.
const FUNCTIONS: Record<string, FormulaOperator> = Object.assign(
  Object.create(null),
  { mul: 'multiply', sum: 'sum', sub: 'subtract' }
);
const ARITY: Record<FormulaOperator, [number, number]> = Object.assign(
  Object.create(null),
  {
    multiply: [2, Infinity],
    sum: [1, Infinity],
    subtract: [2, 2]
  }
);

interface Token {
  t: 'name' | 'num' | '(' | ')' | ',' | ':' | '!';
  v?: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  // Sticky (`y`) matching is what walks the input token by token. TypeScript
  // rejects the flag on a literal while the compile target is es5, so the same
  // regex is built through the constructor instead.
  const re = new RegExp(
    '\\s*(?:([A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*)|(-?\\d+(?:\\.\\d+)?)|([(),:!]))',
    'y'
  );
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const match = re.exec(src);
    if (!match) {
      if (/^\s*$/.test(src.slice(pos))) break;
      throw new FormulaError(
        `unexpected character at ${pos} in ${JSON.stringify(src)}`
      );
    }
    if (match[1] !== undefined) tokens.push({ t: 'name', v: match[1] });
    else if (match[2] !== undefined) tokens.push({ t: 'num', v: match[2] });
    else tokens.push({ t: match[3] as Token['t'] });
    pos = re.lastIndex;
  }
  return tokens;
}

export function parseExpression(src: string): Ast {
  const tokens = tokenize(src);
  let i = 0;
  const peek = (): Token | undefined => tokens[i];
  const eat = (t: Token['t']): Token => {
    if (!tokens[i] || tokens[i].t !== t)
      throw new FormulaError(`expected ${t} in ${JSON.stringify(src)}`);
    return tokens[i++];
  };

  /** Cell or range starting at the current name token. */
  function positional(table: string | null): Ast {
    const start = eat('name');
    const startCell = parseCellToken(start.v as string);
    if (!startCell)
      throw new FormulaError(
        `expected a cell like B2, got ${JSON.stringify(start.v)} in ${JSON.stringify(src)}`
      );
    if (peek()?.t !== ':') return { cell: { table, ...startCell } };
    eat(':');
    const bound = eat('name');
    if (bound.v === 'end') {
      return {
        range: {
          table,
          startCol: startCell.col,
          startRow: startCell.row,
          endCol: startCell.col,
          endRow: 'end'
        }
      };
    }
    const boundCell = parseCellToken(bound.v as string);
    if (!boundCell)
      throw new FormulaError(
        `range bound must be a cell like B9 or "end", got ${JSON.stringify(
          bound.v
        )} in ${JSON.stringify(src)}`
      );
    return {
      range: {
        table,
        startCol: Math.min(startCell.col, boundCell.col),
        startRow: Math.min(startCell.row, boundCell.row),
        endCol: Math.max(startCell.col, boundCell.col),
        endRow: Math.max(startCell.row, boundCell.row)
      }
    };
  }

  function term(): Ast {
    const token = peek();
    if (!token)
      throw new FormulaError(`unexpected end of ${JSON.stringify(src)}`);
    if (token.t === 'num') {
      i++;
      return { lit: token.v as string };
    }
    if (token.t !== 'name')
      throw new FormulaError(`unexpected token in ${JSON.stringify(src)}`);
    i++;
    if (peek()?.t === '!') {
      eat('!');
      if ((token.v as string).includes('.'))
        throw new FormulaError(
          `bad table name before "!" in ${JSON.stringify(src)}`
        );
      return positional(token.v as string);
    }
    if (peek()?.t === '(') {
      const op = FUNCTIONS[token.v as string];
      if (!op)
        throw new FormulaError(
          `unknown function ${JSON.stringify(token.v)} (allowed: mul, sum, sub)`
        );
      eat('(');
      const args: Ast[] = [term()];
      while (peek()?.t === ',') {
        eat(',');
        args.push(term());
      }
      eat(')');
      const [min, max] = ARITY[op];
      if (args.length < min || args.length > max) {
        throw new FormulaError(
          `${token.v} takes ${min === max ? min : `${min}+`} args, got ${
            args.length
          }`
        );
      }
      return { op, args };
    }
    const cellStart = parseCellToken(token.v as string);
    if (cellStart || peek()?.t === ':') {
      i--; // hand the name back to the positional parser
      return positional(null);
    }
    if (token.v === 'end')
      throw new FormulaError(
        `"end" is only valid as a range bound: ${JSON.stringify(src)}`
      );
    return { ref: token.v as string };
  }

  const ast = term();
  if (i !== tokens.length)
    throw new FormulaError(`trailing input in ${JSON.stringify(src)}`);
  if ('lit' in ast)
    throw new FormulaError(
      `expression must reference a value: ${JSON.stringify(src)}`
    );
  return ast;
}

/** Every reference mentioned anywhere in the AST. */
export function collectRefs(ast: Ast, out: string[] = []): string[] {
  if ('ref' in ast) out.push(ast.ref);
  if ('args' in ast) for (const arg of ast.args) collectRefs(arg, out);
  return out;
}

/** Every positional cell and range mentioned anywhere in the AST. */
export function collectPositional(
  ast: Ast,
  out: { cells: CellRef[]; ranges: RangeRef[] } = { cells: [], ranges: [] }
): { cells: CellRef[]; ranges: RangeRef[] } {
  if ('cell' in ast) out.cells.push(ast.cell);
  if ('range' in ast) out.ranges.push(ast.range);
  if ('args' in ast) for (const arg of ast.args) collectPositional(arg, out);
  return out;
}
