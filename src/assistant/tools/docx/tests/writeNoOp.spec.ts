// The no-op comparison rule, case by case.
//
// The rule decides whether a write happens at all, so its edges are the whole
// feature. Two failure directions, and they are not symmetric:
//
//   * TOO LOOSE (skipping something that IS a change) silently drops an edit the
//     user asked for. Unrecoverable - nothing in the result would say so.
//   * TOO STRICT (writing something identical) is the bug this work removes:
//     noise in the review pane.
//
// So every case below states which side it pins, and the currency/decimals/
// negative-style cases exist because a "same number" comparison would get them
// all wrong in the first, unrecoverable direction.
import {
  buildNoOpWriteReport,
  describeTextChange,
  describeWriteDifference,
  writeIsNoOp
} from '../writeNoOp';

describe('writeIsNoOp: identical means value AND rendered format', () => {
  // --- SKIP: byte-identical -------------------------------------------------
  it.each([
    ['a plain zero', '0.00'],
    ['a currency zero', '$0.00'],
    ['a grouped amount', '$1,284,350.00'],
    ['a bare integer', '36803'],
    ['a percentage', '12.5%'],
    ['a trailing-currency amount', '1.234,56 €'],
    ['a parenthesised negative', '($1,234.50)'],
    ['a minus negative', '-1,234'],
    ['a prefix-minus negative', '$-1,234'],
    ['a labelled amount', 'Total: $1,284,350'],
    ['a blank cell', ''],
    ['non-numeric text', 'Included'],
    ['prose containing digits', '1 King St W'],
    ['a zero-padded identifier', '0093']
  ])('SKIPS an identical write: %s', (_case, text) => {
    expect(writeIsNoOp(text, text)).toBe(true);
    expect(describeWriteDifference(text, text)).toEqual({ changed: false });
  });

  // --- WRITE: same number, different rendering ------------------------------
  // Every one of these would be SUPPRESSED by a comparison of parsed values,
  // and every one of them is a real, reviewable edit to the document.
  it.each([
    ['currency symbol dropped', '$0.00', '0.00'],
    ['currency symbol added', '0.00', '$0.00'],
    ['decimals dropped', '0.00', '0'],
    ['decimals added', '$984', '$984.00'],
    ['third decimal added', '$6,306.62', '$6,306.620'],
    ['thousands separator dropped', '$1,000.00', '$1000.00'],
    ['thousands separator added', '1000.00', '1,000.00'],
    ['separator convention swapped', '1.234,56', '1,234.56'],
    ['negative style parens -> minus', '($100.00)', '-$100.00'],
    ['negative style minus -> parens', '-$100.00', '($100.00)'],
    ['minus moved across the prefix', '-$1,234', '$-1,234'],
    ['percent suffix dropped', '12.5%', '12.5'],
    ['trailing currency dropped', '1.234,56 €', '1.234,56'],
    ['label dropped from the prefix', 'Total: $1,284,350', '$1,284,350']
  ])('WRITES when only the format moved: %s', (_case, current, next) => {
    expect(writeIsNoOp(current, next)).toBe(false);
    // ...and says so: same number, different format.
    expect(describeWriteDifference(current, next)).toEqual({
      changed: true,
      sameNumber: true,
      difference: 'format'
    });
  });

  // --- WRITE: the value itself moved ----------------------------------------
  it.each([
    ['a cent', '$4,810.00', '$4,810.13'],
    ['a sign', '$100.00', '-$100.00'],
    ['a sign in parens notation', '$100.00', '($100.00)'],
    ['a magnitude', '$1,000.00', '$10,000.00'],
    ['blank filled in', '', '$0.00'],
    ['a value blanked out', '$0.00', ''],
    ['numeric replaced by prose', '$0.00', 'Included'],
    ['prose replaced by numeric', 'Included', '$0.00'],
    ['prose replaced by prose', 'Included', 'Waived'],
    ['a trailing space added', '$0.00', '$0.00 '],
    ['a leading space added', '$0.00', ' $0.00']
  ])('WRITES when the value moved: %s', (_case, current, next) => {
    expect(writeIsNoOp(current, next)).toBe(false);
    expect(describeWriteDifference(current, next).changed).toBe(true);
  });

  it('a trailing space is a change, not a format nicety', () => {
    // Strictness fails in the SAFE direction: the only thing it can miss is a
    // difference nobody can see, and that is still an edit to the document.
    expect(writeIsNoOp('$0.00', '$0.00 ')).toBe(false);
  });

  it('never compares parsed values - the classic trap, stated as a test', () => {
    // 0 and 0.00 and $0.00 are one number and three documents.
    const renderings = ['0', '0.00', '$0.00', '$0', '(0.00)', '0.000'];
    for (const a of renderings)
      for (const b of renderings)
        expect(writeIsNoOp(a, b)).toBe(a === b);
  });

  it('classifies a value change as `value`, not `format`', () => {
    expect(describeWriteDifference('$4,810.00', '$4,810.13')).toEqual({
      changed: true,
      sameNumber: false,
      difference: 'value'
    });
    // Non-numeric on either side can never be a pure format change.
    expect(describeWriteDifference('Included', 'Waived')).toEqual({
      changed: true,
      sameNumber: false,
      difference: 'value'
    });
  });
});

describe('the words a no-op leaves behind', () => {
  it('describeTextChange names both sides and flags a format-only move', () => {
    expect(describeTextChange('$4,810.00', '$4,810.13')).toBe(
      '"$4,810.00" -> "$4,810.13"'
    );
    expect(describeTextChange('$0.00', '0.00')).toBe(
      '"$0.00" -> "0.00" (same number, different format)'
    );
    expect(describeTextChange('', '$0.00')).toBe('"" (blank) -> "$0.00"');
  });

  it('the report says nothing was written, and why', () => {
    const report = buildNoOpWriteReport(
      'set_cell_formula',
      '0;1;2;2;0',
      '$0.00',
      'the result of [0;1;2;1;0] * 0'
    );
    expect(report).toMatchObject({
      anchor: '0;1;2;2;0',
      op: 'set_cell_formula',
      text: '$0.00',
      skipped: true
    });
    expect(report.receipt).toBe(
      'Nothing written at 0;1;2;2;0: the result of [0;1;2;1;0] * 0 already ' +
        'reads "$0.00", identical in value and format to what this op would ' +
        'have written. No revision and no change card were created.'
    );
  });

  it('names a blank cell as blank rather than as empty quotes', () => {
    expect(buildNoOpWriteReport('set_cell_text', '0;1;2;2;0', '').receipt).toContain(
      'already reads "" (blank)'
    );
  });
});
