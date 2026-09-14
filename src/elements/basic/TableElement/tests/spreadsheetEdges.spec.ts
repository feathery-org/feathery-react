import { cellEdgeVars } from '../spreadsheet/styles';

const NONE = { top: false, right: false, bottom: false, left: false };

describe('cellEdgeVars', () => {
  test('an unselected cell draws no outline at all', () => {
    expect(cellEdgeVars(NONE, false)).toEqual({});
  });

  test('a range edge is the thinner perimeter', () => {
    expect(cellEdgeVars({ ...NONE, top: true, left: true }, false)).toEqual({
      '--edge-top': '1px',
      '--edge-left': '1px'
    });
  });

  /**
   * The regression this function exists for: the focused cell normally sits ON
   * the range perimeter, so both rules apply to it. Merging the range's edges
   * last let its 1px overwrite the ring's 2px on the shared sides, and the
   * active cell stopped reading as active inside its own selection.
   */
  test('the focused ring wins every side, including shared ones', () => {
    expect(cellEdgeVars({ ...NONE, top: true, left: true }, true)).toEqual({
      '--edge-top': '2px',
      '--edge-right': '2px',
      '--edge-bottom': '2px',
      '--edge-left': '2px'
    });
  });

  test('a focused cell with no range still gets the full ring', () => {
    expect(cellEdgeVars(NONE, true)['--edge-bottom']).toBe('2px');
  });
});
