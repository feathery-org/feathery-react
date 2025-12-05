import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';
import {
  containerStyle,
  navStyle,
  navTextBoldStyle,
  navTextStyle,
  pageButtonActiveStyle,
  pageButtonNextStyle,
  pageButtonPrevStyle,
  paginationListStyle,
  rowStyle,
  searchContainerStyle,
  searchIconWrapperStyle,
  searchInputStyle,
  searchWrapperStyle,
  cellStyle,
  tableStyle,
  theadStyle,
  thStyle,
  actionButtonStyle,
  pageButtonStyle
} from './styles';

type Action = {
  label: string;
};

type FieldDisplayColumn = {
  name: string;
  type: 'field_display';
  field_id: string;
  field_type: string;
  field_key: string;
};

type ActionColumn = {
  name: string;
  type: 'action';
  actions: Action[];
};

type Column = FieldDisplayColumn | ActionColumn;

function applyTableStyles(responsiveStyles: any) {
  responsiveStyles.addTargets(
    'tableContainer',
    'table',
    'thead',
    'tbody',
    'th',
    'td',
    'tr'
  );
  return responsiveStyles;
}

// Utility functions sorting strings as numbers and dates
function tryParseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  const stringValue = String(value).trim();

  // Remove common number formatting characters
  const cleaned = stringValue
    .replace(/[$€£¥]/g, '') // Currency symbols
    .replace(/[,%]/g, '') // Commas and percent
    .replace(/\s/g, ''); // Spaces

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

function tryParseDate(value: any): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const stringValue = String(value).trim();

  // Try standard Date constructor first
  const standardDate = new Date(stringValue);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  const formats = [
    // US format: MM/DD/YYYY or M/D/YY
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/,
    // ISO-ish: YYYY/MM/DD or YYYY-MM-DD
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/
  ];

  for (const format of formats) {
    const match = stringValue.match(format);
    if (match) {
      let year, month, day;

      if (match[1].length === 4) {
        // YYYY-MM-DD format
        [, year, month, day] = match;
      } else {
        // MM/DD/YYYY format
        [, month, day, year] = match;
      }

      // Handle 2-digit years
      if (year.length === 2) {
        const yearNum = parseInt(year);
        year = yearNum < 50 ? `20${year}` : `19${year}`;
      }

      const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  return null;
}

type SortableValue = {
  original: any;
  asNumber: number | null;
  asDate: Date | null;
  asString: string;
};

function parseSortableValue(value: any): SortableValue {
  const asNumber = tryParseNumber(value);
  const asDate = tryParseDate(value);
  const asString = stringifyWithNull(value) ?? '';

  return {
    original: value,
    asNumber,
    asDate,
    asString
  };
}

function compareSortableValues(a: SortableValue, b: SortableValue): number {
  // Try number comparison first
  if (a.asNumber !== null && b.asNumber !== null) {
    return a.asNumber - b.asNumber;
  }

  // Try date comparison
  if (a.asDate !== null && b.asDate !== null) {
    return a.asDate.getTime() - b.asDate.getTime();
  }

  // Fall back to string comparison
  return a.asString.localeCompare(b.asString);
}

function ActionButtons({
  actions,
  rowIndex,
  column,
  columnData,
  onClick
}: {
  actions: Action[];
  rowIndex: number;
  column: ActionColumn;
  columnData: Column[];
  onClick?: (payload: any) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [visibleActions, setVisibleActions] = useState(actions);
  const [overflowActions, setOverflowActions] = useState<Action[]>([]);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    // Show first 2 actions, overflow the rest
    const maxVisible = 2;
    if (actions.length > maxVisible) {
      setVisibleActions(actions.slice(0, maxVisible));
      setOverflowActions(actions.slice(maxVisible));
    } else {
      setVisibleActions(actions);
      setOverflowActions([]);
    }
  }, [actions]);

  const handleActionClick = (action: Action) => {
    setIsMenuOpen(false);

    if (!onClick) return;

    // Build row_data object
    const row_data: Record<string, any> = {};
    columnData.forEach((col) => {
      if (col.type === 'field_display') {
        const fieldValue = fieldValues[col.field_key];
        const cellValue = Array.isArray(fieldValue)
          ? fieldValue[rowIndex]
          : fieldValue;
        row_data[col.name] = cellValue;
      }
    });

    onClick({
      row: rowIndex,
      action: action.label,
      column: column.name,
      row_data
    });
  };

  return (
    <div
      ref={containerRef}
      css={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center'
      }}
    >
      {visibleActions.map((action, index) => (
        <button
          key={index}
          type='button'
          onClick={() => handleActionClick(action)}
          css={actionButtonStyle as any}
        >
          {action.label}
        </button>
      ))}
      {overflowActions.length > 0 && (
        <>
          <button
            ref={menuButtonRef}
            type='button'
            onClick={() => {
              if (!isMenuOpen && menuButtonRef.current) {
                const rect = menuButtonRef.current.getBoundingClientRect();
                setMenuPosition({
                  top: rect.bottom + 4,
                  left: rect.right
                });
              }
              setIsMenuOpen(!isMenuOpen);
            }}
            css={actionButtonStyle as any}
          >
            •••
          </button>
          {isMenuOpen &&
            createPortal(
              <div
                ref={menuRef}
                css={{
                  position: 'fixed',
                  top: `${menuPosition.top}px`,
                  left: `${menuPosition.left}px`,
                  transform: 'translateX(-100%)',
                  backgroundColor: '#ffffff',
                  border: '1px solid #d1d5db',
                  borderRadius: '4px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  zIndex: 9999,
                  minWidth: '120px'
                }}
              >
                {overflowActions.map((action, index) => (
                  <button
                    key={index}
                    type='button'
                    onClick={() => handleActionClick(action)}
                    css={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      paddingLeft: '12px',
                      paddingRight: '12px',
                      paddingTop: '8px',
                      paddingBottom: '8px',
                      fontSize: '14px',
                      color: '#374151',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        backgroundColor: '#f3f4f6'
                      },
                      '&:first-of-type': {
                        borderTopLeftRadius: '4px',
                        borderTopRightRadius: '4px'
                      },
                      '&:last-of-type': {
                        borderBottomLeftRadius: '4px',
                        borderBottomRightRadius: '4px'
                      }
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>,
              document.body
            )}
        </>
      )}
    </div>
  );
}

function TableElement({ element, responsiveStyles, onClick = () => {} }: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const columnData: Column[] = element.properties?.columns || [];
  const enableSearch = element.properties?.enable_search ?? false;
  const enablePagination = element.properties?.enable_pagination ?? false;
  const enableSort = element.properties?.enable_sort ?? false;
  const rowsPerPage = 10;

  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(0);

  const totalRows = useMemo(() => {
    return columnData.reduce((maxRows, column) => {
      if (column.type === 'field_display') {
        const fieldValue = fieldValues[column.field_key];
        if (Array.isArray(fieldValue)) {
          return Math.max(maxRows, fieldValue.length);
        }
      }
      return maxRows;
    }, 0);
  }, [columnData]);

  const allRowIndices = useMemo(
    () => Array.from({ length: totalRows }, (_, i) => i),
    [totalRows]
  );

  const filteredRowIndices = useMemo(() => {
    if (!enableSearch || !searchQuery.trim()) return allRowIndices;

    return allRowIndices.filter((rowIndex) => {
      return columnData.some((column) => {
        if (column.type === 'field_display') {
          const fieldValue = fieldValues[column.field_key];
          const cellValue = Array.isArray(fieldValue)
            ? fieldValue[rowIndex]
            : fieldValue;
          const stringValue = stringifyWithNull(cellValue) ?? '';
          return stringValue
            .toLowerCase()
            .includes(searchQuery.toLowerCase().trim());
        }
        return false;
      });
    });
  }, [allRowIndices, columnData, searchQuery, enableSearch]);

  const sortedRowIndices = useMemo(() => {
    if (!enableSort || !sortColumn) return filteredRowIndices;

    const column = columnData.find(
      (col) => col.type === 'field_display' && col.name === sortColumn
    ) as FieldDisplayColumn | undefined;

    if (!column) return filteredRowIndices;

    return [...filteredRowIndices].sort((aIdx, bIdx) => {
      const fieldValue = fieldValues[column.field_key];
      const aValue = Array.isArray(fieldValue) ? fieldValue[aIdx] : fieldValue;
      const bValue = Array.isArray(fieldValue) ? fieldValue[bIdx] : fieldValue;

      const aParsed = parseSortableValue(aValue);
      const bParsed = parseSortableValue(bValue);

      const comparison = compareSortableValues(aParsed, bParsed);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredRowIndices, sortColumn, sortDirection, columnData, enableSort]);

  const paginatedRowIndices = useMemo(() => {
    if (!enablePagination) return sortedRowIndices;

    const startIdx = currentPage * rowsPerPage;
    const endIdx = startIdx + rowsPerPage;
    return sortedRowIndices.slice(startIdx, endIdx);
  }, [sortedRowIndices, currentPage, rowsPerPage, enablePagination]);

  // Reset to first page when search or sort changes
  useEffect(() => {
    setCurrentPage(0);
  }, [searchQuery, sortColumn, sortDirection]);

  const totalPages = enablePagination
    ? Math.ceil(sortedRowIndices.length / rowsPerPage)
    : 1;

  const handleSort = (columnName: string) => {
    if (!enableSort) return;

    if (sortColumn === columnName) {
      // Cycle through: asc → desc → none
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(columnName);
      setSortDirection('asc');
    }
  };

  return (
    <div css={{ ...containerStyle, ...styles.getTarget('tableContainer') }}>
      {enableSearch && (
        <div css={searchContainerStyle}>
          <div css={searchWrapperStyle as any}>
            <div css={searchIconWrapperStyle as any}>
              <svg
                css={{
                  width: '16px',
                  height: '16px',
                  color: '#6b7280'
                }}
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
                strokeWidth={2}
              >
                <path
                  strokeLinecap='round'
                  d='M21 21l-3.5-3.5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'
                />
              </svg>
            </div>
            <input
              type='text'
              css={searchInputStyle}
              placeholder='Search'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}
      <table css={tableStyle as any}>
        <thead css={theadStyle}>
          <tr>
            {columnData.map((column, index) => {
              const isSortable = enableSort && column.type === 'field_display';
              const isSorted = sortColumn === column.name;

              return (
                <th
                  key={index}
                  scope='col'
                  onClick={() => isSortable && handleSort(column.name)}
                  css={{
                    ...thStyle,
                    ...styles.getTarget('th')
                  }}
                >
                  <div
                    css={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>{column.name}</span>
                    {isSortable && (
                      <span
                        css={{
                          display: 'flex',
                          flexDirection: 'column',
                          fontSize: '10px',
                          color: isSorted ? '#3b82f6' : '#9ca3af'
                        }}
                      >
                        <span
                          css={{
                            lineHeight: '8px',
                            opacity:
                              isSorted && sortDirection === 'asc' ? 1 : 0.3
                          }}
                        >
                          ▲
                        </span>
                        <span
                          css={{
                            lineHeight: '8px',
                            opacity:
                              isSorted && sortDirection === 'desc' ? 1 : 0.3
                          }}
                        >
                          ▼
                        </span>
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {paginatedRowIndices.map((rowIndex, displayIndex) => {
            const row_data: Record<string, any> = {};
            columnData.forEach((col) => {
              if (col.type === 'field_display') {
                const fValue = fieldValues[col.field_key];
                const cValue = Array.isArray(fValue)
                  ? fValue[rowIndex]
                  : fValue;
                row_data[col.name] = cValue;
              }
            });

            return (
              <tr key={rowIndex} css={rowStyle}>
                {columnData.map((column, colIndex) => {
                  const handleCellClick = () => {
                    onClick({
                      row: rowIndex,
                      column: column.name,
                      cell_data: cellValue,
                      row_data
                    });
                  };

                  if (column.type === 'action') {
                    return (
                      <td
                        key={colIndex}
                        onClick={handleCellClick}
                        css={{
                          ...(cellStyle as any),
                          ...styles.getTarget('td')
                        }}
                      >
                        <ActionButtons
                          actions={column.actions}
                          rowIndex={rowIndex}
                          column={column}
                          columnData={columnData}
                          onClick={onClick}
                        />
                      </td>
                    );
                  }

                  const fieldValue = fieldValues[column.field_key];
                  const cellValue = Array.isArray(fieldValue)
                    ? fieldValue[rowIndex]
                    : fieldValue;

                  return (
                    <td
                      key={colIndex}
                      onClick={handleCellClick}
                      css={{
                        ...(cellStyle as any),
                        ...styles.getTarget('td')
                      }}
                    >
                      {stringifyWithNull(cellValue) ?? ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {enablePagination && totalPages > 1 && (
        <nav css={navStyle as any} aria-label='Table navigation'>
          <span css={navTextStyle}>
            Showing{' '}
            <span css={navTextBoldStyle}>
              {currentPage * rowsPerPage + 1}-
              {Math.min(
                (currentPage + 1) * rowsPerPage,
                sortedRowIndices.length
              )}
            </span>{' '}
            of <span css={navTextBoldStyle}>{sortedRowIndices.length}</span>
          </span>
          <ul css={paginationListStyle}>
            <li>
              <button
                type='button'
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                css={pageButtonPrevStyle as any}
              >
                Previous
              </button>
            </li>
            {Array.from({ length: totalPages }, (_, i) => {
              // Show first page, last page, current page, and pages around current
              const showPage =
                i === 0 ||
                i === totalPages - 1 ||
                Math.abs(i - currentPage) <= 1;

              const showEllipsis =
                (i === 1 && currentPage > 2) ||
                (i === totalPages - 2 && currentPage < totalPages - 3);

              if (showEllipsis) {
                return (
                  <li key={i}>
                    <button
                      type='button'
                      disabled
                      css={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6b7280',
                        backgroundColor: '#f3f4f6',
                        boxSizing: 'border-box',
                        border: '1px solid #9ca3af',
                        fontWeight: 500,
                        fontSize: '14px',
                        width: '36px',
                        height: '36px',
                        cursor: 'default',
                        '&:focus': {
                          outline: 'none'
                        }
                      }}
                    >
                      ...
                    </button>
                  </li>
                );
              }

              if (!showPage) return null;

              const isActive = i === currentPage;
              return (
                <li key={i}>
                  <button
                    type='button'
                    onClick={() => setCurrentPage(i)}
                    aria-current={isActive ? 'page' : undefined}
                    css={
                      isActive
                        ? (pageButtonActiveStyle as any)
                        : (pageButtonStyle as any)
                    }
                  >
                    {i + 1}
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type='button'
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
                }
                disabled={currentPage === totalPages - 1}
                css={pageButtonNextStyle as any}
              >
                Next
              </button>
            </li>
          </ul>
        </nav>
      )}
    </div>
  );
}

export default TableElement;
