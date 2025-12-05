import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';

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

// Utility functions for intelligent sorting
function tryParseNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;

  const stringValue = String(value).trim();

  // Remove common number formatting characters
  const cleaned = stringValue
    .replace(/[$€£¥]/g, '') // Currency symbols
    .replace(/[,%]/g, '')    // Commas and percent
    .replace(/\s/g, '');     // Spaces

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

  // Try common formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, etc.
  const formats = [
    // US format: MM/DD/YYYY or M/D/YY
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/,
    // ISO-ish: YYYY/MM/DD or YYYY-MM-DD
    /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/,
  ];

  for (const format of formats) {
    const match = stringValue.match(format);
    if (match) {
      let year, month, day;

      if (match[1].length === 4) {
        // YYYY-MM-DD format
        [, year, month, day] = match;
      } else {
        // MM/DD/YYYY format (assume US)
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
    // Simple heuristic: show first 2 actions, overflow the rest
    // In a production app, you'd measure actual widths
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
    // console.log(`Action ${action.label} clicked for row ${rowIndex}`);
    setIsMenuOpen(false);

    if (!onClick) return;

    // Build row_data object with all field_display column values for this row
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

  const buttonStyles = {
    paddingLeft: '12px',
    paddingRight: '12px',
    paddingTop: '6px',
    paddingBottom: '6px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    '&:hover': {
      backgroundColor: '#f3f4f6',
      borderColor: '#9ca3af'
    }
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
          css={buttonStyles}
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
            css={{
              ...buttonStyles,
              paddingLeft: '10px',
              paddingRight: '10px'
            }}
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

function TableElement({
  element,
  responsiveStyles,
  elementProps = {},
  onClick = () => {}
}: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const columnData: Column[] = element.properties?.columns || [];
  const enableSearch = element.properties?.enable_search ?? false;
  const enablePagination = element.properties?.enable_pagination ?? false;
  const enableSort = element.properties?.enable_sort ?? false;
  const rowsPerPage = element.properties?.rows_per_page ?? 10;

  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [currentPage, setCurrentPage] = useState(0);

  // Calculate total number of rows from data
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

  // Build array of row indices
  const allRowIndices = useMemo(
    () => Array.from({ length: totalRows }, (_, i) => i),
    [totalRows]
  );

  // Filter rows based on search query
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

  // Sort filtered rows
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

      // Parse values for intelligent comparison
      const aParsed = parseSortableValue(aValue);
      const bParsed = parseSortableValue(bValue);

      const comparison = compareSortableValues(aParsed, bParsed);
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredRowIndices, sortColumn, sortDirection, columnData, enableSort]);

  // Paginate sorted rows
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
        // Remove sort
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      // Start new sort on this column
      setSortColumn(columnName);
      setSortDirection('asc');
    }
  };

  return (
    <div
      css={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
      }}
      {...elementProps}
    >
      {/* Search Bar */}
      {enableSearch && (
        <div
          css={{
            padding: '12px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#ffffff'
          }}
        >
          <input
            type='text'
            placeholder='Search...'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            css={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '14px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              '&:focus': {
                outline: 'none',
                borderColor: '#3b82f6',
                boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)'
              }
            }}
          />
        </div>
      )}

      {/* Table Container */}
      <div
        css={{
          position: 'relative',
          overflowX: 'auto',
          flex: 1,
          ...styles.getTarget('tableContainer')
        }}
      >
        <table
          css={{
            backgroundColor: '#e5e7eb',
            borderWidth: 1,
            borderColor: '#a1a3a6',
            width: '100%',
            fontSize: '14px',
            textAlign: 'left',
            color: '#6b7280',
            ...styles.getTarget('table')
          }}
        >
          <thead
            css={{
              fontSize: '14px',
              color: '#6b7280',
              backgroundColor: '#f3f4f6',
              borderBottom: '1px solid #e5e7eb',
              ...styles.getTarget('thead')
            }}
          >
            <tr>
              {columnData.map((column, index) => {
                const isSortable =
                  enableSort && column.type === 'field_display';
                const isSorted = sortColumn === column.name;

                return (
                  <th
                    key={index}
                    scope='col'
                    onClick={() => isSortable && handleSort(column.name)}
                    css={{
                      paddingLeft: '24px',
                      paddingRight: '24px',
                      paddingTop: '12px',
                      paddingBottom: '12px',
                      fontWeight: 500,
                      textAlign: 'left',
                      cursor: isSortable ? 'pointer' : 'default',
                      userSelect: 'none',
                      '&:hover': isSortable
                        ? { backgroundColor: '#e5e7eb' }
                        : {},
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
          <tbody css={styles.getTarget('tbody')}>
            {paginatedRowIndices.map((rowIndex, displayIndex) => {
              const isLastRow = displayIndex === paginatedRowIndices.length - 1;
              return (
                <tr
                  key={rowIndex}
                  css={{
                    backgroundColor: '#ffffff',
                    ...(isLastRow ? {} : { borderBottom: '1px solid #e5e7eb' })
                  }}
                >
                  {columnData.map((column, colIndex) => {
                    if (column.type === 'action') {
                      return (
                        <td
                          key={colIndex}
                          css={{
                            paddingLeft: '24px',
                            paddingRight: '24px',
                            paddingTop: '16px',
                            paddingBottom: '16px',
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

                    // Handle field_display columns
                    const fieldValue = fieldValues[column.field_key];
                    const cellValue = Array.isArray(fieldValue)
                      ? fieldValue[rowIndex]
                      : fieldValue;

                    // Build row_data for cell clicks
                    const handleCellClick = () => {
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

                      onClick({
                        row: rowIndex,
                        column: column.name,
                        cell_data: cellValue,
                        row_data
                      });
                    };

                    return (
                      <td
                        key={colIndex}
                        onClick={handleCellClick}
                        css={{
                          paddingLeft: '24px',
                          paddingRight: '24px',
                          paddingTop: '16px',
                          paddingBottom: '16px',
                          ...styles.getTarget('td')
                        }}
                      >
                        {/* TODO: display all values properly (e.g. images) */}
                        {stringifyWithNull(cellValue) ?? ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {enablePagination && totalPages > 1 && (
        <div
          css={{
            padding: '12px',
            borderTop: '1px solid #e5e7eb',
            backgroundColor: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px'
          }}
        >
          <div css={{ fontSize: '14px', color: '#6b7280' }}>
            Showing {currentPage * rowsPerPage + 1} to{' '}
            {Math.min((currentPage + 1) * rowsPerPage, sortedRowIndices.length)}{' '}
            of {sortedRowIndices.length} results
          </div>
          <div css={{ display: 'flex', gap: '8px' }}>
            <button
              type='button'
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              css={{
                padding: '6px 12px',
                fontSize: '14px',
                fontWeight: 500,
                color: currentPage === 0 ? '#9ca3af' : '#374151',
                backgroundColor: 'transparent',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
                '&:hover:not(:disabled)': {
                  backgroundColor: '#f3f4f6'
                }
              }}
            >
              Previous
            </button>
            <div css={{ display: 'flex', gap: '4px' }}>
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
                    <span
                      key={i}
                      css={{
                        padding: '6px 12px',
                        fontSize: '14px',
                        color: '#9ca3af'
                      }}
                    >
                      ...
                    </span>
                  );
                }

                if (!showPage) return null;

                return (
                  <button
                    key={i}
                    type='button'
                    onClick={() => setCurrentPage(i)}
                    css={{
                      padding: '6px 12px',
                      fontSize: '14px',
                      fontWeight: 500,
                      color: i === currentPage ? '#ffffff' : '#374151',
                      backgroundColor:
                        i === currentPage ? '#3b82f6' : 'transparent',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      minWidth: '36px',
                      '&:hover': {
                        backgroundColor:
                          i === currentPage ? '#2563eb' : '#f3f4f6'
                      }
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <button
              type='button'
              onClick={() =>
                setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
              }
              disabled={currentPage === totalPages - 1}
              css={{
                padding: '6px 12px',
                fontSize: '14px',
                fontWeight: 500,
                color: currentPage === totalPages - 1 ? '#9ca3af' : '#374151',
                backgroundColor: 'transparent',
                border: '1px solid #d1d5db',
                borderRadius: '4px',
                cursor:
                  currentPage === totalPages - 1 ? 'not-allowed' : 'pointer',
                '&:hover:not(:disabled)': {
                  backgroundColor: '#f3f4f6'
                }
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TableElement;
