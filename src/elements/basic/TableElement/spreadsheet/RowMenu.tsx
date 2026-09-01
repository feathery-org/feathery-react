import React from 'react';
import { featheryDoc } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import { rowMenuItemStyle, rowMenuStyle } from './styles';

export type RowMenuTarget = {
  /** Table row index the menu acts on. */
  rowIndex: number;
  /** Row number shown to the user, for the menu's label. */
  displayNumber: number;
  x: number;
  y: number;
};

type RowMenuProps = {
  target: RowMenuTarget;
  canInsert: boolean;
  canDelete: boolean;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function RowMenu({
  target,
  canInsert,
  canDelete,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  onClose
}: RowMenuProps) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Any click elsewhere, a scroll, or Escape dismisses the menu. `mousedown`
  // rather than `click` so the menu is gone before the grid handles a
  // selection on the same gesture.
  React.useEffect(() => {
    const doc = featheryDoc();
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    doc.addEventListener('mousedown', onPointerDown);
    doc.addEventListener('keydown', onKeyDown);
    doc.addEventListener('scroll', onClose, true);
    return () => {
      doc.removeEventListener('mousedown', onPointerDown);
      doc.removeEventListener('keydown', onKeyDown);
      doc.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const items: Array<{ label: string; run: () => void }> = [];
  if (canInsert) {
    items.push({ label: 'Insert row above', run: onInsertAbove });
    items.push({ label: 'Insert row below', run: onInsertBelow });
  }
  if (canDelete) {
    items.push({ label: `Delete row ${target.displayNumber}`, run: onDelete });
  }
  if (!items.length) return null;

  return (
    <div
      ref={ref}
      role='menu'
      aria-label={`Row ${target.displayNumber} actions`}
      className={TABLE_CLASS.gridRowMenu}
      css={{ ...rowMenuStyle, left: target.x, top: target.y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type='button'
          role='menuitem'
          className={TABLE_CLASS.gridRowMenuItem}
          css={rowMenuItemStyle}
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
