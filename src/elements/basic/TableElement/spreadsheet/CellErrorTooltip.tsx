import React from 'react';
import { featheryWindow } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import { cellTooltipStyle, HEADER_HEIGHT } from './styles';
import { placeCellTooltip } from './tooltipPlacement';

type CellErrorTooltipProps = {
  message: string;
  /** An error blocks the save and is red; a warning is advisory and orange. */
  blocking: boolean;
};

/**
 * The message bubble on the focused cell.
 *
 * It lives inside the cell rather than in a portal, so it travels with the
 * grid's scrolling for free. In exchange it has to place itself within the
 * part of the grid that is actually visible — the grid's scroll box clips it,
 * and so does the window — flipping above when there is no room below, and
 * nudging whichever of the two is in the way when neither side fits.
 */
export function CellErrorTooltip({ message, blocking }: CellErrorTooltipProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [above, setAbove] = React.useState(false);

  React.useLayoutEffect(() => {
    const tip = ref.current;
    const cell = tip?.parentElement;
    if (!tip || !cell) return;

    const win = featheryWindow();
    const grid = cell.closest<HTMLElement>(`.${TABLE_CLASS.grid}`);
    // A grid with no layout yet (or none at all, in tests) cannot clip.
    const measured = grid?.getBoundingClientRect();
    const gridRect = measured && measured.height > 0 ? measured : undefined;
    // The visible box is the window clipped to the grid, minus the sticky
    // header a bubble flipped above row 0 would otherwise hide behind.
    const boxTop = Math.max(0, (gridRect?.top ?? 0) + HEADER_HEIGHT);
    const boxBottom = Math.min(win.innerHeight, gridRect?.bottom ?? Infinity);
    const rect = cell.getBoundingClientRect();
    const placement = placeCellTooltip({
      cellTop: rect.top - boxTop,
      cellBottom: rect.bottom - boxTop,
      tooltipHeight: tip.offsetHeight,
      viewportHeight: boxBottom - boxTop
    });

    setAbove(placement.above);
    if (placement.scrollBy) {
      // Scroll whichever edge is the tight one: the grid's own box when it is
      // fully on screen, the page when the grid runs off it.
      const gridIsTheEdge =
        grid && gridRect
          ? placement.scrollBy > 0
            ? gridRect.bottom <= win.innerHeight
            : gridRect.top >= 0
          : false;
      const target = gridIsTheEdge ? grid : win;
      target?.scrollBy?.({ top: placement.scrollBy, behavior: 'smooth' });
    }
  }, [message]);

  return (
    <span
      ref={ref}
      role='tooltip'
      className={TABLE_CLASS.gridCellTooltip}
      css={cellTooltipStyle(blocking, above)}
    >
      {message}
    </span>
  );
}
