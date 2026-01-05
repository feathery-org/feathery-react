import { useMemo } from 'react';
import { stringifyWithNull } from '../../../utils/primitives';
import { Search } from './Search';
import { SortHeader } from './Sort';
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
  sortIconContainerStyle,
  sortArrowStyle
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
    activeFieldValues
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
                columns.forEach((col) => {
                  const fValue = activeFieldValues[col.field_key];
                  const cValue = Array.isArray(fValue)
                    ? fValue[rowIndex]
                    : fValue;
                  rowData[col.name] = cValue;
                });

                const handleRowClick = () => {
                  onClick({
                    rowIndex,
                    rowData
                  });
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

                      // Apply header styles to first column when transposed
                      const isFirstColInTranspose =
                        isTransposed && colIndex === 0;
                      const isSortable = isFirstColInTranspose && enableSort;
                      const isSorted = sortedColumnIndex === rowIndex;

                      const isFirstColumn = colIndex === 0;
                      const isSecondColumn = colIndex === 1;

                      const cellCss = isFirstColInTranspose
                        ? {
                            ...thStyle,
                            backgroundColor: '#f9fafb', // gray50 - same as header
                            borderRight: '1px solid #e5e7eb', // gray200
                            width: '1px',
                            whiteSpace: 'nowrap',
                            ...styles.getTarget('th'),
                            ...(isSortable ? { cursor: 'pointer' } : {})
                          }
                        : {
                            ...(cellStyle as any),
                            // In transposed: keep padding on 2nd column, remove from rest
                            // In normal: keep padding on 1st column, remove from rest
                            ...(isTransposed
                              ? isSecondColumn
                                ? {}
                                : { paddingLeft: 0 }
                              : isFirstColumn
                              ? {}
                              : { paddingLeft: 0 }),
                            ...styles.getTarget('td')
                          };

                      // Use th element for first column in transposed table
                      const CellElement = isFirstColInTranspose ? 'th' : 'td';

                      const handleCellClick = () => {
                        if (isSortable) {
                          handleTransposedSort(rowIndex);
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
                                <svg
                                  xmlns='http://www.w3.org/2000/svg'
                                  viewBox='0 0 24 24'
                                  fill='none'
                                  aria-hidden='true'
                                >
                                  <path
                                    css={sortArrowStyle}
                                    stroke='currentColor'
                                    data-active={
                                      (isSorted && sortDirection === 'asc') ||
                                      undefined
                                    }
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                    strokeWidth={2}
                                    d='m8 9 4-4 4 4'
                                  />
                                  <path
                                    css={sortArrowStyle}
                                    stroke='currentColor'
                                    data-active={
                                      (isSorted && sortDirection === 'desc') ||
                                      undefined
                                    }
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                    strokeWidth={2}
                                    d='m8 15 4 4 4-4'
                                  />
                                </svg>
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
                          columnData={columns}
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
                          columnData={columns}
                          onClick={onClick}
                          forceInlineButtons={true}
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
