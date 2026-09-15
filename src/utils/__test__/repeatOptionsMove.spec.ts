/**
 * repeat_options holds per-row dropdown options and is sparse: a row that never
 * had options of its own is a hole, not an entry. Compacting those holes while
 * permuting would hand one row's options to whichever row slid past it, so a
 * user reordering rows would watch unrelated dropdowns change contents.
 */
import {
  hasRepeatOptionsForFields,
  moveStepFieldRepeatOptions
} from '../fieldHelperFunctions';

const field = (key: string, repeatOptions?: any[]) => ({
  servar: {
    key,
    type: 'dropdown',
    repeated: true,
    metadata: repeatOptions ? { repeat_options: repeatOptions } : {}
  },
  position: [0, 0]
});

describe('moveStepFieldRepeatOptions', () => {
  it('permutes the options of a targeted field', () => {
    const step = { servar_fields: [field('pick', [['a'], ['b'], ['c']])] };
    moveStepFieldRepeatOptions(step, new Set(['pick']), 0, 2);
    expect(step.servar_fields[0].servar.metadata.repeat_options).toEqual([
      ['b'],
      ['c'],
      ['a']
    ]);
  });

  it('moves a hole as a hole rather than letting a row inherit options', () => {
    const sparse: any[] = [];
    sparse[0] = ['a'];
    sparse[2] = ['c'];
    const step = { servar_fields: [field('pick', sparse)] };

    // Row 0 goes last; the hole at row 1 must travel to row 0, not vanish.
    moveStepFieldRepeatOptions(step, new Set(['pick']), 0, 2);
    const moved = step.servar_fields[0].servar.metadata.repeat_options;
    expect(moved[0]).toBeUndefined();
    expect(moved[1]).toEqual(['c']);
    expect(moved[2]).toEqual(['a']);
  });

  it('grows the array when the move addresses a row past the end', () => {
    const step = { servar_fields: [field('pick', [['a']])] };
    moveStepFieldRepeatOptions(step, new Set(['pick']), 0, 2);
    const moved = step.servar_fields[0].servar.metadata.repeat_options;
    expect(moved).toHaveLength(3);
    expect(moved[2]).toEqual(['a']);
  });

  it('leaves fields outside the container alone', () => {
    const step = {
      servar_fields: [
        field('pick', [['a'], ['b']]),
        field('other', [['x'], ['y']])
      ]
    };
    moveStepFieldRepeatOptions(step, new Set(['pick']), 0, 1);
    expect(step.servar_fields[1].servar.metadata.repeat_options).toEqual([
      ['x'],
      ['y']
    ]);
  });

  it('no-ops for a field with no per-row options', () => {
    const step = { servar_fields: [field('pick')] };
    expect(() =>
      moveStepFieldRepeatOptions(step, new Set(['pick']), 0, 1)
    ).not.toThrow();
    expect(
      (step.servar_fields[0].servar.metadata as any).repeat_options
    ).toBeUndefined();
  });
});

describe('hasRepeatOptionsForFields', () => {
  // The guard exists so an ordinary reorder does not pay a whole-form deep
  // clone for options that are not there.
  it('is false when no targeted field carries per-row options', () => {
    const step = { servar_fields: [field('pick'), field('other', [['x']])] };
    expect(hasRepeatOptionsForFields(step, new Set(['pick']))).toBe(false);
  });

  it('is true as soon as one targeted field carries them', () => {
    const step = { servar_fields: [field('pick', [['a']]), field('other')] };
    expect(hasRepeatOptionsForFields(step, new Set(['pick', 'other']))).toBe(
      true
    );
  });
});
