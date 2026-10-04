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

  it('parses a bare reference as a whole expression (mirror authoring)', () => {
    expect(parseExpression('alpha')).toEqual({ ref: 'alpha' });
    expect(parseExpression('costs.line_total')).toEqual({
      ref: 'costs.line_total'
    });
    expect(collectRefs(parseExpression('alpha'))).toEqual(['alpha']);
  });

  it('parses positional cells and ranges', () => {
    // A BARE cell-shaped token stays a ref; the engine decides cell-vs-name at
    // eval, so a binding named B3/Q1/FY2024 is never stolen by cell parsing.
    expect(parseExpression('B3')).toEqual({ ref: 'B3' });
    expect(parseExpression('Q1')).toEqual({ ref: 'Q1' });
    expect(parseExpression('FY2024')).toEqual({ ref: 'FY2024' });
    expect(parseExpression('sum(Q1,Q2,Q3,Q4)')).toEqual({
      op: 'sum',
      args: [{ ref: 'Q1' }, { ref: 'Q2' }, { ref: 'Q3' }, { ref: 'Q4' }]
    });
    // A `table!`-qualified cell is unambiguous, so it stays a cell.
    expect(parseExpression('summary!B3')).toEqual({
      cell: { table: 'summary', col: 1, row: 3 }
    });
    expect(parseExpression('sum(B2:B9)')).toEqual({
      op: 'sum',
      args: [
        {
          range: { table: null, startCol: 1, startRow: 2, endCol: 1, endRow: 9 }
        }
      ]
    });
    expect(parseExpression('sum(B2:end)')).toEqual({
      op: 'sum',
      args: [
        {
          range: {
            table: null,
            startCol: 1,
            startRow: 2,
            endCol: 1,
            endRow: 'end'
          }
        }
      ]
    });
    expect(parseExpression('sum(summary!B2:end)')).toEqual({
      op: 'sum',
      args: [
        {
          range: {
            table: 'summary',
            startCol: 1,
            startRow: 2,
            endCol: 1,
            endRow: 'end'
          }
        }
      ]
    });
    // Bounds normalize: B9:B2 is the same range as B2:B9.
    expect(parseExpression('sum(B9:B2)')).toEqual(
      parseExpression('sum(B2:B9)')
    );
    // A range's bounds are always positional (a range of names is meaningless).
    expect(parseExpression('sum(Q1:Q4)')).toEqual({
      op: 'sum',
      args: [
        {
          range: {
            table: null,
            startCol: 16,
            startRow: 1,
            endCol: 16,
            endRow: 4
          }
        }
      ]
    });
    expect(parseExpression('b2')).toEqual({ ref: 'b2' });
  });

  it('rejects malformed positional refs', () => {
    const bad = [
      'sum(end:B2)',
      'sum(B2:)',
      'sum(B2:foo)',
      'foo:B2', // range must start with a cell
      'a.b!B2', // dotted table qualifier
      'summary!foo' // qualifier must be followed by a cell
    ];
    for (const src of bad) {
      expect(() => parseExpression(src)).toThrow(FormulaError);
    }
  });

  it('rejects everything outside the allowlist', () => {
    const bad = [
      '100.50', // bare literal: a constant formula is a typo, not a binding
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

it('preserves end as a binding name outside a range bound', () => {
  expect(parseExpression('end')).toEqual({ ref: 'end' });
  expect(parseExpression('sum(end)')).toEqual({
    op: 'sum',
    args: [{ ref: 'end' }]
  });
});
