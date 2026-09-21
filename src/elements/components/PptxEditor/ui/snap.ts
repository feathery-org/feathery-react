// Pure snapping math for the SVG editor's group/shape move.
// Kept framework-free so it's unit-testable and reusable.

export interface SnapBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Guide {
  x?: number;
  y?: number;
} // an alignment guide line (host-content px)

export const SNAP_TOLERANCE = 6; // px

// Snap the raw move delta so the box's left/center/right (and top/mid/bottom) edges
// land on the nearest candidate alignment line within SNAP_TOLERANCE.
// Returns the adjusted delta plus the guide lines that became active.
export function snapMove(
  box: SnapBox,
  dxRaw: number,
  dyRaw: number,
  snapX: number[],
  snapY: number[],
  tol: number = SNAP_TOLERANCE
): { dx: number; dy: number; guides: Guide[] } {
  let dx = dxRaw;
  let dy = dyRaw;
  const guides: Guide[] = [];

  const ax = [
    box.left + dxRaw,
    box.left + box.width / 2 + dxRaw,
    box.left + box.width + dxRaw
  ];
  let bestX: { d: number; line: number } | null = null;
  for (const a of ax)
    for (const line of snapX) {
      const d = line - a;
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d)))
        bestX = { d, line };
    }
  if (bestX) {
    dx = dxRaw + bestX.d;
    guides.push({ x: bestX.line });
  }

  const ay = [
    box.top + dyRaw,
    box.top + box.height / 2 + dyRaw,
    box.top + box.height + dyRaw
  ];
  let bestY: { d: number; line: number } | null = null;
  for (const a of ay)
    for (const line of snapY) {
      const d = line - a;
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d)))
        bestY = { d, line };
    }
  if (bestY) {
    dy = dyRaw + bestY.d;
    guides.push({ y: bestY.line });
  }

  return { dx, dy, guides };
}
