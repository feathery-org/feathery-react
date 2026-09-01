/** Breathing room left between the bubble and the edge of the window. */
export const TOOLTIP_MARGIN = 8;

export type TooltipPlacementInput = {
  /** The owning cell's position in the viewport. */
  cellTop: number;
  cellBottom: number;
  tooltipHeight: number;
  viewportHeight: number;
};

export type TooltipPlacement = {
  /** Render above the cell rather than below it. */
  above: boolean;
  /** Pixels to scroll the page by so cell and bubble are both readable. */
  scrollBy: number;
};

/**
 * Where to put a cell's message bubble, and how far the page has to move for
 * it to be readable.
 *
 * Stepping through issues can land on a cell at the very edge of the window —
 * the grid scrolls the cell into its own viewport, but nothing else knows the
 * bubble needs room too. So the side is chosen from the space actually
 * available, and the page is nudged only when something would still be cut off.
 */
export function placeCellTooltip({
  cellTop,
  cellBottom,
  tooltipHeight,
  viewportHeight
}: TooltipPlacementInput): TooltipPlacement {
  const needed = tooltipHeight + TOOLTIP_MARGIN;
  const fitsBelow = cellBottom + needed <= viewportHeight;
  const fitsAbove = cellTop - needed >= 0;
  // Flip only when below genuinely does not fit and above does, so the bubble
  // does not swap sides while the user steps through issues.
  const above = !fitsBelow && fitsAbove;

  const top = above ? cellTop - needed : cellTop;
  const bottom = above ? cellBottom : cellBottom + needed;
  if (bottom > viewportHeight)
    return { above, scrollBy: bottom - viewportHeight + TOOLTIP_MARGIN };
  if (top < 0) return { above, scrollBy: top - TOOLTIP_MARGIN };
  return { above, scrollBy: 0 };
}
