import { parseValue, renderValue } from '../format';
import { TokenFormat } from '../plan';

const currency: TokenFormat = { kind: 'currency' };
const percent: TokenFormat = { kind: 'percent' };
const number: TokenFormat = { kind: 'number' };
const text: TokenFormat = { kind: 'text' };

describe('renderValue', () => {
  const cases: [string, number, TokenFormat | undefined, string][] = [
    ['currency positive', 30, currency, '$30.00'],
    [
      'currency negative signs with a leading dash, not parens',
      -4.5,
      currency,
      '-$4.50'
    ],
    ['currency groups thousands', 1234.5, currency, '$1,234.50'],
    ['number uses default 0 decimals', 42, number, '42'],
    [
      'number honours custom decimals',
      3.14159,
      { kind: 'number', decimals: 2 },
      '3.14'
    ],
    ['percent appends a sign', 8.25, percent, '8.25%'],
    ['text passes the value through untouched', 42, text, '42']
  ];

  it.each(cases)('%s', (_label, value, fmt, expected) => {
    expect(renderValue(value, fmt)).toBe(expected);
  });

  it('renders null and undefined as empty text', () => {
    expect(renderValue(null, number)).toBe('');
    expect(renderValue(undefined, number)).toBe('');
  });

  it('passes non-numeric strings through when the value is not a number', () => {
    expect(renderValue('PO-12345', number)).toBe('PO-12345');
  });
});

describe('parseValue', () => {
  const happy: [string, number][] = [
    ['30', 30],
    ['$3.99', 3.99],
    ['-30', -30],
    ['-$4.50', -4.5],
    ['1,234.50', 1234.5],
    ['8.25%', 8.25]
  ];

  it.each(happy)('reads a number out of %s', (input, expected) => {
    expect(parseValue(input)).toBe(expected);
  });

  const nully: [string, string | null | undefined][] = [
    ['empty string', ''],
    ['a lone dash', '-'],
    ['a lone dot', '.'],
    ['a dash-dot', '-.'],
    ['pure letters', 'abc'],
    ['null', null],
    ['undefined', undefined],
    // Regression: an embedded hyphen must never read as a negative number.
    ['a PO number', 'PO-12345'],
    ['a suite label', 'Suite A-1'],
    ['a unit label', 'Unit B-2'],
    // A second dot is not a number.
    ['a version string', '1.2.3']
  ];

  it.each(nully)('returns null for %s', (_label, input) => {
    expect(parseValue(input)).toBeNull();
  });
});

describe('round trips', () => {
  it('reads back a rendered currency value', () => {
    expect(parseValue(renderValue(1234.5, currency))).toBe(1234.5);
  });

  it('reads back a rendered negative currency value', () => {
    expect(parseValue(renderValue(-4.5, currency))).toBe(-4.5);
  });

  it('reads back a rendered percent value', () => {
    expect(parseValue(renderValue(8.25, percent))).toBe(8.25);
  });
});
