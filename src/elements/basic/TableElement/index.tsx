import { useMemo } from 'react';
import { stringifyWithNull } from '../../../utils/primitives';
import { Search } from './Search';
import { SortHeader, SortIcon } from './Sort';
import { Pagination } from './Pagination';
import { ActionButtons } from './Actions';
import { EmptyState } from './EmptyState';
import { useTableData } from './useTableData';
import {
  containerStyle,
  rowStyle,
  cellStyle,
  tableStyle,
  theadStyle,
  thStyle,
  sortHeaderContentStyle,
  sortIconContainerStyle
} from './styles';

function applyTableStyles(responsiveStyles: any) {
  responsiveStyles.addTargets('table', 'thead', 'tbody', 'th', 'td', 'tr');
  return responsiveStyles;
}

function TableElement({
  element,
  responsiveStyles,
  onClick = () => {},
  editMode = false
}: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const {
    // search
    enableSearch,
    searchQuery,
    setSearchQuery,

    // sort
    enableSort,
    sortColumn,
    sortDirection,
    sortedColumnIndex,
    handleSort,
    handleTransposedSort,

    // pagination
    enablePagination,
    currentPage,
    setCurrentPage,
    paginatedRowIndices,
    rowsPerPage,

    // data
    columns,
    actions,
    isTransposed,
    transposedRowIndices,
    totalRows,
    totalPages,
    hasData,
    hasSearchResults,
    activeFieldValues,
    baseColumns,
    baseFieldValues
  } = useTableData({ element, editMode });

  const showEmptyState = !hasData || (hasData && !hasSearchResults);

  return (
    <div
      css={{
        ...containerStyle,
        ...styles.getTarget('container')
      }}
    >
      <div css={{ minWidth: 'fit-content' }}>
        {enableSearch && (
          <Search searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        )}
        {showEmptyState ? (
          <EmptyState hasSearchQuery={searchQuery.trim().length > 0} />
        ) : (
          <table css={{ ...(tableStyle as any), ...styles.getTarget('table') }}>
            {!isTransposed && (
              <thead css={theadStyle}>
                <tr>
                  <SortHeader
                    columns={columns}
                    enableSort={enableSort}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    styles={styles}
                  />
                  {actions.length > 0 && (
                    <th
                      scope='col'
                      css={{
                        ...thStyle,
                        paddingLeft: 0,
                        ...styles.getTarget('th')
                      }}
                    >
                      {/* Empty header for actions column */}
                    </th>
                  )}
                </tr>
              </thead>
            )}
            <tbody css={styles.getTarget('tbody')}>
              {paginatedRowIndices.map((rowIndex) => {
                const rowData: Record<string, any> = {};
                if (!isTransposed) {
                  columns.forEach((col) => {
                    const fValue = activeFieldValues[col.field_key];
                    const cValue = Array.isArray(fValue)
                      ? fValue[rowIndex]
                      : fValue;
                    rowData[col.name] = cValue;
                  });
                }

                const handleRowClick = () => {
                  if (!isTransposed) {
                    onClick({
                      rowIndex,
                      rowData
                    });
                  }
                };

                return (
                  <tr
                    key={rowIndex}
                    css={{ ...rowStyle, ...styles.getTarget('tr') }}
                    onClick={handleRowClick}
                  >
                    {columns.map((column, colIndex) => {
                      const fieldValue = activeFieldValues[column.field_key];
                      const cellValue = Array.isArray(fieldValue)
                        ? fieldValue[rowIndex]
                        : fieldValue;

                      const isFirstColInTranspose =
                        isTransposed && colIndex === 0;
                      const isSortable = isFirstColInTranspose && enableSort;
                      const isSorted = sortedColumnIndex === rowIndex;

                      const isFirstColumn = colIndex === 0;
                      const isSecondColumn = colIndex === 1;

                      // In transposed mode, get the original row index from the column
                      const originalRowIndex =
                        isTransposed && !isFirstColInTranspose
                          ? (column as any).originalRowIndex
                          : undefined;

                      const cellCss = isFirstColInTranspose
                        ? {
                            ...thStyle,
                            backgroundColor: '#f9fafb',
                            borderRight: '1px solid #e5e7eb',
                            width: '1px',
                            whiteSpace: 'nowrap',
                            ...styles.getTarget('th'),
                            ...(isSortable ? { cursor: 'pointer' } : {})
                          }
                        : {
                            ...(cellStyle as any),
                            ...(isTransposed
                              ? isSecondColumn
                                ? {}
                                : { paddingLeft: 0 }
                              : isFirstColumn
                              ? {}
                              : { paddingLeft: 0 }),
                            ...(isTransposed && !isFirstColInTranspose
                              ? { cursor: 'pointer' }
                              : {}),
                            ...styles.getTarget('td')
                          };

                      const CellElement = isFirstColInTranspose ? 'th' : 'td';

                      const handleCellClick = (e: React.MouseEvent) => {
                        if (isSortable) {
                          handleTransposedSort(rowIndex);
                        } else if (
                          isTransposed &&
                          originalRowIndex !== undefined
                        ) {
                          // In transposed mode, clicking a cell triggers with original row data
                          e.stopPropagation();
                          const originalRowData: Record<string, any> = {};
                          baseColumns.forEach((col) => {
                            const fValue = baseFieldValues[col.field_key];
                            const cValue = Array.isArray(fValue)
                              ? fValue[originalRowIndex]
                              : fValue;
                            originalRowData[col.name] = cValue;
                          });
                          onClick({
                            rowIndex: originalRowIndex,
                            rowData: originalRowData
                          });
                        }
                      };

                      return (
                        <CellElement
                          key={colIndex}
                          css={cellCss}
                          onClick={handleCellClick}
                          {...(isFirstColInTranspose ? { scope: 'row' } : {})}
                        >
                          {isFirstColInTranspose && isSortable ? (
                            <div
                              css={{
                                ...sortHeaderContentStyle,
                                justifyContent: 'space-between'
                              }}
                            >
                              <span>{stringifyWithNull(cellValue) ?? ''}</span>
                              <span css={sortIconContainerStyle}>
                                <SortIcon
                                  isSorted={isSorted}
                                  sortDirection={sortDirection}
                                />
                              </span>
                            </div>
                          ) : (
                            stringifyWithNull(cellValue) ?? ''
                          )}
                        </CellElement>
                      );
                    })}
                    {!isTransposed && actions.length > 0 && (
                      <td
                        css={{
                          ...(cellStyle as any),
                          paddingLeft: 0,
                          ...styles.getTarget('td')
                        }}
                      >
                        <ActionButtons
                          actions={actions}
                          rowIndex={rowIndex}
                          columnData={baseColumns}
                          fieldValues={baseFieldValues}
                          onClick={onClick}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {isTransposed && actions.length > 0 && (
                <tr css={{ ...rowStyle, ...styles.getTarget('tr') }}>
                  <th
                    scope='row'
                    css={{
                      ...thStyle,
                      backgroundColor: '#f9fafb',
                      borderRight: '1px solid #e5e7eb',
                      width: '1px',
                      whiteSpace: 'nowrap',
                      ...styles.getTarget('th')
                    }}
                  >
                    {/* Empty cell for actions row */}
                  </th>
                  {transposedRowIndices.map((originalRowIndex, idx) => (
                    <td
                      key={originalRowIndex}
                      css={{
                        ...(cellStyle as any),
                        ...(idx === 0 ? {} : { paddingLeft: 0 }),
                        ...styles.getTarget('td')
                      }}
                    >
                      <div
                        css={{ display: 'flex', justifyContent: 'flex-start' }}
                      >
                        <ActionButtons
                          actions={actions}
                          rowIndex={originalRowIndex}
                          columnData={baseColumns}
                          fieldValues={baseFieldValues}
                          onClick={onClick}
                          forceInlineButtons
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        )}
        {!showEmptyState && enablePagination && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalRows}
            rowsPerPage={rowsPerPage}
            onPageChange={setCurrentPage}
          />
        )}
      </div>
    </div>
  );
}

export default TableElement;
