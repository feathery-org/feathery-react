import {
  computeColumn,
  parseNumericCell,
  renderNumericCell,
  rescaleExact,
  ColumnCellInput
} from '../numericCells';

// ---------------------------------------------------------------------------
// parseNumericCell: each notation the format contract promises, as its own
// case. Parsing is the half of the round trip that decides what a cell is
// WORTH; rendering (below) decides what the result LOOKS like.
// ---------------------------------------------------------------------------

describe('parseNumericCell', () => {
  it('parses US currency with grouping: $36,803', () => {
    const p = parseNumericCell('$36,803')!;
    expect(p.value).toEqual({ units: 36803, scale: 0 });
    expect(p.format).toMatchObject({
      prefix: '$',
      suffix: '',
      thousandsSeparator: ',',
      groupingObserved: true,
      decimalSeparator: '.',
      decimals: 0,
      negativeStyle: 'none'
    });
    expect(p.unit).toBe('$');
  });

  it('parses two decimals: $1,234.56', () => {
    const p = parseNumericCell('$1,234.56')!;
    expect(p.value).toEqual({ units: 123456, scale: 2 });
    expect(p.format.decimals).toBe(2);
    expect(p.format.decimalSeparator).toBe('.');
    expect(p.format.thousandsSeparator).toBe(',');
  });

  it('parses European notation with trailing currency: 1.234,56 €', () => {
    const p = parseNumericCell('1.234,56 €')!;
    expect(p.value).toEqual({ units: 123456, scale: 2 });
    expect(p.format).toMatchObject({
      prefix: '',
      suffix: ' €',
      thousandsSeparator: '.',
      decimalSeparator: ',',
      decimals: 2
    });
    expect(p.unit).toBe('€');
  });

  it('parses accounting negatives: (1,234)', () => {
    const p = parseNumericCell('(1,234)')!;
    expect(p.value).toEqual({ units: -1234, scale: 0 });
    expect(p.format.negativeStyle).toBe('parens');
  });

  it('parses currency accounting negatives: ($1,234.50)', () => {
    const p = parseNumericCell('($1,234.50)')!;
    expect(p.value).toEqual({ units: -123450, scale: 2 });
    expect(p.format.negativeStyle).toBe('parens');
    expect(p.format.prefix).toBe('$');
  });

  it('parses minus negatives: -1,234 and $-1,234', () => {
    const leading = parseNumericCell('-1,234')!;
    expect(leading.value).toEqual({ units: -1234, scale: 0 });
    expect(leading.format.negativeStyle).toBe('minus');
    expect(leading.format.minusAfterPrefix).toBe(false);

    const inner = parseNumericCell('$-1,234')!;
    expect(inner.value).toEqual({ units: -1234, scale: 0 });
    expect(inner.format.minusAfterPrefix).toBe(true);
    expect(inner.format.prefix).toBe('$');
  });

  it('parses percentages: 12.5%', () => {
    const p = parseNumericCell('12.5%')!;
    expect(p.value).toEqual({ units: 125, scale: 1 });
    expect(p.format.suffix).toBe('%');
    expect(p.unit).toBe('%');
  });

  it('parses space and apostrophe grouping', () => {
    expect(parseNumericCell('1 234 567')!.value).toEqual({
      units: 1234567,
      scale: 0
    });
    expect(parseNumericCell("1'234.50")!.value).toEqual({
      units: 123450,
      scale: 2
    });
    // No-break space grouping (French/SI docx export).
    expect(parseNumericCell('1 234,50')!.value).toEqual({
      units: 123450,
      scale: 2
    });
  });

  it('parses surrounding label text into the preserved prefix', () => {
    const p = parseNumericCell('Total: $1,284,350')!;
    expect(p.value).toEqual({ units: 1284350, scale: 0 });
    expect(p.format.prefix).toBe('Total: $');
    expect(p.unit).toBe('$');
  });

  it('single separator + exactly 3 digits is grouping; 1-2/4+ is decimal', () => {
    expect(parseNumericCell('36.803')!.value).toEqual({
      units: 36803,
      scale: 0
    }); // EU thousands
    expect(parseNumericCell('12,34')!.value).toEqual({ units: 1234, scale: 2 });
    expect(parseNumericCell('3.14159')!.value).toEqual({
      units: 314159,
      scale: 5
    });
    // A leading 0 can never be a grouped digit group.
    expect(parseNumericCell('0.500')!.value).toEqual({ units: 500, scale: 3 });
  });

  it('zero decimals vs two are distinct observed formats', () => {
    expect(parseNumericCell('$984')!.format.decimals).toBe(0);
    expect(parseNumericCell('$984.00')!.format.decimals).toBe(2);
  });

  it('a short integer part does not claim grouping absence; a long one does', () => {
    expect(parseNumericCell('$984')!.format.groupingObserved).toBe(false);
    expect(parseNumericCell('36803')!.format.groupingObserved).toBe(true);
    expect(parseNumericCell('36803')!.format.thousandsSeparator).toBe('');
  });

  it('refuses what it cannot faithfully parse (never silently zero)', () => {
    expect(parseNumericCell('')).toBeNull();
    expect(parseNumericCell('   ')).toBeNull();
    expect(parseNumericCell('N/A')).toBeNull();
    expect(parseNumericCell('Included')).toBeNull();
    expect(parseNumericCell('1,23,456')).toBeNull(); // lakh grouping
    expect(parseNumericCell('1,,234')).toBeNull();
    expect(parseNumericCell('1, 234')).toBeNull();
    expect(parseNumericCell('$100 - $200')).toBeNull(); // two numbers
    expect(parseNumericCell('12 34')).toBeNull(); // invalid space grouping
    expect(parseNumericCell('1.2.3,4.5')).toBeNull();
    expect(parseNumericCell('1234-')).toBeNull(); // trailing minus
    expect(parseNumericCell('(-1,234)')).toBeNull(); // double sign
    expect(parseNumericCell('9999999999999999')).toBeNull(); // > safe digits
  });
});

// ---------------------------------------------------------------------------
// renderNumericCell: the round trip back into the target's shape.
// ---------------------------------------------------------------------------

describe('renderNumericCell', () => {
  const roundTrip = (text: string) => {
    const p = parseNumericCell(text)!;
    return renderNumericCell(p.value, p.format);
  };

  it('round-trips every observed shape byte-for-byte', () => {
    for (const text of [
      '$36,803',
      '$1,234.56',
      '1.234,56 €',
      '(1,234)',
      '($1,234.50)',
      '-1,234',
      '$-1,234',
      '12.5%',
      '1 234 567',
      "1'234.50",
      'Total: $1,284,350',
      '$984.00',
      '36803',
      '0.50'
    ]) {
      expect(roundTrip(text)).toBe(text);
    }
  });

  it('renders a new value in the target format, not the model format', () => {
    const target = parseNumericCell('$36,803')!;
    expect(
      renderNumericCell({ units: 1284350, scale: 0 }, target.format)
    ).toBe('$1,284,350');
  });

  it('renders negatives with a minus by default when the target never showed one', () => {
    const target = parseNumericCell('$36,803')!;
    expect(renderNumericCell({ units: -500, scale: 0 }, target.format)).toBe(
      '-$500'
    );
  });

  it('rejects a scale/decimals mismatch loudly (programming error, not data)', () => {
    const target = parseNumericCell('$36,803')!;
    expect(() =>
      renderNumericCell({ units: 105, scale: 1 }, target.format)
    ).toThrow(/scale/);
  });
});

describe('rescaleExact', () => {
  it('scales up exactly and refuses lossy scale-down', () => {
    expect(rescaleExact({ units: 5, scale: 0 }, 2)).toEqual({
      units: 500,
      scale: 2
    });
    expect(rescaleExact({ units: 500, scale: 2 }, 0)).toEqual({
      units: 5,
      scale: 0
    });
    expect(rescaleExact({ units: 501, scale: 2 }, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeColumn: arithmetic, skip-and-report, refusals.
// ---------------------------------------------------------------------------

const col = (texts: Array<string | null>, startRow = 1): ColumnCellInput[] =>
  texts.map((text, i) => ({
    row: startRow + i,
    anchor: `0;7;${startRow + i};3;0`,
    text
  }));

describe('computeColumn', () => {
  it('sums a currency column exactly and renders in the target format', () => {
    const result = computeColumn(
      col(['$36,803', '$1,200', '$999']),
      'sum',
      '$12,000'
    );
    expect(result).toMatchObject({
      ok: true,
      renderedValue: '$39,002',
      counted: 3,
      skipped: [],
      formatSource: 'target_cell'
    });
  });

  it('is exact on cents where floats are not (0.1 + 0.2)', () => {
    const result = computeColumn(col(['$0.10', '$0.20']), 'sum', '$0.00');
    expect(result).toMatchObject({ ok: true, renderedValue: '$0.30' });
  });

  it('skips and NAMES non-numeric cells instead of zeroing them', () => {
    const result = computeColumn(
      col(['$100', 'Included', '$200', 'N/A', '']),
      'sum',
      '$0'
    );
    expect(result).toMatchObject({ ok: true, renderedValue: '$300', counted: 2 });
    if (!result.ok) throw new Error('unreachable');
    expect(result.skipped).toEqual([
      expect.objectContaining({ row: 2, text: 'Included', reason: 'non_numeric' }),
      expect.objectContaining({ row: 4, text: 'N/A', reason: 'non_numeric' }),
      expect.objectContaining({ row: 5, text: '', reason: 'blank' })
    ]);
  });

  it('reports a missing cell (short/merged row) as missing, not zero', () => {
    const result = computeColumn(
      [
        { row: 1, anchor: '0;7;1;3;0', text: '$10' },
        { row: 2, text: null }
      ],
      'sum',
      '$0'
    );
    expect(result).toMatchObject({ ok: true, renderedValue: '$10' });
    if (!result.ok) throw new Error('unreachable');
    expect(result.skipped).toEqual([
      expect.objectContaining({ row: 2, reason: 'missing_cell' })
    ]);
  });

  it('refuses a mostly-non-numeric column instead of summing the minority', () => {
    const result = computeColumn(
      col(['$100', 'Included', 'N/A', 'TBD']),
      'sum',
      '$0'
    );
    expect(result).toMatchObject({ ok: false, error: 'column_not_numeric' });
  });

  it('refuses an all-blank/non-numeric range', () => {
    expect(computeColumn(col(['', 'N/A']), 'sum', '$0')).toMatchObject({
      ok: false,
      error: 'no_numeric_cells'
    });
  });

  it('refuses mixed currencies rather than adding dollars to euros', () => {
    const result = computeColumn(col(['$100', '€100']), 'sum', '$0');
    expect(result).toMatchObject({ ok: false, error: 'mixed_units' });
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toContain('$');
    expect(result.message).toContain('€');
  });

  it('lets bare numbers ride along with one explicit unit', () => {
    const result = computeColumn(col(['$100', '250']), 'sum', '$0');
    expect(result).toMatchObject({ ok: true, renderedValue: '$350' });
  });

  it('refuses precision loss: cents that do not fit a 0-decimal target', () => {
    const result = computeColumn(col(['$10.50', '$20.25']), 'sum', '$31');
    expect(result).toMatchObject({ ok: false, error: 'precision_loss' });
  });

  it('sums cents into a 2-decimal target exactly', () => {
    const result = computeColumn(col(['$10.50', '$20.25']), 'sum', '$0.00');
    expect(result).toMatchObject({ ok: true, renderedValue: '$30.75' });
  });

  it('falls back to the column-majority format when the target is blank', () => {
    const result = computeColumn(
      col(['$1,200.00', '$3,400.00', '984']),
      'sum',
      ''
    );
    expect(result).toMatchObject({
      ok: true,
      renderedValue: '$5,584.00',
      formatSource: 'column_majority'
    });
  });

  it('upgrades an unobserved grouping separator from the column, never guesses', () => {
    // Target `$984` is too short to show grouping; the column groups with '.'
    // and a ',' decimal, so the result must too.
    const result = computeColumn(
      col(['1.200,00 €', '3.400,00 €']),
      'sum',
      '984,00 €'
    );
    expect(result).toMatchObject({ ok: true, renderedValue: '4.600,00 €' });
  });

  it('sums European-formatted values exactly', () => {
    const result = computeColumn(
      col(['1.234,56 €', '765,44 €']),
      'sum',
      '0,00 €'
    );
    expect(result).toMatchObject({ ok: true, renderedValue: '2.000,00 €' });
  });

  it('sums percentages as percentages', () => {
    const result = computeColumn(col(['12.5%', '7.5%']), 'sum', '0%');
    expect(result).toMatchObject({ ok: true, renderedValue: '20%' });
  });

  it('handles negatives in both notations inside one column', () => {
    const result = computeColumn(
      col(['$1,000', '($250)', '-$150']),
      'sum',
      '$0'
    );
    expect(result).toMatchObject({ ok: true, renderedValue: '$600' });
  });

  it('renders a negative total in the column negative style', () => {
    const result = computeColumn(col(['$100', '($500)']), 'sum', '$0');
    expect(result).toMatchObject({ ok: true, renderedValue: '($400)' });
  });

  it('count renders as a bare integer, never inheriting a currency prefix', () => {
    const result = computeColumn(col(['$100', 'N/A', '$300']), 'count', '$0');
    expect(result).toMatchObject({ ok: true, renderedValue: '2', counted: 2 });
  });

  it('min/max compare exactly across mixed decimal widths', () => {
    expect(
      computeColumn(col(['$10.05', '$10.2', '$9']), 'min', '$0.00')
    ).toMatchObject({ ok: true, renderedValue: '$9.00' });
    expect(
      computeColumn(col(['$10.05', '$10.2', '$9']), 'max', '$0.00')
    ).toMatchObject({ ok: true, renderedValue: '$10.20' });
  });

  it('average reports rounding when the quotient does not terminate', () => {
    const exact = computeColumn(col(['$10.00', '$20.00']), 'average', '$0.00');
    expect(exact).toMatchObject({
      ok: true,
      renderedValue: '$15.00',
      rounded: false
    });
    const roundedResult = computeColumn(
      col(['$10.00', '$10.00', '$10.01']),
      'average',
      '$0.00'
    );
    expect(roundedResult).toMatchObject({
      ok: true,
      renderedValue: '$10.00',
      rounded: true
    });
  });

  it('refuses magnitude overflow instead of losing precision', () => {
    const big = '999,999,999,999,999';
    const result = computeColumn(
      col(Array.from({ length: 11 }, () => big)),
      'sum',
      '0'
    );
    expect(result).toMatchObject({ ok: false, error: 'magnitude_overflow' });
  });

  it('refuses an unknown operation by name', () => {
    expect(
      computeColumn(col(['$1']), 'median' as any, '$0')
    ).toMatchObject({ ok: false, error: 'unsupported_operation' });
  });
});
