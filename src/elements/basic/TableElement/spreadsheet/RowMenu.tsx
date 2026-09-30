import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

export type RowMenuTarget = {
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
  /** How many of the target rows can be sent back to the staged set. */
  unverifyCount?: number;
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
  unverifyCount = 0,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  onUnverify,
  onClose
}: RowMenuProps) {
  const items: ContextMenuItem[] = [];
  if (canInsert) {
    items.push({ label: 'Insert row above', run: onInsertAbove });
    items.push({ label: 'Insert row below', run: onInsertBelow });
  }
  if (unverifyCount > 0 && onUnverify) {
    items.push({
      label:
        unverifyCount === 1
          ? `Mark row ${target.displayNumber} as unvalidated`
          : `Mark ${unverifyCount} rows as unvalidated`,
      run: onUnverify
    });
  }
  if (canDelete) {
    items.push({ label: `Delete row ${target.displayNumber}`, run: onDelete });
  }
  // A read-only table whose only action is "mark as unvalidated" has nothing
  // to offer on a row that is already unvalidated.
  if (!items.length) return null;

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
