import { Fragment } from 'react';
import {
  thStyle,
  dataColumnMinWidthStyle,
  sortIconContainerStyle,
  sortArrowStyle,
  sortHeaderContentStyle,
  headerColumnControlsStyle,
  headerColumnButtonStyle,
  headerColumnDeleteButtonStyle
} from './styles';
import { PencilIcon, TrashIcon } from '../../components/icons';
import { TABLE_CLASS } from './classNames';
import { Column, ColumnControls } from './types';
import { columnSortKey } from './useTableData';

type SortHeaderProps = {
  columns: Column[];
  enableSort: boolean;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (columnKey: string) => void;
  styles: any;
  /** Edit and delete buttons shown in each header cell while it is hovered. */
  columnControls?: ColumnControls;
  /** The column whose editor or delete confirmation is open. */
  activeColumnKey?: string | null;
};

type SortIconProps = {
  isSorted: boolean;
  sortDirection: 'asc' | 'desc';
};

export function SortIcon({ isSorted, sortDirection }: SortIconProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      className={TABLE_CLASS.sortIcon}
      viewBox='0 0 24 24'
      fill='none'
      aria-hidden='true'
    >
      <path
        css={sortArrowStyle}
        stroke='currentColor'
        data-active={(isSorted && sortDirection === 'asc') || undefined}
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='m8 9 4-4 4 4'
      />
      <path
        css={sortArrowStyle}
        stroke='currentColor'
        data-active={(isSorted && sortDirection === 'desc') || undefined}
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='m8 15 4 4 4-4'
      />
    </svg>
  );
}

export function SortHeader({
  columns,
  enableSort,
  sortColumn,
  sortDirection,
  onSort,
  styles,
  columnControls,
  activeColumnKey
}: SortHeaderProps) {
  return (
    <Fragment>
      {columns.map((column, index) => {
        const canEditColumn = !!columnControls?.canEdit(column.field_key);
        const canDeleteColumn = !!columnControls?.canDelete(column.field_key);
        const isSortable = enableSort;
        const sortKey = columnSortKey(column.field_key, index);
        const isSorted = sortColumn === sortKey;
        const isFirstColumn = index === 0;

        return (
          <th
            key={index}
            scope='col'
            className={TABLE_CLASS.headerCell}
            data-feathery-field={column.field_key}
            onClick={() => isSortable && onSort(sortKey)}
            css={{
              ...thStyle,
              ...dataColumnMinWidthStyle,
              ...(isFirstColumn ? {} : { paddingLeft: 0 }),
              ...styles.getTarget('th'),
              ...(isSortable ? { cursor: 'pointer' } : {})
            }}
          >
            <div css={sortHeaderContentStyle}>
              <span>{column.name}</span>
              {isSortable && (
                <span css={sortIconContainerStyle}>
                  <SortIcon isSorted={isSorted} sortDirection={sortDirection} />
                </span>
              )}
              {(canEditColumn || canDeleteColumn) && columnControls && (
                <span
                  css={{
                    ...headerColumnControlsStyle,
                    ...(activeColumnKey === column.field_key && { opacity: 1 })
                  }}
                >
                  {canEditColumn && (
                    <button
                      type='button'
                      aria-label={`Edit column ${column.name}`}
                      className={TABLE_CLASS.columnEditButton}
                      css={headerColumnButtonStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        columnControls.onRequest({
                          kind: 'edit',
                          fieldKey: column.field_key,
                          anchor: event.currentTarget
                        });
                      }}
                    >
                      <PencilIcon width={14} height={14} />
                    </button>
                  )}
                  {canDeleteColumn && (
                    <button
                      type='button'
                      aria-label={`Delete column ${column.name}`}
                      className={TABLE_CLASS.columnDeleteButton}
                      css={headerColumnDeleteButtonStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        columnControls.onRequest({
                          kind: 'delete',
                          fieldKey: column.field_key,
                          anchor: event.currentTarget
                        });
                      }}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  )}
                </span>
              )}
            </div>
          </th>
        );
      })}
    </Fragment>
  );
}
