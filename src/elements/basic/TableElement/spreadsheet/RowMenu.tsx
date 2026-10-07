import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { UNVERIFY_ACTION_LABEL } from '../hubStatus';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

export type RowMenuTarget = {
  /** The TanStack row id, which pinning is keyed by. */
  rowId: string;
  /** Table row index the menu acts on. */
  rowIndex: number;
  /** Row number shown to the user, for the menu's label. */
  displayNumber: number;
  /**
   * Table row indexes a bulk action acts on: every row in the selection when
   * the menu was opened on a selected row, otherwise just this one.
   */
  rowIndexes: number[];
  x: number;
  y: number;
};

type RowMenuProps = {
  target: RowMenuTarget;
  canInsert: boolean;
  canDelete: boolean;
  /**
   * Row numbers, as shown to the user, of the target rows that can be sent
   * back to the staged set.
   */
  unverifyNumbers?: number[];
  /** Whether the row is pinned to the top. */
  pinned: boolean;
  onTogglePin: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onDelete: () => void;
  onUnverify?: () => void;
  onClose: () => void;
};

export function RowMenu({
  target,
  canInsert,
  canDelete,
  unverifyNumbers = [],
  pinned,
  onTogglePin,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  onUnverify,
  onClose
}: RowMenuProps) {
  const items: ContextMenuItem[] = [
    { label: pinned ? 'Unpin row' : 'Pin row', run: onTogglePin }
  ];
  if (canInsert) {
    items.push({ label: 'Insert row above', run: onInsertAbove });
    items.push({ label: 'Insert row below', run: onInsertBelow });
  }
  if (unverifyNumbers.length && onUnverify) {
    items.push({
      label:
        unverifyNumbers.length === 1
          ? `${UNVERIFY_ACTION_LABEL} (row ${unverifyNumbers[0]})`
          : `${UNVERIFY_ACTION_LABEL} (${unverifyNumbers.length} rows)`,
      run: onUnverify
    });
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
