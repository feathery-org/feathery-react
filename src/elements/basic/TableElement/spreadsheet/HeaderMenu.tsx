import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

export type SortDirection = 'asc' | 'desc';

/** The grid's sort, owned by the table element so it survives re-renders. */
export type SpreadsheetSort = {
  /** The sorted column's `columnSortKey` (see `useTableData`), or null. */
  column: string | null;
  direction: SortDirection;
  onSort: (column: string | null, direction?: SortDirection) => void;
};

export type HeaderMenuTarget = {
  /** The column's sort key; unlike the name it is unique. */
  sortKey: string;
  /** Column name, for the labels. */
  name: string;
  x: number;
  y: number;
};

type HeaderMenuProps = {
  target: HeaderMenuTarget;
  sort: SpreadsheetSort;
  onClose: () => void;
};

export function HeaderMenu({ target, sort, onClose }: HeaderMenuProps) {
  const sortedHere = sort.column === target.sortKey;
  const items: ContextMenuItem[] = [
    { label: 'Sort A → Z', run: () => sort.onSort(target.sortKey, 'asc') },
    { label: 'Sort Z → A', run: () => sort.onSort(target.sortKey, 'desc') }
  ];
  if (sortedHere)
    items.push({ label: 'Clear sort', run: () => sort.onSort(null) });

  return (
    <ContextMenu
      x={target.x}
      y={target.y}
      label={`Column ${target.name} actions`}
      className={TABLE_CLASS.gridHeaderMenu}
      itemClassName={TABLE_CLASS.gridHeaderMenuItem}
      items={items}
      onClose={onClose}
    />
  );
}
