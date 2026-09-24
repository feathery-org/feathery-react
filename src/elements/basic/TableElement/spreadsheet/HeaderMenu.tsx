import React from 'react';
import { TABLE_CLASS } from '../classNames';
import { ColumnControls } from '../types';
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
  /** The column's field key, which the column controls act on. */
  fieldKey: string;
  /** The column's position, which inserted columns are placed around. */
  columnIndex: number;
  /** Column name, for the labels. */
  name: string;
  /** The header cell, which an editor or confirmation opened from here anchors to. */
  anchor: HTMLElement;
  x: number;
  y: number;
};

type HeaderMenuProps = {
  target: HeaderMenuTarget;
  sort?: SpreadsheetSort;
  columnControls?: ColumnControls;
  onClose: () => void;
};

export function HeaderMenu({
  target,
  sort,
  columnControls,
  onClose
}: HeaderMenuProps) {
  const items: ContextMenuItem[] = [];
  if (sort) {
    items.push(
      { label: 'Sort A → Z', run: () => sort.onSort(target.sortKey, 'asc') },
      { label: 'Sort Z → A', run: () => sort.onSort(target.sortKey, 'desc') }
    );
    if (sort.column === target.sortKey)
      items.push({ label: 'Clear sort', run: () => sort.onSort(null) });
  }
  const { fieldKey, anchor, columnIndex } = target;
  if (columnControls?.canInsert && columnIndex >= 0)
    items.push(
      {
        label: 'Insert column left',
        run: () =>
          columnControls.onRequest({
            kind: 'add',
            anchor,
            atIndex: columnIndex
          })
      },
      {
        label: 'Insert column right',
        run: () =>
          columnControls.onRequest({
            kind: 'add',
            anchor,
            atIndex: columnIndex + 1
          })
      }
    );
  if (columnControls?.canEdit)
    items.push({
      label: 'Edit column',
      run: () => columnControls.onRequest({ kind: 'edit', fieldKey, anchor })
    });
  if (columnControls?.canDelete)
    items.push({
      label: 'Delete column',
      run: () => columnControls.onRequest({ kind: 'delete', fieldKey, anchor })
    });

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
