import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stringifyWithNull } from '../../../utils/primitives';
import {
  registerTableRowCount,
  unregisterTableRowCount,
  getSelectedRows,
  toggleRow,
  setSelectedRows,
  clearTableSelection
} from '../../../utils/tableState';
import { Search } from './Search';
import { SortHeader, SortIcon } from './Sort';
import { Pagination } from './Pagination';
import { ActionButtons } from './Actions';
import { EmptyState } from './EmptyState';
import { EditableCell } from './EditableCell';
import { getNextEditableCell } from './utils';
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
import { TABLE_CLASS } from './classNames';

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
  buttonLoaders = {},
  assistantClient
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
    enableAddDeleteRows,

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

  // Selection is only meaningful within one stable view; any sort/search/page
  // change resets it (base indices would otherwise point at different rows).
  const isMountedRef = useRef(false);
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    clearTableSelection(element.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, sortColumn, sortDirection, currentPage]);

  const { handleAddRow, handleDeleteRow, handleCellEdit } = useTableMutations({
    tableId: element.id,
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

  const tableId = element?.id;

  const enableRowSelection = !!element?.properties?.enable_row_selection;
  const selectedRows = getSelectedRows(element.id);

  useEffect(() => {
    registerTableRowCount(element.id, totalRows);
    return () => unregisterTableRowCount(element.id);
  }, [element.id, totalRows]);

  const canEdit = enableEditing && !isTransposed;
  const showAddRow = canEdit && enableAddDeleteRows;
  const canDeleteRows = canEdit && enableAddDeleteRows;
  const hasOverflowMenu = actions.length > 1;
  const showStandaloneDeleteColumn = canDeleteRows && !hasOverflowMenu;

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

  const [deleteRowIndex, setDeleteRowIndex] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{
    rowIndex: number;
    colIndex: number;
  } | null>(null);
  const prevPageRef = useRef(currentPage);
  if (prevPageRef.current !== currentPage) {
    prevPageRef.current = currentPage;
    setDeleteRowIndex(null);
    // A coordinate from the previous page would point at an off-page row.
    setEditingCell(null);
  }

  const requestEdit = useCallback(
    (rowIndex: number, colIndex: number) =>
      setEditingCell({ rowIndex, colIndex }),
    []
  );
  const stopEdit = useCallback(() => setEditingCell(null), []);
  const navigateEdit = useCallback(
    (rowIndex: number, colIndex: number, backward: boolean) => {
      setEditingCell(
        getNextEditableCell(
          paginatedRowIndices,
          columns.length,
          { rowIndex, colIndex },
          backward
        )
      );
    },
    [paginatedRowIndices, columns.length]
  );
  const handleCancelDelete = useCallback(() => setDeleteRowIndex(null), []);
  const deleteIconRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const actionCellRefs = useRef<Map<number, HTMLTableCellElement>>(new Map());

  const wrappedHandleAddRow = useCallback(() => {
    setDeleteRowIndex(null);
    handleAddRow();
    setPendingAddRows((prev) => {
      const next = new Set<number>();
      next.add(0);
      prev.forEach((idx) => next.add(idx + 1));
      return next;
    });
  }, [handleAddRow]);

  const wrappedHandleDeleteRow = useCallback(
    (rowIndex: number) => {
      handleDeleteRow(rowIndex);
      setDeleteRowIndex(null);
    },
    [handleDeleteRow]
  );

  // Lets the assistant invoke this table's mutations through the same handlers the user UI calls
  useEffect(() => {
    if (!assistantClient || !tableId) return;
    assistantClient.registerTable(tableId, {
      handleCellEdit: wrappedHandleCellEdit,
      handleAddRow: wrappedHandleAddRow,
      handleDeleteRow: wrappedHandleDeleteRow
    });
    return () => assistantClient.unregisterTable(tableId);
  }, [
    assistantClient,
    tableId,
    wrappedHandleCellEdit,
    wrappedHandleAddRow,
    wrappedHandleDeleteRow
  ]);

  const showEmptyState = !hasData || !hasSearchResults;
  const showToolbar = enableSearch || showAddRow;

  return (
    <div
      className={TABLE_CLASS.container}
      css={{
        ...containerStyle,
        ...styles.getTarget('container')
      }}
    >
      {showToolbar && (
        <div className={TABLE_CLASS.toolbar} css={toolbarStyle}>
          {enableSearch ? (
            <Search searchQuery={searchQuery} onSearchChange={setSearchQuery} />
          ) : (
            <div />
          )}
          {showAddRow && (
            <button
              type='button'
              className={TABLE_CLASS.addRowButton}
              css={addRowButtonStyle}
              onClick={wrappedHandleAddRow}
            >
              + Add Row
            </button>
          )}
        </div>
      )}
      {showEmptyState ? (
        <EmptyState hasSearchQuery={searchQuery.trim().length > 0} />
      ) : (
        <div css={{ overflowX: 'auto' }}>
          <table
            className={TABLE_CLASS.table}
            css={{
              ...(tableStyle as any),
              ...styles.getTarget('table')
            }}
          >
            {!isTransposed && (
              <thead className={TABLE_CLASS.header} css={theadStyle}>
                <tr>
                  {enableRowSelection && (
                    <th>
                      <input
                        type='checkbox'
                        aria-label='Select all displayed rows'
                        checked={
                          paginatedRowIndices.length > 0 &&
                          paginatedRowIndices.every((i: number) =>
                            selectedRows.includes(i)
                          )
                        }
                        onChange={(e) =>
                          setSelectedRows(
                            element.id,
                            e.target.checked ? paginatedRowIndices : []
                          )
                        }
                      />
                    </th>
                  )}
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
                      className={TABLE_CLASS.headerCell}
                      css={{
                        ...thStyle,
                        paddingLeft: 0,
                        ...styles.getTarget('th')
                      }}
                    >
                      {/* Empty header for actions column */}
                    </th>
                  )}
                  {showStandaloneDeleteColumn && (
                    <th
                      scope='col'
                      className={TABLE_CLASS.headerCell}
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
            <tbody className={TABLE_CLASS.body} css={styles.getTarget('tbody')}>
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
                    className={TABLE_CLASS.row}
                    css={{ ...rowStyle, ...styles.getTarget('tr') }}
                    onClick={handleRowClick}
                  >
                    {enableRowSelection && (
                      <td>
                        <input
                          type='checkbox'
                          aria-label={`Select row ${rowIndex + 1}`}
                          checked={selectedRows.includes(rowIndex)}
                          onChange={() => toggleRow(element.id, rowIndex)}
                        />
                      </td>
                    )}
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
                          const originalColumn = baseColumns[rowIndex];
                          onClick({
                            rowIndex: originalRowIndex,
                            rowData: originalRowData,
                            columnIndex: rowIndex,
                            columnKey: originalColumn?.field_key,
                            columnName: originalColumn?.name
                          });
                        } else if (!isTransposed && !canEdit) {
                          e.stopPropagation();
                          onClick({
                            rowIndex,
                            rowData,
                            columnIndex: colIndex,
                            columnKey: column.field_key,
                            columnName: column.name
                          });
                        }
                      };

                      // In transposed mode each rendered row holds one
                      // original field, so every cell in it belongs to
                      // baseColumns[rowIndex]
                      const cellFieldKey = isTransposed
                        ? baseColumns[rowIndex]?.field_key
                        : column.field_key;

                      return (
                        <CellElement
                          key={colIndex}
                          className={
                            isFirstColInTranspose
                              ? TABLE_CLASS.headerCell
                              : TABLE_CLASS.cell
                          }
                          data-feathery-field={cellFieldKey}
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
                              isEditing={
                                editingCell?.rowIndex === rowIndex &&
                                editingCell?.colIndex === colIndex
                              }
                              onEdit={wrappedHandleCellEdit}
                              onStartEdit={() =>
                                requestEdit(rowIndex, colIndex)
                              }
                              onStopEdit={stopEdit}
                              onNavigate={(backward) =>
                                navigateEdit(rowIndex, colIndex, backward)
                              }
                            />
                          ) : (
                            stringifyWithNull(cellValue) ?? ''
                          )}
                        </CellElement>
                      );
                    })}
                    {!isTransposed && actions.length > 0 && (
                      <td
                        ref={(el) => {
                          if (el) actionCellRefs.current.set(rowIndex, el);
                          else actionCellRefs.current.delete(rowIndex);
                        }}
                        className={TABLE_CLASS.cell}
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
                          canDeleteRows={canDeleteRows && hasOverflowMenu}
                          onDeleteRow={(ri) => setDeleteRowIndex(ri)}
                        />
                        {hasOverflowMenu &&
                          canDeleteRows &&
                          deleteRowIndex === rowIndex && (
                            <DeleteConfirm
                              anchorEl={
                                actionCellRefs.current.get(rowIndex) ?? null
                              }
                              onConfirm={() => wrappedHandleDeleteRow(rowIndex)}
                              onCancel={handleCancelDelete}
                            />
                          )}
                      </td>
                    )}
                    {showStandaloneDeleteColumn && (
                      <td
                        className={TABLE_CLASS.cell}
                        css={{
                          ...deleteColumnStyle,
                          ...styles.getTarget('td')
                        }}
                      >
                        <button
                          type='button'
                          ref={(el) => {
                            if (el) deleteIconRefs.current.set(rowIndex, el);
                            else deleteIconRefs.current.delete(rowIndex);
                          }}
                          className={TABLE_CLASS.deleteButton}
                          css={{
                            ...deleteIconStyle,
                            ...(deleteRowIndex === rowIndex && {
                              opacity: 1
                            })
                          }}
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
                            onConfirm={() => wrappedHandleDeleteRow(rowIndex)}
                            onCancel={handleCancelDelete}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {isTransposed && actions.length > 0 && (
                <tr
                  className={TABLE_CLASS.row}
                  css={{ ...rowStyle, ...styles.getTarget('tr') }}
                >
                  <th
                    scope='row'
                    className={TABLE_CLASS.headerCell}
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
                      className={TABLE_CLASS.cell}
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
        </div>
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
  );
}

export default TableElement;
