import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { ContextMenu, ContextMenuItem } from './ContextMenu';
import type { SpreadsheetFilters } from './useColumnFilters';

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
  /** The column's field key, which its filter is stored under. */
  fieldKey: string;
  /** Column name, for the labels. */
  name: string;
  x: number;
  y: number;
};

type HeaderMenuProps = {
  target: HeaderMenuTarget;
  sort?: SpreadsheetSort;
  filters?: SpreadsheetFilters;
  /** Opens the column's filter popover, at the same spot as this menu. */
  onOpenFilter: (target: HeaderMenuTarget) => void;
  /** Whether the column is pinned to the left edge. */
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
};

export function HeaderMenu({
  target,
  sort,
  filters,
  onOpenFilter,
  pinned,
  onTogglePin,
  onClose
}: HeaderMenuProps) {
  const items: ContextMenuItem[] = [
    { label: pinned ? 'Unpin column' : 'Pin column', run: onTogglePin }
  ];
  if (sort) {
    items.push(
      { label: 'Sort A → Z', run: () => sort.onSort(target.sortKey, 'asc') },
      { label: 'Sort Z → A', run: () => sort.onSort(target.sortKey, 'desc') }
    );
    if (sort.column === target.sortKey)
      items.push({ label: 'Clear sort', run: () => sort.onSort(null) });
  }
  if (filters) {
    items.push({ label: 'Filter…', run: () => onOpenFilter(target) });
    if (filters.isFiltered(target.fieldKey))
      items.push({
        label: 'Clear filter',
        run: () => filters.clear(target.fieldKey)
      });
    if (filters.active)
      items.push({ label: 'Clear all filters', run: filters.clearAll });
  }

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
