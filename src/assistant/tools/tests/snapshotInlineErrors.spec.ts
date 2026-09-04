import {
  diffInlineErrorSnapshots,
  snapshotInlineErrors
} from '../utils';

describe('snapshotInlineErrors / diffInlineErrorSnapshots', () => {
  it('detects a new error on a different repeat row', () => {
    const before = snapshotInlineErrors({
      inlineErrors: { f: { byIndex: { 0: { message: 'A' } } } }
    });
    const after = snapshotInlineErrors({
      inlineErrors: {
        f: { byIndex: { 0: { message: 'A' }, 1: { message: 'B' } } }
      }
    });

    expect(diffInlineErrorSnapshots(before, after)).toEqual([
      { key: 'f', repeatIndex: 1, message: 'B' }
    ]);
  });

  it('keeps (key, repeatIndex) as separate fields so literal keys cannot collide', () => {
    // A repeated field `f` row 0 AND a literal field named `f[0]`.
    const after = snapshotInlineErrors({
      inlineErrors: {
        f: { byIndex: { 0: { message: 'repeat row 0' } } },
        'f[0]': { message: 'literal field' }
      }
    });
    const reports = diffInlineErrorSnapshots(new Map(), after);

    // Both survive independently -- neither overwrites the other, and the
    // result does not depend on insertion order.
    expect(reports).toHaveLength(2);
    expect(reports).toEqual(
      expect.arrayContaining([
        { key: 'f', repeatIndex: 0, message: 'repeat row 0' },
        { key: 'f[0]', message: 'literal field' }
      ])
    );
  });

  it('reports field-wide errors without a repeatIndex and skips empty messages', () => {
    const after = snapshotInlineErrors({
      inlineErrors: {
        name: { message: 'required' },
        rep: { byIndex: { 0: { message: '' }, 2: { message: 'bad' } } }
      }
    });

    expect(diffInlineErrorSnapshots(new Map(), after)).toEqual(
      expect.arrayContaining([
        { key: 'name', message: 'required' },
        { key: 'rep', repeatIndex: 2, message: 'bad' }
      ])
    );
  });

  it('reports nothing when the snapshots match', () => {
    const errors = {
      inlineErrors: { f: { byIndex: { 1: { message: 'same' } } } }
    };
    const before = snapshotInlineErrors(errors);
    const after = snapshotInlineErrors(errors);
    expect(diffInlineErrorSnapshots(before, after)).toEqual([]);
  });
});
