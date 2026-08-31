/**
 * Pure drop-target math for repeat row reordering. Kept free of the DOM so the
 * awkward cases - variable row heights, hidden rows, reversed flex - are
 * testable without a layout engine.
 */

export interface RowRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface RowSnapshot {
  /** The row's absolute repeat index, read off its own marker attribute. */
  abs: number;
  rect: RowRect;
}

export interface TrackAxis {
  vertical: boolean;
  reversed: boolean;
}

/** Resolves a computed flexDirection into the axis facts the drag needs. */
export function axisFromFlexDirection(flexDirection: string): TrackAxis {
  return {
    vertical: flexDirection.startsWith('column'),
    reversed: flexDirection.endsWith('reverse')
  };
}

/** The pointer coordinate along the track's main axis. */
export function mainAxisCoord(
  clientX: number,
  clientY: number,
  axis: TrackAxis
) {
  return axis.vertical ? clientY : clientX;
}

const midpoint = (rect: RowRect, vertical: boolean) =>
  vertical ? (rect.top + rect.bottom) / 2 : (rect.left + rect.right) / 2;

/**
 * Rows in the order they appear on screen.
 *
 * DOM order and visual order diverge on a `*-reverse` track, and every
 * comparison below is against measured screen coordinates, so normalising once
 * here keeps the rest of the math free of direction special-cases.
 */
export function orderRows(rows: RowSnapshot[], axis: TrackAxis) {
  const start = (r: RowSnapshot) => (axis.vertical ? r.rect.top : r.rect.left);
  return [...rows].sort((a, b) => start(a) - start(b));
}

/**
 * Where the dragged row wants to land, as an absolute index.
 *
 * The test is the dragged row's own centre against its neighbours' near edges,
 * not the pointer against their midpoints. The grip sits at the row's top
 * corner, so the pointer trails the row it is carrying: judging by the pointer
 * means the row has to be dragged most of the way past a neighbour before
 * anything happens. Comparing centre to edge makes the swap land as soon as the
 * rows visually overlap, which is where it looks like it should.
 */
export function targetIndexFromCenter(
  rows: RowSnapshot[],
  fromAbs: number,
  center: number,
  axis: TrackAxis
) {
  const ordered = orderRows(rows, axis);
  const from = ordered.findIndex((row) => row.abs === fromAbs);
  if (from === -1) return fromAbs;

  const nearEdge = (r: RowSnapshot) =>
    axis.vertical ? r.rect.top : r.rect.left;
  const farEdge = (r: RowSnapshot) =>
    axis.vertical ? r.rect.bottom : r.rect.right;

  let target = from;
  for (let i = from + 1; i < ordered.length; i++) {
    if (center <= nearEdge(ordered[i])) break;
    target = i;
  }
  for (let i = from - 1; i >= 0; i--) {
    if (center >= farEdge(ordered[i])) break;
    target = i;
  }

  return ordered[target].abs;
}

/**
 * The absolute index one rendered step away from `from`, for the arrow keys and
 * chevron buttons. Returns null at the ends.
 */
export function steppedTargetIndex(
  rows: RowSnapshot[],
  from: number,
  direction: -1 | 1
) {
  const position = rows.findIndex((row) => row.abs === from);
  if (position === -1) return null;

  const next = position + direction;
  if (next < 0 || next >= rows.length) return null;
  return rows[next].abs;
}

/** Extent of a rect along the track's main axis. */
export function mainAxisExtent(rect: RowRect, vertical: boolean) {
  return vertical ? rect.bottom - rect.top : rect.right - rect.left;
}

/**
 * Distance a displaced row travels: the dragged row's extent plus the gap it
 * leaves behind. Measured from the first pair rather than assumed, because the
 * gap comes from the container's own `gap` or the rows' external padding.
 */
export function displacementFor(
  rows: RowSnapshot[],
  draggedIndex: number,
  vertical: boolean
) {
  const dragged = rows.find((row) => row.abs === draggedIndex);
  if (!dragged || rows.length < 2) return 0;

  const start = (r: RowRect) => (vertical ? r.top : r.left);
  const end = (r: RowRect) => (vertical ? r.bottom : r.right);
  const gaps = rows
    .slice(1)
    .map((row, i) => start(row.rect) - end(rows[i].rect))
    .filter((gap) => gap >= 0);
  const gap = gaps.length ? Math.min(...gaps) : 0;

  return mainAxisExtent(dragged.rect, vertical) + gap;
}

/**
 * How far each row shifts so the dragged row's slot opens up.
 *
 * Worked in screen order, so a shift is always "towards the top/left" or
 * "towards the bottom/right" regardless of how the track is laid out. The
 * dragged row is excluded - it follows the pointer instead.
 */
export function displacementByAbs(
  rows: RowSnapshot[],
  fromAbs: number,
  toAbs: number,
  distance: number,
  axis: TrackAxis
) {
  const ordered = orderRows(rows, axis);
  const from = ordered.findIndex((row) => row.abs === fromAbs);
  const to = ordered.findIndex((row) => row.abs === toAbs);
  const shifts: Record<number, number> = {};
  if (from === -1 || to === -1) return shifts;

  ordered.forEach((row, i) => {
    if (i === from) return;
    if (i > from && i <= to) shifts[row.abs] = -distance;
    else if (i < from && i >= to) shifts[row.abs] = distance;
    else shifts[row.abs] = 0;
  });

  return shifts;
}
