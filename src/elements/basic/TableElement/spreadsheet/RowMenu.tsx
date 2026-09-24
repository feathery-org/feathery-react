import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

export type RowMenuTarget = {
  /** The TanStack row id, which pinning is keyed by. */
  rowId: string;
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
  /** Whether the row is pinned to the top. */
  pinned: boolean;
  onTogglePin: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function RowMenu({
  target,
  canInsert,
  canDelete,
  pinned,
  onTogglePin,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  onClose
}: RowMenuProps) {
  const items: ContextMenuItem[] = [
    { label: pinned ? 'Unpin row' : 'Pin row', run: onTogglePin }
  ];
  if (canInsert) {
    items.push({ label: 'Insert row above', run: onInsertAbove });
    items.push({ label: 'Insert row below', run: onInsertBelow });
  }
  if (canDelete) {
    items.push({ label: `Delete row ${target.displayNumber}`, run: onDelete });
  }

  return (
    <ContextMenu
      x={target.x}
      y={target.y}
      label={`Row ${target.displayNumber} actions`}
      className={TABLE_CLASS.gridRowMenu}
      itemClassName={TABLE_CLASS.gridRowMenuItem}
      items={items}
      onClose={onClose}
    />
  );
}
