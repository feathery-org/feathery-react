// New for the port. The POC covered value typing only indirectly, through the
// adapter and engine suites, which means a regression here would surface as a
// confusing failure three layers up. These assertions pin the display <->
// canonical contract directly: what the user may type, and what they get back.
import {
  defaultValue,
  isNumericType,
  parseDisplay,
  renderDisplay,
  todayIso,
  ValueError
} from '../valueTypes';
import { BoundDefinition, FieldType } from '../tagDsl';

const TEXT: FieldType = { kind: 'text' };
const INTEGER: FieldType = { kind: 'integer' };
const PERCENT: FieldType = { kind: 'percent' };
const BOOLEAN: FieldType = { kind: 'boolean' };
const DATE: FieldType = { kind: 'date', format: 'YYYY-MM-DD' };
const DECIMAL2: FieldType = { kind: 'decimal', scale: 2 };
const USD: FieldType = { kind: 'currency', currency: 'USD', scale: 2 };
const JPY: FieldType = { kind: 'currency', currency: 'JPY', scale: 0 };

const field = (fieldType: FieldType, def?: string): BoundDefinition => ({
  version: 2,
  kind: 'field',
  name: 'x',
  fieldType,
  isEditable: true,
  isDeletable: true,
  isGlobal: false,
  options: def === undefined ? {} : { default: def }
});

describe('parseDisplay', () => {
  it('passes text through untouched', () => {
    expect(parseDisplay(TEXT, '  spaces kept  ')).toBe('  spaces kept  ');
  });

  it('accepts the decorations a user actually types on numbers', () => {
    expect(parseDisplay(INTEGER, '1,234')).toBe('1234');
    expect(parseDisplay(USD, '$1,800.00')).toBe('1800');
    expect(parseDisplay(USD, 'USD 42')).toBe('42');
    // Accounting-style parentheses mean negative.
    expect(parseDisplay(INTEGER, '(5)')).toBe('-5');
    expect(parseDisplay(USD, '($1,200.50)')).toBe('-1200.5');
  });

  it('rounds to the type scale at entry, half-up', () => {
    // A 2dp currency cannot hold "150.005", so entry is where it settles.
    expect(parseDisplay(USD, '150.005')).toBe('150.01');
    expect(parseDisplay(DECIMAL2, '2.674999')).toBe('2.67');
    expect(parseDisplay(JPY, '99.5')).toBe('100');
  });

  it('reads a percentage as its fraction', () => {
    expect(parseDisplay(PERCENT, '8%')).toBe('0.08');
    expect(parseDisplay(PERCENT, '8.5 %')).toBe('0.085');
    expect(parseDisplay(PERCENT, '8')).toBe('0.08');
  });

  it('takes ISO dates only, and rejects impossible ones', () => {
    expect(parseDisplay(DATE, '2026-08-11')).toBe('2026-08-11');
    expect(() => parseDisplay(DATE, '08/11/2026')).toThrow(ValueError);
    // Shaped like a date, but not one.
    expect(() => parseDisplay(DATE, '2026-13-45')).toThrow(ValueError);
  });

  it('accepts both spellings of a boolean', () => {
    expect(parseDisplay(BOOLEAN, 'yes')).toBe('true');
    expect(parseDisplay(BOOLEAN, 'FALSE')).toBe('false');
    expect(() => parseDisplay(BOOLEAN, 'maybe')).toThrow(ValueError);
  });

  it('rejects input the type cannot hold', () => {
    expect(() => parseDisplay(INTEGER, '1.5')).toThrow(ValueError);
    expect(() => parseDisplay(INTEGER, 'abc')).toThrow(ValueError);
    expect(() => parseDisplay(USD, 'free')).toThrow(ValueError);
    expect(() => parseDisplay(PERCENT, '%')).toThrow(ValueError);
  });
});

describe('renderDisplay', () => {
  it('groups integers', () => {
    expect(renderDisplay(INTEGER, '1234567')).toBe('1,234,567');
    expect(renderDisplay(INTEGER, '-1000')).toBe('-1,000');
  });

  it('puts the currency sign outside the minus, and pads to scale', () => {
    expect(renderDisplay(USD, '1800')).toBe('$1,800.00');
    expect(renderDisplay(USD, '-1234.5')).toBe('-$1,234.50');
    // An unknown code has no symbol, so it prefixes the code instead.
    expect(renderDisplay(JPY, '5000')).toBe('JPY 5,000');
  });

  it('renders a fraction back as a percentage', () => {
    expect(renderDisplay(PERCENT, '0.085')).toBe('8.5%');
    expect(renderDisplay(PERCENT, '0.08')).toBe('8%');
  });

  it('round-trips through canonical form for every numeric type', () => {
    for (const [type, typed] of [
      [INTEGER, '1,234'],
      [DECIMAL2, '1,234.56'],
      [USD, '$1,234.56'],
      [PERCENT, '8.5%']
    ] as Array<[FieldType, string]>) {
      const canonical = parseDisplay(type, typed);
      expect(renderDisplay(type, canonical)).toBe(typed);
    }
  });
});

describe('type helpers', () => {
  it('knows which types are numeric', () => {
    expect([INTEGER, DECIMAL2, USD, PERCENT].map(isNumericType)).toEqual([
      true,
      true,
      true,
      true
    ]);
    expect([TEXT, DATE, BOOLEAN].map(isNumericType)).toEqual([
      false,
      false,
      false
    ]);
  });

  it('starts a new instance at zero, empty, or the declared default', () => {
    expect(defaultValue(field(USD))).toBe('0');
    expect(defaultValue(field(TEXT))).toBe('');
    expect(defaultValue(field(USD, '$25.00'))).toBe('25');
    expect(defaultValue(field(PERCENT, '8%'))).toBe('0.08');
  });

  it('starts an undeclared date at today, and takes the clock injected', () => {
    expect(defaultValue(field(DATE), '2026-08-12')).toBe('2026-08-12');
    // An explicit default still wins over today.
    expect(defaultValue(field(DATE, '2020-01-01'), '2026-08-12')).toBe(
      '2020-01-01'
    );
  });

  it('reads a real date from todayIso, formatted the way date fields parse', () => {
    const today = todayIso();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseDisplay(DATE, today)).toBe(today);
  });

  it('ignores value: it belongs to one occurrence, not to new rows', () => {
    const def = field(USD, '$25.00');
    def.options.value = '$999.00';
    expect(defaultValue(def)).toBe('25');
  });

  it('surfaces a default the type cannot hold', () => {
    // Better a loud failure at import than a row that silently starts at zero.
    expect(() => defaultValue(field(INTEGER, 'lots'))).toThrow(ValueError);
  });
});
