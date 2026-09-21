/**
 * Child positions are contiguous for anything the editor builds, but a form
 * assembled through the API can leave a gap. The tree walk used to increment
 * until a lookup missed, so a gap truncated the branch - and a gap at index 0
 * truncated it before the first child, rendering the step blank with nothing
 * logged anywhere. These pin the walk to what actually exists.
 */
import { buildStepGrid } from '..';

const text = (position: number[]) => ({
  id: `t${position.join('')}`,
  position
});

const step = (positions: number[][]) => ({
  subgrids: [{ id: 'root', key: 'root', position: [], axis: 'row' }],
  texts: positions.map(text),
  servar_fields: [],
  buttons: [],
  images: [],
  videos: [],
  tables: [],
  tabs: [],
  progress_bars: []
});

/** Every position visible, which is what a step with no hide rules produces. */
const allVisible = (positions: number[][]) =>
  positions.reduce(
    (acc: any, position) => {
      acc[position.join(',')] = [true];
      return acc;
    },
    { root: [true] }
  );

const build = (positions: number[][]) =>
  buildStepGrid(step(positions), 'desktop', allVisible(positions));

const childIds = (node: any) => (node.children ?? []).map((c: any) => c.id);

describe('buildStepGrid child traversal', () => {
  it('walks a contiguous run of children', () => {
    expect(childIds(build([[0], [1], [2]]).tree)).toEqual(['t0', 't1', 't2']);
  });

  it('renders children when position 0 is missing', () => {
    // The whole step used to come back empty for this shape.
    expect(childIds(build([[1], [2]]).tree)).toEqual(['t1', 't2']);
  });

  it('renders past a gap in the middle rather than truncating', () => {
    expect(childIds(build([[0], [2]]).tree)).toEqual(['t0', 't2']);
  });

  it('handles a lone child at a high index', () => {
    expect(childIds(build([[3]]).tree)).toEqual(['t3']);
  });

  it('leaves a childless root without a children array', () => {
    expect(build([]).tree.children).toBeUndefined();
  });

  it('spans gaps at a nested depth too', () => {
    const nested = build([[0], [0, 1], [0, 3]]).tree.children[0];
    expect(childIds(nested)).toEqual(['t01', 't03']);
  });
});
