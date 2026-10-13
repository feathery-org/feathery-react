// The formula grammar, the exact arithmetic, the single rounding point, and
// every refusal - one test per element and one per rejection path.
//
// The invariant under test throughout: the model supplies a formula, the ENGINE
// supplies every number. So a formula with no reference is refused, a reference
// that does not resolve is refused, a non-numeric cell is refused rather than
// zeroed, and anything outside the grammar is refused rather than attempted.
import {
  evaluateFormula,
  parseReference,
  rationalToScaled,
  ROUNDING_MODES,
  RoundingMode
} from '../cellFormula';
import { runFormula, stubResolver } from './formulaHarness';

// Rows 0..5 of column 1 of the table at 0;7.
const COLUMN = [
  'Premium', // 0
  '$36,803.00', // 1
  '$12,450.00', // 2
  'Included', // 3
  '$1,200.00', // 4
  '$99,999.00' // 5 (a stale total, the usual write target)
];

const on = (
  formula: string,
  target: string | null = '$0.00',
  options: Parameters<typeof runFormula>[3] = {}
) => runFormula(COLUMN, formula, target, options);

// ---------------------------------------------------------------------------
// Grammar: one case per element.
// ---------------------------------------------------------------------------

describe('grammar: references', () => {
  it('resolves a single-cell reference', () => {
    expect(on('[0;7;1;1;0]')).toMatchObject({
      ok: true,
      renderedValue: '$36,803.00',
      counted: 1
    });
  });

  it('resolves a row-range reference through an aggregate', () => {
    expect(on('sum([0;7;1..4;1])')).toMatchObject({
      ok: true,
      renderedValue: '$50,453.00',
      counted: 3
    });
  });

  it('parses both reference shapes and nothing else', () => {
    expect(parseReference('0;7;5;3;0')).toEqual({
      kind: 'cell',
      anchor: '0;7;5;3;0'
    });
    expect(parseReference('0;7;1..93;3')).toEqual({
      kind: 'range',
      tableAnchor: '0;7',
      column: 3,
      startRow: 1,
      endRow: 93
    });
    // A single-row range is legal and means exactly that row.
    expect(parseReference('0;7;5..5;3')).toMatchObject({
      startRow: 5,
      endRow: 5
    });
    for (const bad of [
      '0;7;5', // too few components
      '0;7;5;3', // 4 components without a range
      '0;7;5;3;0;1', // too many
      'A1', // spreadsheet style
      '0;7;1..93;3;0', // range plus a paragraph index
      '0;7;93..1;3', // reversed
      '0;7;..93;3', // open start
      '0;7;1..;3', // open end
      '0;x;1..2;3', // non-numeric component
      '0;7;1..2;-1', // negative column
      '' // empty
    ]) {
      expect(parseReference(bad)).toBeNull();
    }
  });
});

describe('grammar: literals', () => {
  it('accepts an integer literal', () => {
    expect(on('[0;7;4;1;0] * 2')).toMatchObject({
      ok: true,
      renderedValue: '$2,400.00'
    });
  });

  it('accepts a decimal literal', () => {
    expect(on('[0;7;4;1;0] * 1.5')).toMatchObject({
      ok: true,
      renderedValue: '$1,800.00'
    });
  });

  it('accepts a percent literal as an exact hundredth', () => {
    expect(on('[0;7;4;1;0] * 13%')).toMatchObject({
      ok: true,
      renderedValue: '$156.00'
    });
    // 13% is exactly 13/100, so (1 + 13%) is exactly 1.13.
    expect(on('[0;7;4;1;0] * (1 + 13%)')).toMatchObject({
      ok: true,
      renderedValue: '$1,356.00'
    });
    expect(on('[0;7;4;1;0] * 1.13')).toMatchObject({
      ok: true,
      renderedValue: '$1,356.00'
    });
  });

  it('accepts a fractional percent literal', () => {
    expect(on('[0;7;4;1;0] * 12.5%')).toMatchObject({
      ok: true,
      renderedValue: '$150.00'
    });
  });
});

describe('grammar: operators', () => {
  it('adds and subtracts', () => {
    expect(on('[0;7;1;1;0] + [0;7;2;1;0]')).toMatchObject({
      ok: true,
      renderedValue: '$49,253.00'
    });
    expect(on('[0;7;1;1;0] - [0;7;2;1;0]')).toMatchObject({
      ok: true,
      renderedValue: '$24,353.00'
    });
  });

  it('multiplies and divides', () => {
    expect(on('[0;7;4;1;0] * 3')).toMatchObject({
      ok: true,
      renderedValue: '$3,600.00'
    });
    expect(on('[0;7;4;1;0] / 4')).toMatchObject({
      ok: true,
      renderedValue: '$300.00'
    });
  });

  it('gives * and / precedence over + and -', () => {
    // 1,200 + 12,450 * 2 = 26,100, not (1,200 + 12,450) * 2 = 27,300.
    expect(on('[0;7;4;1;0] + [0;7;2;1;0] * 2')).toMatchObject({
      ok: true,
      renderedValue: '$26,100.00'
    });
  });

  it('respects parentheses over precedence', () => {
    expect(on('([0;7;4;1;0] + [0;7;2;1;0]) * 2')).toMatchObject({
      ok: true,
      renderedValue: '$27,300.00'
    });
  });

  it('nests parentheses to any depth', () => {
    expect(on('(([0;7;4;1;0] + (100 * 2)) * 2)')).toMatchObject({
      ok: true,
      renderedValue: '$2,800.00'
    });
  });

  it('is left-associative for - and /', () => {
    // 36,803 - 12,450 - 1,200 = 23,153 (not 36,803 - (12,450 - 1,200)).
    expect(on('[0;7;1;1;0] - [0;7;2;1;0] - [0;7;4;1;0]')).toMatchObject({
      ok: true,
      renderedValue: '$23,153.00'
    });
    // 1,200 / 4 / 3 = 100 (not 1,200 / (4 / 3) = 900).
    expect(on('[0;7;4;1;0] / 4 / 3')).toMatchObject({
      ok: true,
      renderedValue: '$100.00'
    });
  });

  it('accepts unary minus and unary plus', () => {
    expect(on('-[0;7;4;1;0]', '$0.00')).toMatchObject({
      ok: true,
      renderedValue: '-$1,200.00'
    });
    expect(on('+[0;7;4;1;0]')).toMatchObject({
      ok: true,
      renderedValue: '$1,200.00'
    });
    // Unary minus binds tighter than the binary operators around it.
    expect(on('[0;7;2;1;0] + -[0;7;4;1;0]')).toMatchObject({
      ok: true,
      renderedValue: '$11,250.00'
    });
  });

  it('ignores whitespace, including none at all', () => {
    expect(on('  sum( [0;7;1..4;1] )  +  0  ')).toMatchObject({
      ok: true,
      renderedValue: '$50,453.00'
    });
    expect(on('sum([0;7;1..4;1])+0')).toMatchObject({
      ok: true,
      renderedValue: '$50,453.00'
    });
  });
});

describe('grammar: the five functions', () => {
  it('sum adds every numeric cell in the range', () => {
    expect(on('sum([0;7;1..4;1])')).toMatchObject({
      ok: true,
      renderedValue: '$50,453.00',
      counted: 3
    });
  });

  it('average divides exactly and rounds only where told to', () => {
    expect(
      on('average([0;7;1..4;1])', '$0.00', { round: 'half_up' })
    ).toMatchObject({
      ok: true,
      // 50,453 / 3 = 16,817.666..., half_up at 2 decimals.
      renderedValue: '$16,817.67',
      rounded: true,
      roundingMode: 'half_up'
    });
  });

  it('min and max compare exactly', () => {
    expect(on('min([0;7;1..4;1])')).toMatchObject({
      ok: true,
      renderedValue: '$1,200.00'
    });
    expect(on('max([0;7;1..4;1])')).toMatchObject({
      ok: true,
      renderedValue: '$36,803.00'
    });
  });

  it('count tallies the numeric cells only', () => {
    expect(on('count([0;7;1..4;1])', '0')).toMatchObject({
      ok: true,
      renderedValue: '3',
      tally: true
    });
  });

  it('composes an aggregate with arithmetic', () => {
    expect(
      on('sum([0;7;1..4;1]) / 12', '$0.00', { round: 'half_up' })
    ).toMatchObject({ ok: true, renderedValue: '$4,204.42', rounded: true });
    expect(
      on('sum([0;7;1..4;1]) / count([0;7;1..4;1])', '$0.00', {
        round: 'half_up'
      })
    ).toMatchObject({ ok: true, renderedValue: '$16,817.67' });
  });

  it('composes two ranges in one formula', () => {
    expect(on('sum([0;7;1..2;1]) + sum([0;7;4..4;1])')).toMatchObject({
      ok: true,
      renderedValue: '$50,453.00',
      counted: 3
    });
  });
});

// ---------------------------------------------------------------------------
// Exactness: the arithmetic is rational, so nothing rounds until the end.
// ---------------------------------------------------------------------------

describe('exact arithmetic', () => {
  it('a non-terminating intermediate is carried exactly, not rounded twice', () => {
    // 100/3 is non-terminating; x3 restores exactly 100. A float or a
    // round-at-each-step implementation loses this.
    expect(
      runFormula(['h', '$100.00'], '[0;7;1;1;0] / 3 * 3', '$0.00')
    ).toMatchObject({ ok: true, renderedValue: '$100.00', rounded: false });
  });

  it('a tax calculation is exact to the cent before rounding is even considered', () => {
    // 84,193.99 x 1.13 = 95,139.2087 exactly. At 2 decimals it needs rounding;
    // at 4 it does not.
    expect(
      runFormula(['h', '$84,193.99'], '[0;7;1;1;0] * 1.13', '$0.00', {
        decimals: 4
      })
    ).toMatchObject({
      ok: true,
      renderedValue: '$95,139.2087',
      rounded: false
    });
    expect(
      runFormula(['h', '$84,193.99'], '[0;7;1;1;0] * 1.13', '$0.00', {
        round: 'half_up'
      })
    ).toMatchObject({ ok: true, renderedValue: '$95,139.21', rounded: true });
  });

  it('percent and decimal spellings of the same rate agree exactly', () => {
    const viaPercent = runFormula(
      ['h', '$84,193.99'],
      '[0;7;1;1;0] * (1 + 13%)',
      '$0.00',
      { decimals: 4 }
    );
    const viaDecimal = runFormula(
      ['h', '$84,193.99'],
      '[0;7;1;1;0] * 1.13',
      '$0.00',
      { decimals: 4 }
    );
    expect(viaPercent.renderedValue).toBe(viaDecimal.renderedValue);
  });
});

// ---------------------------------------------------------------------------
// Rounding: explicit, single-point, and reported.
// ---------------------------------------------------------------------------

describe('rounding is explicit and happens exactly once', () => {
  const half = (mode: RoundingMode, decimals = 0) =>
    rationalToScaled({ n: 5, d: 2 }, decimals, mode); // exactly 2.5
  const negativeHalf = (mode: RoundingMode) =>
    rationalToScaled({ n: -5, d: 2 }, 0, mode); // exactly -2.5

  it('half_up goes away from zero on a tie, in both directions', () => {
    expect(half('half_up')!.value.units).toBe(3);
    expect(negativeHalf('half_up')!.value.units).toBe(-3);
  });

  it('half_even goes to the even neighbour on a tie', () => {
    expect(half('half_even')!.value.units).toBe(2); // 2.5 -> 2
    expect(rationalToScaled({ n: 7, d: 2 }, 0, 'half_even')!.value.units).toBe(
      4
    ); // 3.5 -> 4
    expect(negativeHalf('half_even')!.value.units).toBe(-2);
  });

  it('toward_zero truncates in both directions', () => {
    expect(half('toward_zero')!.value.units).toBe(2);
    expect(negativeHalf('toward_zero')!.value.units).toBe(-2);
  });

  it('away_from_zero inflates the magnitude in both directions', () => {
    expect(
      rationalToScaled({ n: 21, d: 10 }, 0, 'away_from_zero')!.value.units
    ).toBe(3);
    expect(
      rationalToScaled({ n: -21, d: 10 }, 0, 'away_from_zero')!.value.units
    ).toBe(-3);
  });

  it('an exact value is never reported as rounded, whatever mode is offered', () => {
    for (const mode of ROUNDING_MODES) {
      const exact = rationalToScaled({ n: 4, d: 2 }, 0, mode)!;
      expect(exact).toMatchObject({ rounded: false });
      expect(exact.value.units).toBe(2);
    }
  });

  it('with no mode declared, a value that does not fit returns null so the caller must refuse', () => {
    expect(rationalToScaled({ n: 5, d: 2 }, 0, null)).toBeNull();
    expect(rationalToScaled({ n: 4, d: 2 }, 0, null)).toMatchObject({
      rounded: false
    });
  });

  it('the refusal names the modes and the exact value it would have had to trim', () => {
    const result = on('sum([0;7;1..4;1]) / 7', '$0.00');
    expect(result).toMatchObject({ ok: false, error: 'rounding_required' });
    for (const mode of ROUNDING_MODES) {
      expect(result.message).toContain(mode);
    }
  });

  it('`decimals` widens the target format instead of rounding', () => {
    expect(on('sum([0;7;1..4;1]) / 8', '$0.00', { decimals: 3 })).toMatchObject(
      {
        ok: true,
        renderedValue: '$6,306.625',
        decimals: 3,
        rounded: false
      }
    );
  });
});

// ---------------------------------------------------------------------------
// Refusals: one test per rejection path.
// ---------------------------------------------------------------------------

describe('refusals: the formula itself', () => {
  it('an empty formula is refused with the shape of a valid one', () => {
    for (const empty of ['', '   ', null as any, undefined as any]) {
      const result = on(empty);
      expect(result).toMatchObject({ ok: false, error: 'missing_formula' });
      expect(result.message).toContain('[0;7;5;3;0]');
    }
  });

  it('a formula with NO reference is refused - that is a model-authored number', () => {
    for (const literalOnly of ['1234', '1.13 * 100', '13%', '(2 + 3) * 4']) {
      const result = on(literalOnly);
      expect(result).toMatchObject({ ok: false, error: 'no_reference' });
      expect(result.message).toContain('no cell reference');
    }
  });

  it('a character outside the grammar is refused, never interpreted', () => {
    for (const bad of [
      '[0;7;1;1;0] & 2',
      '[0;7;1;1;0] ^ 2',
      '[0;7;1;1;0] ** 2',
      '[0;7;1;1;0] % 2',
      '[0;7;1;1;0] , 2',
      '[0;7;1;1;0]; 2',
      '[0;7;1;1;0] = 2',
      '[0;7;1;1;0] < 2',
      "'x' + [0;7;1;1;0]",
      '[0;7;1;1;0] + $2'
    ]) {
      expect(on(bad).ok).toBe(false);
    }
  });

  it('there is no eval: a JS payload is refused as syntax, and nothing runs', () => {
    const canary = { hit: false };
    (globalThis as any).__formulaCanary = () => {
      canary.hit = true;
      return 1;
    };
    try {
      for (const payload of [
        '__formulaCanary()',
        '[0;7;1;1;0] + __formulaCanary()',
        'globalThis.__formulaCanary()',
        'process.exit(1)',
        'constructor.constructor("return 1")()'
      ]) {
        expect(on(payload).ok).toBe(false);
      }
      expect(canary.hit).toBe(false);
    } finally {
      delete (globalThis as any).__formulaCanary;
    }
  });

  it('an unbalanced bracket or parenthesis is refused', () => {
    for (const bad of [
      '[0;7;1;1;0',
      'sum([0;7;1..4;1]',
      '([0;7;1;1;0] + 1',
      '[0;7;1;1;0] + 1)',
      'sum[0;7;1..4;1]'
    ]) {
      expect(on(bad).ok).toBe(false);
    }
  });

  it('a dangling or doubled operator is refused', () => {
    for (const bad of [
      '[0;7;1;1;0] +',
      '* [0;7;1;1;0]',
      '[0;7;1;1;0] * / 2',
      '[0;7;1;1;0] +* 2',
      '()'
    ]) {
      expect(on(bad).ok).toBe(false);
    }
  });

  it('an ambiguous number literal is refused rather than guessed', () => {
    // A grouping separator in a LITERAL is ambiguous (1,234 vs 1.234), and an
    // exponent is not in the grammar. Cell VALUES may carry separators; the
    // formula's own literals may not.
    for (const bad of [
      '[0;7;1;1;0] * 1,234',
      '[0;7;1;1;0] * 1e3',
      '[0;7;1;1;0] * 1E3',
      '[0;7;1;1;0] * 1.',
      '[0;7;1;1;0] * .5'
    ]) {
      const result = on(bad);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('formula_syntax');
    }
  });

  it('trailing content after a complete expression is refused', () => {
    expect(on('[0;7;1;1;0] 2').ok).toBe(false);
    expect(on('sum([0;7;1..4;1]) sum([0;7;1..4;1])').ok).toBe(false);
  });
});

describe('refusals: functions', () => {
  it('an unknown function is refused by name, and the real set is named', () => {
    for (const bad of ['median', 'total', 'round', 'stdev', 'eval']) {
      const result = on(`${bad}([0;7;1..4;1])`);
      expect(result).toMatchObject({ ok: false, error: 'unknown_function' });
      expect(result.message).toContain('sum, average, min, max, count');
    }
  });

  it('a function needs a range, not a value, an expression, or nothing', () => {
    expect(on('sum(1)')).toMatchObject({
      ok: false,
      error: 'bad_function_argument'
    });
    expect(on('sum([0;7;1;1;0])')).toMatchObject({
      ok: false,
      error: 'bad_function_argument'
    });
    expect(on('sum([0;7;1..4;1] + 1)')).toMatchObject({
      ok: false,
      error: 'bad_function_argument'
    });
    expect(on('sum()')).toMatchObject({
      ok: false,
      error: 'bad_function_argument'
    });
    expect(on('sum')).toMatchObject({ ok: false, error: 'formula_syntax' });
  });

  it('a bare range where a single value belongs names the aggregates as the fix', () => {
    const result = on('[0;7;1..4;1] * 2');
    expect(result).toMatchObject({ ok: false, error: 'bad_reference' });
    expect(result.message).toContain('sum([0;7;1..4;1])');
  });
});

describe('refusals: references that do not resolve', () => {
  it('a cell anchor with no cell behind it is refused, never zero', () => {
    const result = on('[0;7;99;1;0] * 2');
    expect(result).toMatchObject({ ok: false, error: 'reference_not_found' });
    expect(result.message).toContain('[0;7;99;1;0]');
  });

  it('a table anchor with no table behind it is refused', () => {
    const result = on('sum([9;9;1..2;1])');
    expect(result).toMatchObject({ ok: false, error: 'reference_not_found' });
    expect(result.message).toContain('9;9');
  });

  it('a column past the table width is refused, naming the real width', () => {
    const result = on('sum([0;7;1..2;7])');
    expect(result).toMatchObject({ ok: false, error: 'reference_not_found' });
    expect(result.message).toContain('2 columns');
  });

  it('a row range running off the end of the table is refused, not silently shortened', () => {
    const result = on('sum([0;7;1..500;1])');
    expect(result).toMatchObject({ ok: false, error: 'reference_not_found' });
    expect(result.message).toContain('6 rows');
  });

  it('a non-numeric cell is refused with its content quoted, never treated as zero', () => {
    const result = on('[0;7;3;1;0] * 1.13');
    expect(result).toMatchObject({ ok: false, error: 'cell_not_numeric' });
    expect(result.message).toContain('Included');
    expect(result.message).toContain('not a number');
  });

  it('a missing cell in a short row is refused as unresolvable, not as zero', () => {
    const result = runFormula(['h', null], '[0;7;1;1;0] + 1', '$0.00');
    expect(result).toMatchObject({ ok: false, error: 'reference_not_found' });
  });
});

describe('refusals: units', () => {
  it('adding two different units is refused', () => {
    const result = runFormula(
      ['h', '$100.00', '€100,00'],
      '[0;7;1;1;0] + [0;7;2;1;0]',
      '$0.00'
    );
    expect(result).toMatchObject({ ok: false, error: 'mixed_units' });
  });

  it('a range mixing units is refused before any arithmetic', () => {
    expect(
      runFormula(['h', '$100.00', '€100,00'], 'sum([0;7;1..2;1])', '$0.00')
    ).toMatchObject({ ok: false, error: 'mixed_units' });
  });

  it('multiplying or dividing two united values is refused: the result has no unit to wear', () => {
    expect(on('[0;7;1;1;0] * [0;7;2;1;0]')).toMatchObject({
      ok: false,
      error: 'unit_product_undefined'
    });
    expect(on('[0;7;1;1;0] / [0;7;2;1;0]')).toMatchObject({
      ok: false,
      error: 'unit_product_undefined'
    });
  });

  it("a result whose unit disagrees with the target cell's is refused", () => {
    const result = runFormula(
      ['h', '12.5%', '7.5%'],
      'sum([0;7;1..2;1])',
      '$0.00'
    );
    expect(result).toMatchObject({ ok: false, error: 'result_unit_mismatch' });
  });

  it('a bare count is refused into a money cell and allowed into a plain one', () => {
    expect(on('count([0;7;1..4;1])', '$0.00')).toMatchObject({
      ok: false,
      error: 'result_unit_mismatch'
    });
    expect(on('count([0;7;1..4;1])', '0')).toMatchObject({
      ok: true,
      renderedValue: '3'
    });
  });

  it('bare-number cells adopt the unit the document already gives the target', () => {
    expect(
      runFormula(['h', '100', '250'], 'sum([0;7;1..2;1])', '$0')
    ).toMatchObject({ ok: true, renderedValue: '$350' });
  });
});

describe('refusals: arithmetic limits', () => {
  it('division by a literal zero is refused', () => {
    expect(on('[0;7;1;1;0] / 0')).toMatchObject({
      ok: false,
      error: 'division_by_zero'
    });
  });

  it('division by a cell that happens to hold zero is refused, not infinite', () => {
    expect(
      runFormula(
        ['h', '$100.00', '$0.00'],
        '[0;7;1;1;0] / [0;7;2;1;0]',
        '$0.00'
      )
    ).toMatchObject({ ok: false, error: 'unit_product_undefined' });
    expect(
      runFormula(['h', '$100.00', '0'], '[0;7;1;1;0] / [0;7;2;1;0]', '$0.00')
    ).toMatchObject({ ok: false, error: 'division_by_zero' });
  });

  it('a product that leaves the safe integer range is refused, never approximated', () => {
    expect(
      runFormula(
        ['h', '999,999,999,999.99'],
        '[0;7;1;1;0] * 999999999',
        '$0.00'
      )
    ).toMatchObject({ ok: false, error: 'magnitude_overflow' });
  });

  it('a sum that leaves the safe integer range is refused', () => {
    expect(
      runFormula(
        ['h', ...Array.from({ length: 12 }, () => '999,999,999,999,999')],
        'sum([0;7;1..12;1])',
        '0'
      )
    ).toMatchObject({ ok: false, error: 'magnitude_overflow' });
  });
});

// ---------------------------------------------------------------------------
// What the evaluator hands back for the receipt.
// ---------------------------------------------------------------------------

describe('resolved reads, for the receipt', () => {
  it('records what each reference read, per reference', () => {
    const evaluation = evaluateFormula(
      'sum([0;7;1..4;1]) - [0;7;4;1;0]',
      stubResolver(COLUMN)
    );
    expect(evaluation.ok).toBe(true);
    if (!evaluation.ok) throw new Error('unreachable');
    expect(evaluation.reads).toHaveLength(2);
    expect(evaluation.reads[0]).toMatchObject({
      // A range read records the whole call, so the receipt can say which
      // aggregate was applied over which span.
      text: 'sum([0;7;1..4;1])',
      fn: 'sum',
      counted: 3
    });
    expect(evaluation.reads[0].skipped).toEqual([
      expect.objectContaining({ row: 3, text: 'Included' })
    ]);
    expect(evaluation.reads[0].readCells).toHaveLength(4);
    expect(evaluation.reads[1]).toMatchObject({
      text: '[0;7;4;1;0]',
      counted: 1,
      skipped: [],
      readCells: [{ anchor: '0;7;4;1;0', text: '$1,200.00' }]
    });
    // The cell read is quoted verbatim: for `[cell] * 1.13`, seeing WHAT was
    // read is the only way to notice the wrong cell was referenced.
    expect(evaluation.reads[1].readCells[0].text).toBe('$1,200.00');
  });

  it('lists references in source order', () => {
    const evaluation = evaluateFormula(
      '[0;7;2;1;0] + sum([0;7;1..2;1]) + [0;7;4;1;0]',
      stubResolver(COLUMN)
    );
    if (!evaluation.ok) throw new Error('unreachable');
    expect(evaluation.references.map((reference) => reference.kind)).toEqual([
      'cell',
      'range',
      'cell'
    ]);
  });
});
