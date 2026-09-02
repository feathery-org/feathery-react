/**
 * Drop-target math. Two things make this harder than an index swap:
 *
 * 1. Repeat rows are flex children with author-controlled sizing, so they are
 *    routinely different heights. Midpoints come from measured rects for that
 *    reason - dividing the track by a row height would land on the wrong row.
 * 2. A hide_if can hide a row in the middle, so the Nth rendered row is not
 *    the Nth repeat index. Slots count rendered rows; the move addresses
 *    absolute indices; slotToTargetIndex is the bridge.
 */
import {
  axisFromFlexDirection,
  displacementByAbs,
  displacementFor,
  mainAxisCoord,
  orderRows,
  RowSnapshot,
  steppedTargetIndex,
  targetIndexFromCenter
} from '../geometry';

const vertical = { vertical: true, reversed: false };
const horizontal = { vertical: false, reversed: false };

/** Deliberately unequal heights: 20, 60 and 20 px tall. */
const variableRows: RowSnapshot[] = [
  { abs: 0, rect: { top: 0, bottom: 20, left: 0, right: 100 } },
  { abs: 1, rect: { top: 20, bottom: 80, left: 0, right: 100 } },
  { abs: 2, rect: { top: 80, bottom: 100, left: 0, right: 100 } }
];

describe('axisFromFlexDirection', () => {
  // Subgrid `axis` is inverted relative to CSS, so the computed style is the
  // only trustworthy source.
  it('reads both axes and both directions', () => {
    expect(axisFromFlexDirection('column')).toEqual({
      vertical: true,
      reversed: false
    });
    expect(axisFromFlexDirection('row')).toEqual({
      vertical: false,
      reversed: false
    });
    expect(axisFromFlexDirection('column-reverse')).toEqual({
      vertical: true,
      reversed: true
    });
    expect(axisFromFlexDirection('row-reverse')).toEqual({
      vertical: false,
      reversed: true
    });
  });
});

describe('mainAxisCoord', () => {
  it('picks the coordinate along the track', () => {
    expect(mainAxisCoord(5, 50, vertical)).toBe(50);
    expect(mainAxisCoord(5, 50, horizontal)).toBe(5);
  });
});

describe('orderRows', () => {
  it('leaves a normal track alone', () => {
    expect(orderRows(variableRows, vertical).map((r) => r.abs)).toEqual([
      0, 1, 2
    ]);
  });

  it('sorts a reversed track into screen order', () => {
    // DOM order and visual order diverge on a *-reverse track.
    const reversedTrack: RowSnapshot[] = [
      { abs: 0, rect: { top: 80, bottom: 100, left: 0, right: 100 } },
      { abs: 1, rect: { top: 40, bottom: 60, left: 0, right: 100 } },
      { abs: 2, rect: { top: 0, bottom: 20, left: 0, right: 100 } }
    ];
    expect(
      orderRows(reversedTrack, { vertical: true, reversed: true }).map(
        (r) => r.abs
      )
    ).toEqual([2, 1, 0]);
  });
});

describe('targetIndexFromCenter', () => {
  // Rows span 0-20, 20-80 and 80-100.
  it('holds position while the row still sits in its own slot', () => {
    expect(targetIndexFromCenter(variableRows, 0, 10, vertical)).toBe(0);
  });

  it('swaps down as soon as the centre passes the next row top edge', () => {
    // The next row starts at 20, so 21 is already enough - the old rule waited
    // for the pointer to clear that row's midpoint at 50.
    expect(targetIndexFromCenter(variableRows, 0, 21, vertical)).toBe(1);
  });

  it('does not swap while the centre is still short of the edge', () => {
    expect(targetIndexFromCenter(variableRows, 0, 19, vertical)).toBe(0);
  });

  it('swaps up as soon as the centre passes the previous row bottom edge', () => {
    expect(targetIndexFromCenter(variableRows, 2, 79, vertical)).toBe(1);
  });

  it('carries past several rows at once', () => {
    expect(targetIndexFromCenter(variableRows, 0, 95, vertical)).toBe(2);
    expect(targetIndexFromCenter(variableRows, 2, 5, vertical)).toBe(0);
  });

  it('measures along x for a side-by-side container', () => {
    const across: RowSnapshot[] = [
      { abs: 0, rect: { top: 0, bottom: 50, left: 0, right: 40 } },
      { abs: 1, rect: { top: 0, bottom: 50, left: 40, right: 100 } }
    ];
    expect(targetIndexFromCenter(across, 0, 41, horizontal)).toBe(1);
    expect(targetIndexFromCenter(across, 0, 39, horizontal)).toBe(0);
  });

  it('returns an absolute index across a hidden row', () => {
    // Absolute 1 never renders, so passing the row below lands on absolute 2.
    const withHidden: RowSnapshot[] = [
      { abs: 0, rect: { top: 0, bottom: 20, left: 0, right: 100 } },
      { abs: 2, rect: { top: 20, bottom: 40, left: 0, right: 100 } },
      { abs: 3, rect: { top: 40, bottom: 60, left: 0, right: 100 } }
    ];
    expect(targetIndexFromCenter(withHidden, 0, 25, vertical)).toBe(2);
    expect(targetIndexFromCenter(withHidden, 0, 45, vertical)).toBe(3);
  });

  it('leaves an unrendered row where it is', () => {
    expect(targetIndexFromCenter(variableRows, 9, 50, vertical)).toBe(9);
  });
});

describe('steppedTargetIndex', () => {
  it('steps by rendered position, skipping a hidden row', () => {
    const withHidden: RowSnapshot[] = [
      { abs: 0, rect: { top: 0, bottom: 20, left: 0, right: 100 } },
      { abs: 2, rect: { top: 20, bottom: 40, left: 0, right: 100 } }
    ];
    // Absolute 1 is hidden, so "down" from row 0 has to reach 2 or the
    // keypress would appear to do nothing.
    expect(steppedTargetIndex(withHidden, 0, 1, vertical)).toBe(2);
    expect(steppedTargetIndex(withHidden, 2, -1, vertical)).toBe(0);
  });

  it('returns null at the ends', () => {
    expect(steppedTargetIndex(variableRows, 0, -1, vertical)).toBeNull();
    expect(steppedTargetIndex(variableRows, 2, 1, vertical)).toBeNull();
  });

  it('returns null for a row that is not rendered', () => {
    expect(steppedTargetIndex(variableRows, 9, 1, vertical)).toBeNull();
  });

  it('steps in screen order on a reversed track', () => {
    // Absolute 0 is drawn at the bottom, so stepping "up" from it has to reach
    // absolute 1 above it - the previous DOM sibling does not exist.
    const reversedTrack: RowSnapshot[] = [
      { abs: 0, rect: { top: 40, bottom: 60, left: 0, right: 100 } },
      { abs: 1, rect: { top: 20, bottom: 40, left: 0, right: 100 } },
      { abs: 2, rect: { top: 0, bottom: 20, left: 0, right: 100 } }
    ];
    const axis = { vertical: true, reversed: true };

    expect(steppedTargetIndex(reversedTrack, 0, -1, axis)).toBe(1);
    expect(steppedTargetIndex(reversedTrack, 0, 1, axis)).toBeNull();
    expect(steppedTargetIndex(reversedTrack, 2, 1, axis)).toBe(1);
    expect(steppedTargetIndex(reversedTrack, 2, -1, axis)).toBeNull();
  });
});

describe('displacementFor', () => {
  // Rows are 20, 60 and 20 tall with no gap between them.
  it('is the dragged row extent plus the gap it leaves', () => {
    expect(displacementFor(variableRows, 1, vertical)).toBe(60);
  });

  it('measures the gap rather than assuming there is none', () => {
    const spaced: RowSnapshot[] = [
      { abs: 0, rect: { top: 0, bottom: 20, left: 0, right: 100 } },
      { abs: 1, rect: { top: 30, bottom: 50, left: 0, right: 100 } }
    ];
    expect(displacementFor(spaced, 0, vertical)).toBe(30);
  });

  it('measures width for a side-by-side container', () => {
    const across: RowSnapshot[] = [
      { abs: 0, rect: { top: 0, bottom: 50, left: 0, right: 40 } },
      { abs: 1, rect: { top: 0, bottom: 50, left: 40, right: 100 } }
    ];
    expect(displacementFor(across, 0, horizontal)).toBe(40);
  });

  it('is zero when there is nothing to displace', () => {
    expect(displacementFor([variableRows[0]], 0, vertical)).toBe(0);
  });

  it('still finds the gap on a reversed track', () => {
    // In DOM order every gap here measures negative and would be thrown away,
    // leaving the displaced rows overlapping by the 10px gap.
    const reversedSpaced: RowSnapshot[] = [
      { abs: 0, rect: { top: 30, bottom: 50, left: 0, right: 100 } },
      { abs: 1, rect: { top: 0, bottom: 20, left: 0, right: 100 } }
    ];
    expect(
      displacementFor(reversedSpaced, 0, { vertical: true, reversed: true })
    ).toBe(30);
  });
});

describe('displacementByAbs', () => {
  // Rows the dragged one has passed move back by a row; rows it has moved
  // behind move forward. Everything else holds still.
  it('pulls the passed rows back when dragging down', () => {
    const shifts = displacementByAbs(variableRows, 0, 1, 20, vertical);
    expect(shifts[1]).toBe(-20);
    expect(shifts[2]).toBe(0);
    expect(shifts[0]).toBeUndefined();
  });

  it('pushes rows forward when dragging up', () => {
    const shifts = displacementByAbs(variableRows, 2, 0, 20, vertical);
    expect(shifts[0]).toBe(20);
    expect(shifts[1]).toBe(20);
  });

  it('holds everything still for a drop back in place', () => {
    const shifts = displacementByAbs(variableRows, 1, 1, 20, vertical);
    expect(shifts[0]).toBe(0);
    expect(shifts[2]).toBe(0);
  });

  it('works in screen order on a reversed track', () => {
    // Sorting into screen order first means a shift is always "towards the
    // top" or "towards the bottom", whichever way the track is laid out.
    const reversedTrack: RowSnapshot[] = [
      { abs: 0, rect: { top: 40, bottom: 60, left: 0, right: 100 } },
      { abs: 1, rect: { top: 0, bottom: 20, left: 0, right: 100 } }
    ];
    const shifts = displacementByAbs(reversedTrack, 1, 0, 20, {
      vertical: true,
      reversed: true
    });
    expect(shifts[0]).toBe(-20);
  });

  it('keys by absolute index so a hidden row does not skew it', () => {
    const withHidden: RowSnapshot[] = [
      { abs: 0, rect: { top: 0, bottom: 20, left: 0, right: 100 } },
      { abs: 2, rect: { top: 20, bottom: 40, left: 0, right: 100 } }
    ];
    const shifts = displacementByAbs(withHidden, 0, 2, 20, vertical);
    expect(shifts[2]).toBe(-20);
  });
});
