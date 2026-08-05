/**
 * The JavaScript half of the shared token-grammar contract.
 *
 * Both evaluators read the same case list. If this suite and its Python twin
 * (feathery-backend apps/document/tests/test_token_grammar.py) disagree, a
 * document filled on the server and edited in the browser would show
 * different numbers.
 */


import {
  dependencies,
  evaluate,
  FormulaError,
  parse,
  wildcardPrefixes
} from '../grammar';
import grammarCases from '../grammarCases.json';

type Case = {
  why: string;
  formula: string;
  values: Record<string, number | string>;
  expect?: number;
  expectText?: string;
  error?: string;
};

const CASES = grammarCases.cases as Case[];

describe('token grammar — shared contract', () => {
  it.each(CASES.map((c) => [c.why, c] as const))('%s', (_why, testCase) => {
    if (testCase.error !== undefined) {
      let thrown: unknown;
      try {
        evaluate(testCase.formula, testCase.values);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(FormulaError);
      expect(String((thrown as Error).message).toLowerCase()).toContain(
        testCase.error.toLowerCase()
      );
    } else if (testCase.expectText !== undefined) {
      // Display functions return text through the numeric signature.
      expect(evaluate(testCase.formula, testCase.values as any)).toBe(
        testCase.expectText
      );
    } else {
      expect(
        evaluate(testCase.formula, testCase.values as Record<string, number>)
      ).toBeCloseTo(testCase.expect as number, 9);
    }
  });

  it('reads a fixture that is actually populated', () => {
    // Guards against a truncated or unparsed fixture silently passing.
    expect(CASES.length).toBeGreaterThan(30);
    expect(CASES.some((c) => c.error !== undefined)).toBe(true);
    expect(CASES.some((c) => c.expectText !== undefined)).toBe(true);
  });

  it('matches the pinned cross-repo fixture hash', () => {
    // The Python twin pins the SAME constant over its own copy. Editing one
    // copy fails this until the other copy — and both constants — move too,
    // which is the only cross-repo sync check CI can run.
    const stable = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
      if (value !== null && typeof value === 'object') {
        const entries = Object.keys(value as Record<string, unknown>)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${stable(
                (value as Record<string, unknown>)[key]
              )}`
          );
        return `{${entries.join(',')}}`;
      }
      return JSON.stringify(value);
    };
    // eslint-disable-next-line global-require
    const hash = require('crypto')
      .createHash('sha256')
      .update(stable(CASES), 'utf8')
      .digest('hex');
    expect(hash).toBe(
      'c44d26259d1f99dabb4141dabcaab16c86b4d76d325badf84a51671d6bb59d57'
    );
  });
});

describe('dependency extraction', () => {
  it('finds direct references', () => {
    expect(dependencies(parse('qty * unit_cost + 5'))).toEqual(
      new Set(['qty', 'unit_cost'])
    );
  });

  it('finds references inside calls', () => {
    expect(
      dependencies(parse('ROUND(subtotal * tax_percent / 100, 2)'))
    ).toEqual(new Set(['subtotal', 'tax_percent']));
  });

  it('does not treat wildcards as direct dependencies', () => {
    expect(dependencies(parse('SUM(item_total_*, adjustment)'))).toEqual(
      new Set(['adjustment'])
    );
  });

  it('reports wildcard prefixes', () => {
    expect(wildcardPrefixes(parse('SUM(item_total_*) + MAX(tax_*)'))).toEqual(
      new Set(['item_total_', 'tax_'])
    );
  });

  it('reports nothing for a constant formula', () => {
    expect(dependencies(parse('1 + 2'))).toEqual(new Set());
  });
});

describe('evaluator safety', () => {
  // The parser is the sandbox — nothing outside the grammar may evaluate.
  const hostile = [
    'constructor.constructor("return 1")()',
    'a.b',
    '__import__("os")',
    '"abc"',
    '9 ** 9 ** 9',
    'a[0]'
  ];

  it.each(hostile)('rejects %s', (formula) => {
    expect(() => evaluate(formula, { a: 1 })).toThrow(FormulaError);
  });

  it('treats an unknown token as an error, never zero', () => {
    expect(() => evaluate('missing + 1', {})).toThrow(FormulaError);
  });
});
