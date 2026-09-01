import React from 'react';
import { featheryWindow } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import { cellTooltipStyle } from './styles';
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
 * grid's scrolling for free. In exchange it has to place itself: flip above
 * when the window has no room below, and nudge the page when the cell it
 * belongs to was scrolled to somewhere the bubble cannot be read.
 */
export function CellErrorTooltip({ message, blocking }: CellErrorTooltipProps) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [above, setAbove] = React.useState(false);

  React.useLayoutEffect(() => {
    const tip = ref.current;
    const cell = tip?.parentElement;
    if (!tip || !cell) return;

    const win = featheryWindow();
    const rect = cell.getBoundingClientRect();
    const placement = placeCellTooltip({
      cellTop: rect.top,
      cellBottom: rect.bottom,
      tooltipHeight: tip.offsetHeight,
      viewportHeight: win.innerHeight
    });

    setAbove(placement.above);
    if (placement.scrollBy) {
      win.scrollBy({ top: placement.scrollBy, behavior: 'smooth' });
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
