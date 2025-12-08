import { useMemo } from 'react';
import { fieldValues } from '../../../utils/init';
import { stringifyWithNull } from '../../../utils/primitives';
import { Search } from './Search';
import { SortHeader } from './Sort';
import { Pagination } from './Pagination';
import { ActionButtons } from './Actions';
import { Action, Column } from './types';
import { useTableData } from './useTableData';
import {
  containerStyle,
  rowStyle,
  cellStyle,
  tableStyle,
  theadStyle,
  thStyle
} from './styles';

function applyTableStyles(responsiveStyles: any) {
  responsiveStyles.addTargets('table', 'thead', 'tbody', 'th', 'td', 'tr');
  return responsiveStyles;
}

function TableElement({ element, responsiveStyles, onClick = () => {} }: any) {
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
    handleSort,

    // pagination
    enablePagination,
    currentPage,
    setCurrentPage,
    paginatedRowIndices,
    rowsPerPage,

    // data
    columns,
    actions,
    totalRows,
    totalPages
  } = useTableData({ element });

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
        <table css={{ ...(tableStyle as any), ...styles.getTarget('table') }}>
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
                    ...styles.getTarget('th')
                  }}
                >
                  {/* Empty header for actions column */}
                </th>
              )}
            </tr>
          </thead>
          <tbody css={styles.getTarget('tbody')}>
            {paginatedRowIndices.map((rowIndex) => {
              const rowData: Record<string, any> = {};
              columns.forEach((col) => {
                const fValue = fieldValues[col.field_key];
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
                    const fieldValue = fieldValues[column.field_key];
                    const cellValue = Array.isArray(fieldValue)
                      ? fieldValue[rowIndex]
                      : fieldValue;

                    return (
                      <td
                        key={colIndex}
                        css={{
                          ...(cellStyle as any),
                          ...styles.getTarget('td')
                        }}
                      >
                        {stringifyWithNull(cellValue) ?? ''}
                      </td>
                    );
                  })}
                  {actions.length > 0 && (
                    <td
                      css={{
                        ...(cellStyle as any),
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
          </tbody>
        </table>
        {enablePagination && (
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
