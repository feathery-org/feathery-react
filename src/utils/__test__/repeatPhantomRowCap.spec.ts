/**
 * A `set_value` repeat trigger renders one row past the data so there is always
 * somewhere to type. That row is the last way around a row cap: typing into it
 * grows the array through `justInsert`, which runs upstream of every cap check,
 * and the newly filled row immediately earns another trailing row - so a capped
 * container could be grown without bound, one row per fill.
 *
 * Withholding the row is what withholds the input.
 */
import { clampRepeatCountToCap } from '../repeat';
import { fieldValues } from '../init';

const container = { id: 'repeat-1', position: [0], repeated: true } as any;

const step = (maxRepeats?: number) => ({
  subgrids: [container],
  servar_fields: [
    {
      servar: { key: 'name', type: 'text_field', repeated: true },
      position: [0, 0]
    }
  ],
  buttons: maxRepeats
    ? [
        {
          properties: {
            actions: [
              {
                type: 'add_repeated_row',
                repeat_container: 'repeat-1',
                max_repeats: maxRepeats
              }
            ]
          }
        }
      ]
    : [],
  texts: []
});

const setRows = (n: number) => {
  (fieldValues as any).name = Array.from({ length: n }, (_, i) => `row-${i}`);
};

afterEach(() => {
  delete (fieldValues as any).name;
});

describe('clampRepeatCountToCap', () => {
  it('leaves an uncapped container alone', () => {
    setRows(3);
    // 4 is the phantom row a set_value trigger asks for.
    expect(clampRepeatCountToCap(step(), container, 4)).toBe(4);
  });

  it('withholds the trailing row once the data is at the cap', () => {
    setRows(3);
    expect(clampRepeatCountToCap(step(3), container, 4)).toBe(3);
  });

  it('still offers the trailing row below the cap', () => {
    setRows(2);
    expect(clampRepeatCountToCap(step(3), container, 3)).toBe(3);
  });

  /**
   * An author can lower a cap after people have already answered. Clamping to
   * the cap alone would stop rendering rows that hold real submissions, which
   * loses answers rather than preventing new ones.
   */
  it('never hides rows the data already holds', () => {
    setRows(5);
    expect(clampRepeatCountToCap(step(3), container, 5)).toBe(5);
  });

  it('withholds only the phantom row when the data is already over the cap', () => {
    setRows(5);
    expect(clampRepeatCountToCap(step(3), container, 6)).toBe(5);
  });

  it('is inert on a container with no repeated data at all', () => {
    expect(clampRepeatCountToCap(step(3), container, 1)).toBe(1);
  });
});
