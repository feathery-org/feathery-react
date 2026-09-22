import React from 'react';
import { featheryDoc, featheryWindow } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import { choiceMenuStyle, choiceOptionStyle, HEADER_HEIGHT } from './styles';
import { placeCellTooltip } from './tooltipPlacement';

/** The value a menu row stands for: a choice, or '' to clear the cell. */
export const EMPTY_CHOICE_LABEL = '(empty)';

/** The menu's rows in order: a clear-the-cell row, then every choice. The grid's
 * keyboard handling walks this same list, so what it highlights is what is drawn. */
export const choiceRows = (choices: string[]): string[] => ['', ...choices];

export type ChoiceMenuProps = {
  choices: string[];
  /** The highlighted row; the value Enter would commit. */
  value: string;
  label: string;
  onPick: (choice: string) => void;
  onCancel: () => void;
};

/** The menu under a dropdown cell. Focus stays on the grid, which drives the
 * highlight (see `useGridInteractions`), so closing it never strands the keys. */
export function ChoiceMenu({
  choices,
  value,
  label,
  onPick,
  onCancel
}: ChoiceMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [above, setAbove] = React.useState(false);

  // Below the cell unless the grid's visible box runs out of room, the same
  // way the error bubble places itself.
  React.useLayoutEffect(() => {
    const menu = ref.current;
    const cell = menu?.parentElement;
    if (!menu || !cell) return;
    const win = featheryWindow();
    const grid = cell.closest<HTMLElement>(`.${TABLE_CLASS.grid}`);
    const measured = grid?.getBoundingClientRect();
    const gridRect = measured && measured.height > 0 ? measured : undefined;
    const boxTop = Math.max(0, (gridRect?.top ?? 0) + HEADER_HEIGHT);
    const boxBottom = Math.min(win.innerHeight, gridRect?.bottom ?? Infinity);
    const rect = cell.getBoundingClientRect();
    setAbove(
      placeCellTooltip({
        cellTop: rect.top - boxTop,
        cellBottom: rect.bottom - boxTop,
        tooltipHeight: menu.offsetHeight,
        viewportHeight: boxBottom - boxTop
      }).above
    );
  }, []);

  // Keep the highlighted row in view as the arrow keys move it.
  React.useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [value]);

  // A press anywhere else dismisses the menu without changing the cell.
  // `mousedown` so the menu is gone before the grid handles the same gesture.
  React.useEffect(() => {
    const doc = featheryDoc();
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onCancel();
    };
    doc.addEventListener('mousedown', onPointerDown);
    return () => doc.removeEventListener('mousedown', onPointerDown);
  }, [onCancel]);

  const rows = choiceRows(choices);
  return (
    <div
      ref={ref}
      role='listbox'
      aria-label={label}
      className={`${TABLE_CLASS.gridCellSelect} ${TABLE_CLASS.gridChoiceMenu}`}
      css={choiceMenuStyle(above)}
      // The menu belongs to the cell, so a press on it must not start a
      // selection or a range drag underneath.
      onMouseDown={(event) => event.stopPropagation()}
    >
      {rows.map((choice) => (
        <div
          key={choice}
          role='option'
          aria-selected={choice === value}
          className={TABLE_CLASS.gridChoiceOption}
          css={choiceOptionStyle(choice === value, choice === '')}
          onClick={(event) => {
            event.stopPropagation();
            onPick(choice);
          }}
        >
          {choice || EMPTY_CHOICE_LABEL}
        </div>
      ))}
    </div>
  );
}
