import { snapshotInlineErrors } from '../utils';

describe('snapshotInlineErrors', () => {
  it('preserves per-row identity so a new error on another row is detectable', () => {
    // row 0 already has error A
    const before = snapshotInlineErrors({
      inlineErrors: { f: { byIndex: { 0: { message: 'A' } } } }
    });
    // submit validation adds error B on row 1
    const after = snapshotInlineErrors({
      inlineErrors: {
        f: { byIndex: { 0: { message: 'A' }, 1: { message: 'B' } } }
      }
    });

    expect(before).toEqual({ 'f[0]': 'A' });
    expect(after).toEqual({ 'f[0]': 'A', 'f[1]': 'B' });

    // The diff the assistant tools compute must surface the new row error.
    const diff: Record<string, string> = {};
    for (const key of Object.keys(after)) {
      if (after[key] !== before[key]) diff[key] = after[key];
    }
    expect(diff).toEqual({ 'f[1]': 'B' });
  });

  it('keeps field-wide errors under the plain key and skips empty messages', () => {
    const out = snapshotInlineErrors({
      inlineErrors: {
        name: { message: 'required' },
        rep: { byIndex: { 0: { message: '' }, 2: { message: 'bad' } } }
      }
    });
    expect(out).toEqual({ name: 'required', 'rep[2]': 'bad' });
  });
});
