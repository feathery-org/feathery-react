import { tokenize, wordDiff } from './lcs';

describe('tokenize', () => {
  it('keeps a whole monetary/numeric value as one token', () => {
    expect(tokenize('$180.00')).toEqual(['$180.00']);
    expect(tokenize('13,091.45')).toEqual(['13,091.45']);
    expect(tokenize('0.0875%')).toEqual(['0.0875%']);
    expect(tokenize('$0.81')).toEqual(['$0.81']);
  });

  it('does not swallow part of an alphanumeric word', () => {
    expect(tokenize('3rd')).toEqual(['3rd']);
    expect(tokenize('v2')).toEqual(['v2']);
    expect(tokenize('abc123')).toEqual(['abc123']);
  });
});

describe('wordDiff on number changes', () => {
  it('replaces the whole number instead of fragmenting the digits', () => {
    const ops = wordDiff('Total $180.00 due', 'Total $110.00 due');
    // The old value is deleted whole and the new value inserted whole — no
    // shared "$"/".00" fragments straddling the change.
    expect(ops).toContainEqual({ type: 'del', text: '$180.00' });
    expect(ops).toContainEqual({ type: 'ins', text: '$110.00' });
    expect(ops.some((o) => o.text === '180' || o.text === '110')).toBe(false);
  });
});
