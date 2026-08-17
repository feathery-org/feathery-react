// Ported from the POC's test/formula.test.js. The rejection list is the security
// contract: the parser is an allowlist, so anything that looks like code - eval,
// operators, statement separators, Object.prototype names - has to fail rather
// than be interpreted.
import { collectRefs, FormulaError, parseExpression } from '../formula';

describe('formula', () => {
  it('parses the MVP vocabulary', () => {
    expect(parseExpression('mul(quantity,unit_cost)')).toEqual({
      op: 'multiply',
      args: [{ ref: 'quantity' }, { ref: 'unit_cost' }]
    });
    expect(parseExpression('sum(costs.line_total)')).toEqual({
      op: 'sum',
      args: [{ ref: 'costs.line_total' }]
    });
    expect(parseExpression('sub(subtotal, discount)')).toEqual({
      op: 'subtract',
      args: [{ ref: 'subtotal' }, { ref: 'discount' }]
    });
  });

  it('handles nesting and literals', () => {
    const ast = parseExpression('sub(sum(costs.line_total), 100.50)') as any;
    expect(ast.op).toBe('subtract');
    expect(ast.args[0].op).toBe('sum');
    expect(ast.args[1].lit).toBe('100.50');
    expect(collectRefs(ast)).toEqual(['costs.line_total']);
  });

  it('rejects everything outside the allowlist', () => {
    const bad = [
      'quantity', // bare ref, not a call
      'div(a,b)', // unknown function
      'eval(x)',
      'mul(quantity)', // arity
      'sub(a,b,c)', // arity
      'mul(a,b) + 1', // no operators
      'mul(a,)',
      'a; process.exit()',
      'constructor(x)' // must not reach Object.prototype
    ];
    for (const src of bad) {
      expect(() => parseExpression(src)).toThrow(FormulaError);
    }
  });
});
