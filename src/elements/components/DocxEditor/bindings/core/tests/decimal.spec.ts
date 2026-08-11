// Ported from the POC's test/decimal.test.js, assertion for assertion. The
// arithmetic contract is what the whole formula engine rests on, so the cases
// stay identical - only the runner changes.
import {
  add,
  cmp,
  group,
  isDecimalString,
  mul,
  normalize,
  roundTo,
  sub,
  sum
} from '../decimal';

describe('decimal', () => {
  it('does exact arithmetic without float drift', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
    expect(mul('12', '150')).toBe('1800');
    expect(mul('3', '19.99')).toBe('59.97');
    expect(sub('1', '0.999')).toBe('0.001');
    expect(sum(['1800', '6000'])).toBe('7800');
    expect(mul('-2', '3.5')).toBe('-7.0');
  });

  it('keeps large values exact via BigInt backing', () => {
    expect(mul('123456789123456789', '987654321')).toBe(
      '121932631234567900112635269'
    );
    expect(mul('123456789123456789.12', '0.01')).toBe('1234567891234567.8912');
  });

  it('rounds half-up and pads to scale', () => {
    expect(roundTo('7800', 2)).toBe('7800.00');
    expect(roundTo('1.005', 2)).toBe('1.01');
    expect(roundTo('-1.005', 2)).toBe('-1.01');
    expect(roundTo('2.674999', 2)).toBe('2.67');
    expect(roundTo('0.5', 0)).toBe('1');
  });

  it('strips redundant zeros when normalizing', () => {
    expect(normalize('7800.00')).toBe('7800');
    expect(normalize('012.500')).toBe('12.5');
    expect(normalize('-0.00')).toBe('0');
  });

  it('groups for display only', () => {
    expect(group('1234567.89')).toBe('1,234,567.89');
    expect(group('-1000')).toBe('-1,000');
    expect(group('999')).toBe('999');
  });

  it('compares and validates', () => {
    expect(cmp('2.50', '2.5')).toBe(0);
    expect(cmp('-1', '1')).toBe(-1);
    expect(isDecimalString('0.5')).toBe(true);
    expect(isDecimalString('.5')).toBe(false);
    expect(isDecimalString('1e3')).toBe(false);
    expect(() => add('1', 'abc')).toThrow();
  });

  // New for the port: the es5 downlevel of `**` silently breaks BigInt math, so
  // exercise the paths that used it (rescale via add, and roundTo's divisor) at a
  // scale gap large enough that a Math.pow fallback would throw or lose
  // precision rather than merely round differently.
  it('survives the es5 toolchain at large scale gaps', () => {
    expect(add('1', '0.00000000000000000001')).toBe('1.00000000000000000001');
    expect(roundTo('1.00000000000000000005', 1)).toBe('1.0');
    expect(mul('0.0000000001', '0.0000000001')).toBe('0.00000000000000000001');
  });
});
