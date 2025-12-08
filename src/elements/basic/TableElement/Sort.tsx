import {
  thStyle,
  sortIconContainerStyle,
  sortArrowStyle,
  sortHeaderContentStyle
} from './styles';
import { Column } from './types';

type SortHeaderProps = {
  columns: Column[];
  enableSort: boolean;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  onSort: (columnName: string) => void;
  styles: any;
};

type SortIconProps = {
  isSorted: boolean;
  sortDirection: 'asc' | 'desc';
};

function SortIcon({ isSorted, sortDirection }: SortIconProps) {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      width={24}
      height={24}
      fill='none'
      aria-hidden='true'
      className='w-4 h-4 ms-1'
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
            </div>
          </th>
        );
      })}
    </>
  );
}
