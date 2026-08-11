// Allowlisted formula expressions -> AST. Never eval, never Function().
//
//   mul(quantity, unit_cost)     multiply, 2+ args
//   sum(costs.line_total)        sum; a dotted ref aggregates a table column
//   sub(subtotal, discount)      subtract, exactly 2 args
//
// Args are references (bare column/field names or table.column), numeric
// literals, or nested calls. Anything else is a parse error.

export class FormulaError extends Error {}

export type FormulaOperator = 'multiply' | 'sum' | 'subtract';

export type Ast =
  | { lit: string }
  | { ref: string }
  | { op: FormulaOperator; args: Ast[] };

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
  t: 'name' | 'num' | '(' | ')' | ',';
  v?: string;
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /\s*(?:([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)|(-?\d+(?:\.\d+)?)|([(),]))/y;
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
    if (peek()?.t === '(') {
      const op = FUNCTIONS[token.v as string];
      if (!op)
        throw new FormulaError(
          `unknown function ${JSON.stringify(
            token.v
          )} (allowed: mul, sum, sub)`
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
    return { ref: token.v as string };
  }

  const ast = term();
  if (i !== tokens.length)
    throw new FormulaError(`trailing input in ${JSON.stringify(src)}`);
  if (!('op' in ast))
    throw new FormulaError(
      `expression must be a function call: ${JSON.stringify(src)}`
    );
  return ast;
}

/** Every reference mentioned anywhere in the AST. */
export function collectRefs(ast: Ast, out: string[] = []): string[] {
  if ('ref' in ast) out.push(ast.ref);
  if ('args' in ast) for (const arg of ast.args) collectRefs(arg, out);
  return out;
}
