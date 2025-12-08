import {
  thStyle,
  sortIconContainerStyle,
  sortArrowStyle,
  sortHeaderContentStyle
} from './styles';
import { Column } from './types';

function SortArrowUp({ active }: { active: boolean }) {
  return (
    <svg
      css={sortArrowStyle}
      data-active={active || undefined}
      fill='currentColor'
      viewBox='0 0 24 24'
    >
      <path d='M12 4l-8 8h16z' />
    </svg>
  );
}

function SortArrowDown({ active }: { active: boolean }) {
  return (
    <svg
      css={sortArrowStyle}
      data-active={active || undefined}
      fill='currentColor'
      viewBox='0 0 24 24'
    >
      <path d='M12 20l8-8H4z' />
    </svg>
  );
}

type SortHeaderProps = {
  columns: Column[];
  enableSort: boolean;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (columnName: string) => void;
  styles: any;
};

export function SortHeader({
  columns,
  enableSort,
  sortColumn,
  sortDirection,
  onSort,
  styles
}: SortHeaderProps) {
  return (
    <>
      {columns.map((column, index) => {
        const isSortable = enableSort;
        const isSorted = sortColumn === column.name;

        return (
          <th
            key={index}
            scope='col'
            onClick={() => isSortable && onSort(column.name)}
            css={{
              ...thStyle,
              ...styles.getTarget('th')
            }}
          >
            <div css={sortHeaderContentStyle}>
              <span>{column.name}</span>
              {isSortable && (
                <span css={sortIconContainerStyle}>
                  <SortArrowUp active={isSorted && sortDirection === 'asc'} />
                  <SortArrowDown
                    active={isSorted && sortDirection === 'desc'}
                  />
                </span>
              )}
            </div>
          </th>
        );
      })}
    </>
  );
}
