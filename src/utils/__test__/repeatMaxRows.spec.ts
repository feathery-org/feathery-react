/**
 * A repeat container's row cap is configured on the add-row action, not on the
 * container, so it can only be found by asking which actions point at this
 * container. Every path that grows a container reads it from here, so getting
 * it wrong either lets a filler past a cap the author set or freezes a
 * container the author left open.
 */
import { getRepeatMaxRows } from '../repeat';

const addRow = (containerId: string, maxRepeats?: any) => ({
  type: 'add_repeated_row',
  repeat_container: containerId,
  ...(maxRepeats === undefined ? {} : { max_repeats: maxRepeats })
});

const button = (actions: any[]) => ({ properties: { actions } });

const step = (overrides: any = {}) => ({
  buttons: [],
  texts: [],
  subgrids: [],
  ...overrides
});

describe('getRepeatMaxRows', () => {
  it('reads the cap off a button targeting the container', () => {
    const s = step({ buttons: [button([addRow('repeat-1', 3)])] });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBe(3);
  });

  it('is uncapped when no action targets the container', () => {
    const s = step({ buttons: [button([addRow('other-container', 3)])] });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBeNull();
  });

  it('is uncapped when there are no actions at all', () => {
    expect(getRepeatMaxRows(step(), 'repeat-1')).toBeNull();
  });

  // A text span and a container can both carry a click action, so a cap set on
  // one of those governs just as much as one set on a button.
  it('looks at texts and subgrids too', () => {
    expect(
      getRepeatMaxRows(
        step({ texts: [button([addRow('repeat-1', 4)])] }),
        'repeat-1'
      )
    ).toBe(4);
    expect(
      getRepeatMaxRows(
        step({ subgrids: [button([addRow('repeat-1', 5)])] }),
        'repeat-1'
      )
    ).toBe(5);
  });

  // A filler uses whichever button still adds, so six rows are reachable here.
  // Taking the tightest made the seam refuse at 2 while the other button kept
  // going, which is the disagreement this resolver exists to prevent.
  it('takes the loosest cap when several actions target the container', () => {
    const s = step({
      buttons: [
        button([addRow('repeat-1', 6)]),
        button([addRow('repeat-1', 2)])
      ]
    });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBe(6);
  });

  // The same rule carried to its end: a blank limit reaches any row count.
  it('is uncapped when any targeting action leaves the limit blank', () => {
    const s = step({
      buttons: [button([addRow('repeat-1', 2)]), button([addRow('repeat-1')])]
    });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBeNull();
  });

  it.each([
    ['', null],
    [0, null],
    [-1, null],
    ['3', 3]
  ])('coerces a max_repeats of %p to %p', (maxRepeats, expected) => {
    const s = step({ buttons: [button([addRow('repeat-1', maxRepeats)])] });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBe(expected);
  });

  it('ignores actions of other types on the same element', () => {
    const s = step({
      buttons: [
        button([
          { type: 'remove_repeated_row', repeat_container: 'repeat-1' },
          { type: 'next', max_repeats: 1 }
        ])
      ]
    });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBeNull();
  });

  it('survives an element with no properties', () => {
    const s = step({ buttons: [{}, { properties: {} }] });
    expect(getRepeatMaxRows(s, 'repeat-1')).toBeNull();
  });

  // A step assembled through the API need not carry every element list.
  it('survives a step missing an element list entirely', () => {
    expect(getRepeatMaxRows({}, 'repeat-1')).toBeNull();
  });
});
