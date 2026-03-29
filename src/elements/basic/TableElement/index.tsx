import { useCallback, useMemo, useRef, useState } from 'react';
import { stringifyWithNull } from '../../../utils/primitives';
import { Search } from './Search';
import { SortHeader, SortIcon } from './Sort';
import { Pagination } from './Pagination';
import { ActionButtons } from './Actions';
import { EmptyState } from './EmptyState';
import { EditableCell } from './EditableCell';
import { DeleteConfirm } from './DeleteConfirm';
import { useTableData } from './useTableData';
import { useTableMutations } from './useTableMutations';
import { TrashIcon } from '../../components/icons';
import {
  containerStyle,
  rowStyle,
  cellStyle,
  tableStyle,
  theadStyle,
  thStyle,
  sortHeaderContentStyle,
  sortIconContainerStyle,
  toolbarStyle,
  addRowButtonStyle,
  deleteColumnStyle,
  deleteIconStyle
} from './styles';

function applyTableStyles(responsiveStyles: any) {
  responsiveStyles.addTargets('table', 'thead', 'tbody', 'th', 'td', 'tr');
  return responsiveStyles;
}

function TableElement({
  element,
  responsiveStyles,
  onClick = () => {},
  updateFieldValues = () => {},
  submitCustom = () => {},
  editMode = false,
  buttonLoaders = {}
}: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const [dataVersion, setDataVersion] = useState(0);
  const onMutate = useCallback(() => setDataVersion((v) => v + 1), []);

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

    // editing
    enableEditing,
    enableAddRows,
    enableDeleteRows,

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
  } = useTableData({ element, editMode, dataVersion });

  const {
    handleAddRow,
    handleDeleteRow,
    handleRemoveRowLocal,
    handleCellEdit,
    handleCellClear
  } = useTableMutations({
    columns: baseColumns,
    updateFieldValues,
    submitCustom,
    editMode,
    editModeFieldValues: activeFieldValues,
    enablePagination,
    setCurrentPage,
    setSearchQuery,
    searchQuery,
    onMutate
  });

  const canEdit = enableEditing && !isTransposed;
  const showAddRow = canEdit && enableAddRows;
  const canDeleteRows = canEdit && enableDeleteRows;
  const showDeleteColumn = canEdit && (enableDeleteRows || enableAddRows);

  const [pendingAddRows, setPendingAddRows] = useState<Set<number>>(new Set());
  const pendingAddRowsRef = useRef(pendingAddRows);
  pendingAddRowsRef.current = pendingAddRows;

  const wrappedHandleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      if (pendingAddRowsRef.current.has(rowIndex)) {
        setPendingAddRows((prev) => {
          const next = new Set(prev);
          next.delete(rowIndex);
          return next;
        });
      }
      handleCellEdit(fieldKey, rowIndex, newValue);
    },
    [handleCellEdit]
  );

  const handleDismissAddRow = useCallback(
    (rowIndex: number) => {
      handleRemoveRowLocal(rowIndex);
      setPendingAddRows((prev) => {
        const next = new Set<number>();
        prev.forEach((idx) => {
          if (idx !== rowIndex) next.add(idx > rowIndex ? idx - 1 : idx);
        });
        return next;
      });
    },
    [handleRemoveRowLocal]
  );

  const [deleteRowIndex, setDeleteRowIndex] = useState<number | null>(null);
  const prevPageRef = useRef(currentPage);
  if (prevPageRef.current !== currentPage) {
    prevPageRef.current = currentPage;
    setDeleteRowIndex(null);
  }
  const handleCancelDelete = useCallback(() => setDeleteRowIndex(null), []);
  const deleteIconRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const showEmptyState = !hasData || !hasSearchResults;
  const showToolbar = enableSearch || showAddRow;

  return (
    <div
      css={{
        ...containerStyle,
        ...styles.getTarget('container')
      }}
    >
      <div css={{ minWidth: 'fit-content' }}>
        {showToolbar && (
          <div css={toolbarStyle}>
            {enableSearch ? (
              <Search
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            ) : (
              <div />
            )}
            {showAddRow && (
              <button
                type='button'
                css={addRowButtonStyle}
                onClick={() => {
                  setDeleteRowIndex(null);
                  handleAddRow();
                  setPendingAddRows((prev) => {
                    const next = new Set<number>();
                    next.add(0);
                    prev.forEach((idx) => next.add(idx + 1));
                    return next;
                  });
                }}
              >
                + Add Row
              </button>
            )}
          </div>
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
                  {showDeleteColumn && (
                    <th
                      scope='col'
                      css={{
                        ...thStyle,
                        ...deleteColumnStyle,
                        ...styles.getTarget('th')
                      }}
                    />
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
                  if (!isTransposed && !canEdit) {
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
                          ) : canEdit ? (
                            <EditableCell
                              value={cellValue}
                              fieldKey={column.field_key}
                              rowIndex={rowIndex}
                              onEdit={wrappedHandleCellEdit}
                              onClear={handleCellClear}
                            />
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
                          tableId={element.id}
                          buttonLoaders={buttonLoaders}
                        />
                      </td>
                    )}
                    {showDeleteColumn && (
                      <td
                        css={{
                          ...deleteColumnStyle,
                          ...styles.getTarget('td')
                        }}
                      >
                        {canDeleteRows ? (
                          <>
                            <button
                              type='button'
                              ref={(el) => {
                                if (el)
                                  deleteIconRefs.current.set(rowIndex, el);
                                else deleteIconRefs.current.delete(rowIndex);
                              }}
                              css={deleteIconStyle}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteRowIndex(
                                  deleteRowIndex === rowIndex ? null : rowIndex
                                );
                              }}
                            >
                              <TrashIcon />
                            </button>
                            {deleteRowIndex === rowIndex && (
                              <DeleteConfirm
                                anchorEl={
                                  deleteIconRefs.current.get(rowIndex) ?? null
                                }
                                onConfirm={() => {
                                  handleDeleteRow(rowIndex);
                                  setDeleteRowIndex(null);
                                }}
                                onCancel={handleCancelDelete}
                              />
                            )}
                          </>
                        ) : (
                          pendingAddRows.has(rowIndex) && (
                            <button
                              type='button'
                              css={{ ...deleteIconStyle, opacity: 1 }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDismissAddRow(rowIndex);
                              }}
                            >
                              <TrashIcon />
                            </button>
                          )
                        )}
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
                          tableId={element.id}
                          buttonLoaders={buttonLoaders}
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
