import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stringifyWithNull } from '../../../utils/primitives';
import { Search } from './Search';
import { SortHeader, SortIcon } from './Sort';
import { Pagination } from './Pagination';
import { ActionButtons } from './Actions';
import { EmptyState } from './EmptyState';
import { EditableCell } from './EditableCell';
import { getAdjacentCell, getNextEditableCell, MoveDirection } from './utils';
import { CellCoord } from './types';
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
  deleteIconStyle,
  spreadsheetContainerStyle,
  spreadsheetTheadStyle,
  spreadsheetThStyle,
  spreadsheetCellStyle,
  spreadsheetRowStyle,
  rowNumberCellStyle,
  selectedCellStyle
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

  const { handleAddRow, handleDeleteRow, handleCellEdit } = useTableMutations({
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

  const isSpreadsheet = element?.properties?.display_mode === 'spreadsheet';
  // Selection/keyboard interactions only apply to the normal row layout
  const spreadsheetNav = isSpreadsheet && !isTransposed;

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
  const [selectedCell, setSelectedCell] = useState<CellCoord | null>(null);
  // Type-to-edit: the printable key that opened the editor, replacing content
  const [editSeed, setEditSeed] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevPageRef = useRef(currentPage);
  if (prevPageRef.current !== currentPage) {
    prevPageRef.current = currentPage;
    setDeleteRowIndex(null);
    // A coordinate from the previous page would point at an off-page row.
    setEditingCell(null);
    setSelectedCell(null);
  }
  // A search change can filter out the selected row without a page change,
  // leaving an invisible stale selection that wedges arrow-key navigation
  const prevSearchRef = useRef(searchQuery);
  if (prevSearchRef.current !== searchQuery) {
    prevSearchRef.current = searchQuery;
    setEditingCell(null);
    setSelectedCell(null);
  }

  const requestEdit = useCallback(
    (rowIndex: number, colIndex: number) =>
      setEditingCell({ rowIndex, colIndex }),
    []
  );
  const stopEdit = useCallback(() => {
    setEditingCell(null);
    setEditSeed(null);
  }, []);

  const moveSelection = useCallback(
    (direction: MoveDirection) => {
      setSelectedCell((prev) => {
        if (!prev) return prev;
        return (
          getAdjacentCell(
            paginatedRowIndices,
            columns.length,
            prev,
            direction
          ) ?? prev
        );
      });
    },
    [paginatedRowIndices, columns.length]
  );

  // Keyboard users can enter the grid by tabbing to it; seed the selection
  // so arrow-key navigation has a starting point
  const handleContainerFocus = () => {
    if (!paginatedRowIndices.length || !columns.length) return;
    // Functional update: a click focuses the container in the same batch as
    // it sets the clicked cell, and that selection must win over the seed
    setSelectedCell(
      (prev) => prev ?? { rowIndex: paginatedRowIndices[0], colIndex: 0 }
    );
  };

  const handleContainerKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedCell || editingCell) return;
    // Keystrokes in the search box, cell editor, or buttons are not grid
    // navigation
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, button, select')) return;
    const arrows: Record<string, MoveDirection> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right'
    };
    const direction = arrows[e.key];
    if (direction) {
      e.preventDefault();
      moveSelection(direction);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setSelectedCell(
        (prev) =>
          prev &&
          (getNextEditableCell(
            paginatedRowIndices,
            columns.length,
            prev,
            e.shiftKey
          ) ??
            prev)
      );
    } else if (e.key === 'Escape') {
      setSelectedCell(null);
    } else if (!canEdit) {
      // Read-only spreadsheets keep selection/navigation but never edit
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      setEditSeed(null);
      setEditingCell(selectedCell);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setEditSeed(e.key);
      setEditingCell(selectedCell);
    }
  };
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
    // Row indices shift; a kept selection would point at different data
    setSelectedCell(null);
    setEditingCell(null);
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
      setSelectedCell(null);
      setEditingCell(null);
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
      ref={containerRef}
      className={TABLE_CLASS.container}
      {...(spreadsheetNav
        ? {
            tabIndex: 0,
            onKeyDown: handleContainerKeyDown,
            onFocus: handleContainerFocus
          }
        : {})}
      css={{
        ...containerStyle,
        ...(isSpreadsheet ? spreadsheetContainerStyle : {}),
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
            {...(spreadsheetNav ? { role: 'grid' } : {})}
            css={{
              ...(tableStyle as any),
              ...styles.getTarget('table')
            }}
          >
            {!isTransposed && (
              <thead
                className={TABLE_CLASS.header}
                css={{
                  ...theadStyle,
                  ...(isSpreadsheet ? spreadsheetTheadStyle : {})
                }}
              >
                <tr>
                  {isSpreadsheet && (
                    <th
                      scope='col'
                      className={TABLE_CLASS.rowNumber}
                      css={{ ...rowNumberCellStyle, zIndex: 3 }}
                    />
                  )}
                  <SortHeader
                    columns={columns}
                    enableSort={enableSort}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                    styles={styles}
                    spreadsheet={isSpreadsheet}
                  />
                  {actions.length > 0 && (
                    <th
                      scope='col'
                      className={TABLE_CLASS.headerCell}
                      css={{
                        ...thStyle,
                        ...(isSpreadsheet
                          ? spreadsheetThStyle
                          : { paddingLeft: 0 }),
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
                        ...(isSpreadsheet ? spreadsheetThStyle : {}),
                        ...deleteColumnStyle,
                        ...styles.getTarget('th')
                      }}
                    />
                  )}
                </tr>
              </thead>
            )}
            <tbody className={TABLE_CLASS.body} css={styles.getTarget('tbody')}>
              {paginatedRowIndices.map((rowIndex, displayIdx) => {
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
                    css={{
                      ...(isSpreadsheet ? spreadsheetRowStyle : rowStyle),
                      ...styles.getTarget('tr')
                    }}
                    onClick={handleRowClick}
                  >
                    {spreadsheetNav && (
                      <th
                        scope='row'
                        className={TABLE_CLASS.rowNumber}
                        css={rowNumberCellStyle}
                      >
                        {currentPage * rowsPerPage + displayIdx + 1}
                      </th>
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

                      const isSelected =
                        spreadsheetNav &&
                        selectedCell?.rowIndex === rowIndex &&
                        selectedCell?.colIndex === colIndex;

                      const cellCss = isFirstColInTranspose
                        ? {
                            ...(isSpreadsheet ? spreadsheetThStyle : thStyle),
                            backgroundColor: '#f9fafb',
                            borderRight: '1px solid #e5e7eb',
                            width: '1px',
                            whiteSpace: 'nowrap',
                            ...styles.getTarget('th'),
                            ...(isSortable ? { cursor: 'pointer' } : {})
                          }
                        : isSpreadsheet
                        ? {
                            ...(spreadsheetCellStyle as any),
                            ...(isTransposed && !isFirstColInTranspose
                              ? { cursor: 'pointer' }
                              : {}),
                            ...(isSelected ? selectedCellStyle : {}),
                            ...styles.getTarget('td')
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
                        if (spreadsheetNav) {
                          setSelectedCell({ rowIndex, colIndex });
                          containerRef.current?.focus();
                        }
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
                          {...(isSelected ? { 'aria-selected': true } : {})}
                          {...(spreadsheetNav && canEdit
                            ? {
                                onDoubleClick: () =>
                                  requestEdit(rowIndex, colIndex)
                              }
                            : {})}
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
                              seedValue={editSeed}
                              clickToEdit={!spreadsheetNav}
                              onEnterCommit={
                                spreadsheetNav
                                  ? () => moveSelection('down')
                                  : undefined
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
                          ...(isSpreadsheet
                            ? (spreadsheetCellStyle as any)
                            : { ...(cellStyle as any), paddingLeft: 0 }),
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
                          ...(isSpreadsheet
                            ? (spreadsheetCellStyle as any)
                            : {}),
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
