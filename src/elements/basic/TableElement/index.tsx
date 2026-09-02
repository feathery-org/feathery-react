import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { stringifyWithNull } from '../../../utils/primitives';
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
import { useHubTableSource } from './useHubTableSource';
import { SpreadsheetTable } from './spreadsheet/SpreadsheetTable';
import { usePendingEdits } from './spreadsheet/usePendingEdits';
import {
  CellErrors,
  cellErrorKey,
  fieldCellRules,
  validateGrid
} from './spreadsheet/validation';
import { validationColors } from './spreadsheet/styles';
import { AddColumnHandler, CellWrite, GetCellShading } from './types';
import { TrashIcon } from '../../components/icons';
import { clearUnsavedWork, setUnsavedWork } from '../../../utils/unsavedWork';
import {
  containerStyle,
  rowStyle,
  cellStyle,
  dataColumnMinWidthStyle,
  tableStyle,
  theadStyle,
  thStyle,
  sortHeaderContentStyle,
  sortIconContainerStyle,
  toolbarStyle,
  addRowButtonStyle,
  errorBannerStyle,
  deleteColumnStyle,
  deleteIconStyle
} from './styles';
import { TABLE_CLASS } from './classNames';

function applyTableStyles(responsiveStyles: any) {
  responsiveStyles.addTargets('table', 'thead', 'tbody', 'th', 'td', 'tr');
  // A fixed pixel height caps the table so its rows scroll inside it. The
  // element wrapper ignores px heights on element nodes, so the element has to
  // apply its own; % is capped by the wrapper and filled by `height: 100%`.
  responsiveStyles.apply(
    'container',
    ['height', 'height_unit'],
    (height: any, unit: any) =>
      unit === 'px' && height ? { height: `${height}px` } : {}
  );
  return responsiveStyles;
}

// Warns before a step transition, a browser back/forward, or a page exit
// throws buffered spreadsheet edits away.
const UNSAVED_TABLE_MESSAGE =
  'You have unsaved changes in a table. If you leave now, your changes will be lost.';

function TableElement({
  element,
  formId,
  responsiveStyles,
  onClick = () => {},
  updateFieldValues = () => {},
  submitCustom = () => {},
  editMode = false,
  buttonLoaders = {},
  assistantClient,
  client
}: any) {
  const styles = useMemo(
    () => applyTableStyles(responsiveStyles),
    [responsiveStyles]
  );

  const [dataVersion, setDataVersion] = useState(0);
  const onMutate = useCallback(() => setDataVersion((v) => v + 1), []);

  // Data Hub-backed tables source their rows from the Hub (live forms only;
  // the builder keeps rendering example data).
  const isHub =
    element.properties?.data_source === 'hub' &&
    !!element.properties?.hub_id &&
    !editMode;

  const wantsSpreadsheet = element.properties?.display_mode === 'spreadsheet';

  /**
   * Spreadsheet mode holds edits until the user saves them. The classic table
   * keeps writing through on every edit: its cells are individually committed
   * form inputs, so there is no batch for a Save button to act on.
   */
  const pendingEdits = usePendingEdits();
  // Not in the builder: an unsaved cell there would guard the designer's own
  // navigation, and the canvas is showing example data anyway.
  const buffersEdits = wantsSpreadsheet && !editMode;
  const hasPendingEdits = buffersEdits && pendingEdits.count > 0;

  const hub = useHubTableSource({
    element,
    client,
    enabled: isHub,
    blockRefetch: hasPendingEdits
  });

  const elementForData = useMemo(() => {
    const properties = {
      ...element.properties,
      ...(isHub ? { columns: hub.hubColumns } : {}),
      // Features the spreadsheet has no place for. They are overridden here
      // rather than cleared off the element, so switching back to the classic
      // table restores whatever the builder had configured.
      //   pagination — every row is virtualized, so paging only hides rows.
      //   search/sort — the grid has no affordance for either; a header click
      //     selects the column, Excel-style.
      //   transpose — one field per row has no (row, column) coordinates for
      //     selection, fill or the clipboard to work against.
      ...(wantsSpreadsheet
        ? { pagination: 0, search: false, sort: false, transpose: false }
        : {})
    };
    return { ...element, properties };
  }, [isHub, element, hub.hubColumns, wantsSpreadsheet]);

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
  } = useTableData({
    element: elementForData,
    editMode,
    dataVersion,
    externalFieldValues: isHub ? hub.hubFieldValues : undefined
  });

  const fieldMutations = useTableMutations({
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

  // In Hub mode the writes go to the Data Hub instead of form field values.
  const {
    handleAddRow,
    handleInsertRow,
    handleDeleteRow,
    handleCellEdit,
    handleCellsEdit
  } = isHub
    ? {
        handleAddRow: hub.handleAddRow,
        handleInsertRow: hub.handleInsertRow,
        handleDeleteRow: hub.handleDeleteRow,
        handleCellEdit: hub.handleCellEdit,
        handleCellsEdit: hub.handleCellsEdit
      }
    : fieldMutations;

  /**
   * Adding a column only has a meaning for a data source that owns its own
   * schema — the columns of a field-backed table are designer-defined element
   * properties, and a Hub's are the Hub's own fields. The grid renders its add
   * affordance only when a source supplies this, so today it never appears.
   */
  const handleAddColumn: AddColumnHandler | undefined = undefined;

  const tableId = element?.id;

  const isSpreadsheet = wantsSpreadsheet;
  const canEdit = enableEditing && !isTransposed && !(isHub && hub.loading);
  const hubAllowsAddRows = !isHub || hub.canAddRows;
  const canAddRows = canEdit && enableAddDeleteRows && hubAllowsAddRows;
  // The spreadsheet has its own trailing "add row" strip and a row-header
  // context menu, so the toolbar button would be a second way to do the same
  // thing.
  const showAddRow = canAddRows && !isSpreadsheet;
  const canDeleteRows = canEdit && enableAddDeleteRows && hubAllowsAddRows;
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

  // Adding or deleting a row renumbers the rows below it. The spreadsheet's
  // undo history is keyed by row index, so it is dropped when this changes
  // rather than replayed onto the wrong rows.
  const [rowIdentityVersion, setRowIdentityVersion] = useState(0);
  const bumpRowIdentity = useCallback(
    () => setRowIdentityVersion((version) => version + 1),
    []
  );

  const wrappedHandleAddRow = useCallback(() => {
    setDeleteRowIndex(null);
    bumpRowIdentity();
    handleAddRow();
    // Hub mutations don't own search/pagination; mirror the field-mode UX so the
    // new row is visible (field mode does this inside useTableMutations).
    if (isHub) {
      if (searchQuery) setSearchQuery('');
      if (enablePagination) setCurrentPage(0);
    }
    setPendingAddRows((prev) => {
      const next = new Set<number>();
      next.add(0);
      prev.forEach((idx) => next.add(idx + 1));
      return next;
    });
  }, [
    handleAddRow,
    bumpRowIdentity,
    isHub,
    searchQuery,
    setSearchQuery,
    enablePagination,
    setCurrentPage
  ]);

  const wrappedHandleDeleteRow = useCallback(
    (rowIndex: number) => {
      bumpRowIdentity();
      handleDeleteRow(rowIndex);
      setDeleteRowIndex(null);
    },
    [bumpRowIdentity, handleDeleteRow]
  );

  const spreadsheetInsertRow = useCallback(
    (atIndex: number) => {
      setDeleteRowIndex(null);
      bumpRowIdentity();
      handleInsertRow(atIndex);
      // The row lands in the source data straight away, so every buffered edit
      // at or below it now belongs to a different row index.
      if (buffersEdits) pendingEdits.shiftForInsert(atIndex);
      // Hub mutations don't own search/pagination; mirror the field-mode UX so
      // the new row is visible.
      if (isHub && searchQuery) setSearchQuery('');
      setPendingAddRows((prev) => {
        const next = new Set<number>();
        next.add(atIndex);
        prev.forEach((idx) => next.add(idx >= atIndex ? idx + 1 : idx));
        return next;
      });
    },
    [
      handleInsertRow,
      bumpRowIdentity,
      isHub,
      searchQuery,
      setSearchQuery,
      buffersEdits,
      pendingEdits
    ]
  );

  /**
   * Removing a row is held back with the cell edits, so Discard puts it back
   * and one Save applies the whole set. Until then it is simply not rendered.
   */
  const spreadsheetDeleteRow = useCallback(
    (rowIndex: number) => {
      setDeleteRowIndex(null);
      if (!buffersEdits) {
        wrappedHandleDeleteRow(rowIndex);
        return;
      }
      // The row leaves the grid now, so index-keyed undo patches recorded
      // against it can no longer be replayed.
      bumpRowIdentity();
      pendingEdits.recordDelete(rowIndex);
    },
    [buffersEdits, pendingEdits, wrappedHandleDeleteRow, bumpRowIdentity]
  );

  const spreadsheetCellsEdit = useCallback(
    (writes: CellWrite[]) => {
      // A pending "provisional" row stops being provisional as soon as any of
      // its cells is written, the same rule single-cell editing follows.
      const touched = new Set(writes.map((write) => write.rowIndex));
      if (
        [...touched].some((rowIndex) => pendingAddRowsRef.current.has(rowIndex))
      ) {
        setPendingAddRows((prev) => {
          const next = new Set(prev);
          touched.forEach((rowIndex) => next.delete(rowIndex));
          return next;
        });
      }
      if (buffersEdits) pendingEdits.record(writes);
      else handleCellsEdit(writes);
    },
    [handleCellsEdit, buffersEdits, pendingEdits]
  );

  // Rows the user removed but has not saved are simply not rendered; the
  // source keeps them (and its row numbering) until the save applies them.
  const spreadsheetRowIndices = useMemo(
    () =>
      buffersEdits
        ? paginatedRowIndices.filter(
            (rowIndex: number) => !pendingEdits.isRowDeleted(rowIndex)
          )
        : paginatedRowIndices,
    [buffersEdits, paginatedRowIndices, pendingEdits]
  );

  // Buffered edits are layered over the stored values so the grid renders what
  // the user typed, not what the backend still holds.
  const spreadsheetFieldValues = useMemo(() => {
    if (!buffersEdits || !pendingEdits.writes.length) return activeFieldValues;
    const values = { ...activeFieldValues };
    // Each touched column's array is copied once, so several edits in one
    // column don't each rebuild it.
    const copied = new Set<string>();
    pendingEdits.writes.forEach(({ fieldKey, rowIndex, value }) => {
      if (!copied.has(fieldKey)) {
        const current = values[fieldKey];
        values[fieldKey] = Array.isArray(current) ? [...current] : [];
        copied.add(fieldKey);
      }
      values[fieldKey][rowIndex] = value;
    });
    return values;
  }, [activeFieldValues, buffersEdits, pendingEdits.writes]);

  /**
   * The column rules the spreadsheet validates against. A Hub owns its own
   * field schema; a field-backed table has only each column's form field type,
   * so it can check formats but not the field's own required/length settings —
   * those are enforced when the step is submitted.
   */
  const cellRules = useMemo(
    () => (isHub ? hub.cellRules : fieldCellRules(columns)),
    [isHub, hub.cellRules, columns]
  );

  /**
   * Every failing cell: the ones this client can see, plus any the backend
   * rejected. A live client-side result wins, because a server error describes
   * a write the user may already have corrected.
   */
  const cellErrors = useMemo<CellErrors>(() => {
    if (!isSpreadsheet) return {};
    const validated = validateGrid({
      rowIndices: spreadsheetRowIndices,
      fieldKeys: columns.map((column: any) => column.field_key),
      getValue: (rowIndex, fieldKey) => {
        const value = spreadsheetFieldValues[fieldKey];
        const cell = Array.isArray(value) ? value[rowIndex] : value;
        return cell === undefined ? null : cell;
      },
      rules: cellRules
    });
    return isHub ? { ...hub.cellErrors, ...validated } : validated;
  }, [
    isSpreadsheet,
    isHub,
    hub.cellErrors,
    spreadsheetRowIndices,
    spreadsheetFieldValues,
    columns,
    cellRules
  ]);

  /**
   * A staged Data Hub row is not held to the hub's field rules until it is
   * verified — correcting extracted data is the whole point of editing one —
   * so a bad value there is a warning the user can still save. Everywhere else
   * an error blocks the save, because the backend would reject it anyway.
   */
  const { blockingErrors, warningErrors } = useMemo(() => {
    const blocking: CellErrors = {};
    const warning: CellErrors = {};
    Object.entries(cellErrors).forEach(([key, message]) => {
      const rowIndex = Number(key.slice(0, key.indexOf(':')));
      const staged = isHub && hub.rowVerified[rowIndex] === false;
      (staged ? warning : blocking)[key] = message;
    });
    return { blockingErrors: blocking, warningErrors: warning };
  }, [cellErrors, isHub, hub.rowVerified]);

  /**
   * Feathery-controlled cell shading: what is wrong with a cell, and what is
   * waiting to be written. Errors win over warnings, and both win over the
   * unsaved tint, so the most urgent state is the one that shows.
   */
  const getCellShading = useMemo<GetCellShading | undefined>(() => {
    const hasIssues =
      Object.keys(blockingErrors).length > 0 ||
      Object.keys(warningErrors).length > 0;
    if (!hasIssues && !hasPendingEdits) return undefined;
    return ({ rowIndex, fieldKey }) => {
      const key = cellErrorKey(rowIndex, fieldKey);
      const blocking = blockingErrors[key];
      // Background only: an outline here competes with the selection border,
      // which is the one ring in the grid that means "you are here".
      if (blocking) {
        return {
          backgroundColor: validationColors.errorSurface,
          message: blocking,
          severity: 'error'
        };
      }
      const warning = warningErrors[key];
      if (warning) {
        return {
          backgroundColor: validationColors.warningSurface,
          message: warning,
          severity: 'warning'
        };
      }
      if (
        hasPendingEdits &&
        pendingEdits.peek(rowIndex, fieldKey) !== undefined
      ) {
        return { backgroundColor: validationColors.pendingSurface };
      }
      return null;
    };
  }, [blockingErrors, warningErrors, hasPendingEdits, pendingEdits]);

  const savingEdits = isHub && hub.saving;

  /**
   * Applies the buffer: the cell edits as one batch per row/column, then the
   * row deletions from the bottom up so each index is still valid when it is
   * applied.
   */
  const handleSaveEdits = useCallback(() => {
    const { writes, deletedRows } = pendingEdits;
    if (!writes.length && !deletedRows.length) return;
    pendingEdits.clear();
    if (writes.length) handleCellsEdit(writes);
    if (deletedRows.length) {
      bumpRowIdentity();
      deletedRows.forEach((rowIndex) => handleDeleteRow(rowIndex));
    }
  }, [pendingEdits, handleCellsEdit, handleDeleteRow, bumpRowIdentity]);

  const handleDiscardEdits = useCallback(() => {
    pendingEdits.discard();
  }, [pendingEdits]);

  /**
   * Buffered edits live only in this component, so anything that leaves the
   * step or the page loses them. The form-wide registry owns the prompting:
   * it guards Next/Back and browser history as well as a full page exit, and
   * keeps two dirty elements from queueing two dialogs.
   */
  const unsavedWorkId = `table:${tableId}`;
  useEffect(() => {
    setUnsavedWork(
      formId,
      unsavedWorkId,
      hasPendingEdits ? UNSAVED_TABLE_MESSAGE : null
    );
  }, [formId, unsavedWorkId, hasPendingEdits]);
  // A table unmounted mid-edit (a hidden step, a removed repeat) is no longer
  // holding anything the user can save, so it must stop blocking navigation.
  useEffect(
    () => () => clearUnsavedWork(formId, unsavedWorkId),
    [formId, unsavedWorkId]
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
        // The grid scrolls inside the container rather than the container
        // scrolling, so the sticky header and row gutter have a viewport to
        // stick to.
        ...(isSpreadsheet
          ? {
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflow: 'hidden'
            }
          : {}),
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
      {isHub && hub.errors.length > 0 && (
        <div role='alert' className={TABLE_CLASS.error} css={errorBannerStyle}>
          <ul>
            {hub.errors.map((error, index) => (
              <li key={`${error}-${index}`}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      {showEmptyState ? (
        <EmptyState hasSearchQuery={searchQuery.trim().length > 0} />
      ) : isSpreadsheet ? (
        <SpreadsheetTable
          columns={columns}
          rowIndices={spreadsheetRowIndices}
          fieldValues={spreadsheetFieldValues}
          canEdit={canEdit}
          heightUnit={element.styles?.height_unit}
          onCellsEdit={spreadsheetCellsEdit}
          onAddColumn={handleAddColumn}
          onInsertRow={canAddRows ? spreadsheetInsertRow : undefined}
          onDeleteRow={canDeleteRows ? spreadsheetDeleteRow : undefined}
          getCellShading={getCellShading}
          cellRules={cellRules}
          rowIdentityVersion={rowIdentityVersion}
          pending={
            buffersEdits
              ? {
                  count: pendingEdits.count,
                  saving: savingEdits,
                  onSave: handleSaveEdits,
                  onDiscard: handleDiscardEdits
                }
              : undefined
          }
          blockingErrors={blockingErrors}
          warningErrors={warningErrors}
        />
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
                            ...dataColumnMinWidthStyle,
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
