import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCreateAtom } from '@tanstack/react-store';
import { createColumnHelper, useTable } from '@tanstack/react-table';
import type { CellSelectionState } from '@tanstack/react-table';
import { AddColumnHandler, CellWrite, Column, GetCellShading } from '../types';
import { CellValue } from './model';
import { PendingChangesBar } from './PendingChangesBar';
import { SpreadsheetGrid, SpreadsheetGridHandle } from './SpreadsheetGrid';
import { CellErrors, cellErrorKey, CellRules } from './validation';
import {
  DEFAULT_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  PENDING_BAR_HEIGHT,
  spreadsheetViewportHeight
} from './styles';
import {
  spreadsheetFeatures,
  SpreadsheetRow,
  SpreadsheetTableState
} from './table';
import { useGridInteractions } from './useGridInteractions';
import { useSpreadsheetHistory } from './useSpreadsheetHistory';

const columnHelper = createColumnHelper<
  typeof spreadsheetFeatures,
  SpreadsheetRow
>();

export type SpreadsheetTableProps = {
  columns: Column[];
  /** Feathery row indices, already searched/sorted by `useTableData`. */
  rowIndices: number[];
  fieldValues: Record<string, any>;
  canEdit: boolean;
  /** 0-4 leading data rows pinned below the (always sticky) header. */
  frozenRows: number;
  /** 0-4 leading columns pinned beside the (always sticky) row numbers. */
  frozenColumns: number;
  /** `fit` lets the grid size to its rows, up to a cap. */
  heightUnit?: string;
  onCellsEdit: (writes: CellWrite[]) => void;
  /**
   * Supplied only by a data source that owns its own schema. No current source
   * does, so the grid's add-column affordance stays unrendered — the plumbing
   * exists so a future source can turn it on without reworking the grid.
   */
  onAddColumn?: AddColumnHandler;
  /** Supplied when the table allows adding rows. */
  onInsertRow?: (atIndex: number) => void;
  /** Supplied when the table allows deleting rows. */
  onDeleteRow?: (rowIndex: number) => void;
  getCellShading?: GetCellShading;
  /** Column rules, so each cell's editor matches what its column accepts. */
  cellRules?: CellRules;
  /**
   * Bumped by the parent whenever row indices shift (add/delete row), which
   * invalidates the index-keyed undo history.
   */
  rowIdentityVersion?: number;
  /**
   * Unsaved-work state for the bar above the grid. Omitted when the table
   * writes through on every edit, which leaves nothing to save or discard.
   */
  pending?: {
    count: number;
    saving: boolean;
    onSave: () => void;
    onDiscard: () => void;
  };
  /**
   * Failing cells keyed `${rowIndex}:${fieldKey}`, split by whether they stop
   * a save. Both are walked by the bar's stepper, blocking cells first.
   */
  blockingErrors?: CellErrors;
  warningErrors?: CellErrors;
};

export function SpreadsheetTable({
  columns,
  rowIndices,
  fieldValues,
  canEdit,
  frozenRows,
  frozenColumns,
  heightUnit,
  onCellsEdit,
  onAddColumn,
  onInsertRow,
  onDeleteRow,
  getCellShading,
  cellRules,
  rowIdentityVersion = 0,
  pending,
  blockingErrors,
  warningErrors
}: SpreadsheetTableProps) {
  const getValue = useCallback(
    (rowIndex: number, fieldKey: string): CellValue => {
      const value = fieldValues[fieldKey];
      const cell = Array.isArray(value) ? value[rowIndex] : value;
      return cell === undefined ? null : cell;
    },
    [fieldValues]
  );

  const rows = useMemo<SpreadsheetRow[]>(
    () =>
      rowIndices.map((rowIndex) => ({
        id: `r${rowIndex}`,
        rowIndex,
        cells: Object.fromEntries(
          columns.map((column) => [
            column.field_key,
            getValue(rowIndex, column.field_key)
          ])
        )
      })),
    [columns, getValue, rowIndices]
  );

  const rowIndexById = useMemo(
    () => new Map(rows.map((row) => [row.id, row.rowIndex])),
    [rows]
  );

  const tableColumns = useMemo(
    () =>
      columnHelper.columns(
        columns.map((column, index) =>
          columnHelper.accessor(
            (row) => row.cells[column.field_key] as unknown,
            {
              id: column.field_key,
              header: column.name,
              size: DEFAULT_COLUMN_WIDTH,
              minSize: MIN_COLUMN_WIDTH,
              meta: {
                fieldKey: column.field_key,
                name: column.name,
                index
              }
            }
          )
        )
      ),
    [columns]
  );

  const cellSelectionAtom = useCreateAtom<CellSelectionState>([]);

  const table = useTable(
    {
      key: 'feathery-spreadsheet',
      features: spreadsheetFeatures,
      columns: tableColumns,
      data: rows,
      atoms: { cellSelection: cellSelectionAtom },
      getRowId: (row) => row.id,
      enableCellSelection: true,
      // Rows re-derive on every field-value change; resetting the selection
      // then would clear it out from under the user mid-edit.
      autoResetCellSelection: false,
      columnResizeMode: 'onChange',
      keepPinnedRows: false
    },
    (state: SpreadsheetTableState) => ({
      columnPinning: state.columnPinning,
      columnResizing: state.columnResizing,
      columnSizing: state.columnSizing,
      rowPinning: state.rowPinning
    })
  );

  // Freeze the leading N rows/columns the builder asked for. Both effects are
  // no-ops once the pinned ids already match, so they do not loop.
  useEffect(() => {
    const desiredTop = rows.slice(0, frozenRows).map((row) => row.id);
    const current = table.state.rowPinning;
    if (!arraysEqual(current.top, desiredTop) || current.bottom.length) {
      table.setRowPinning({ top: desiredTop, bottom: [] });
    }
  }, [frozenRows, rows, table]);

  useEffect(() => {
    const desiredStart = table
      .getAllLeafColumns()
      .slice(0, frozenColumns)
      .map((column) => column.id);
    const current = table.state.columnPinning;
    if (!arraysEqual(current.start, desiredStart) || current.end.length) {
      table.setColumnPinning({ start: desiredStart, end: [] });
    }
  }, [frozenColumns, table, tableColumns]);

  const history = useSpreadsheetHistory(onCellsEdit);

  // Adding or deleting a row renumbers every row below it, so index-keyed
  // patches from before the change can no longer be replayed safely.
  const historyResetRef = useRef(history.reset);
  historyResetRef.current = history.reset;
  useEffect(() => {
    historyResetRef.current();
  }, [rowIdentityVersion]);

  const gridRef = useRef<SpreadsheetGridHandle>(null);
  const scrollToCell = useCallback(
    (rowId: string, columnId: string) =>
      gridRef.current?.scrollToCell(rowId, columnId),
    []
  );

  // Failing cells in reading order — down the rows, left to right — with the
  // blocking ones first, so stepping through issues fixes what is holding the
  // save back before it visits the advisory ones.
  const issues = useMemo(() => {
    if (!blockingErrors && !warningErrors) return [];
    const inOrder = (errors: CellErrors | undefined) =>
      errors && Object.keys(errors).length
        ? rows.flatMap((row) =>
            columns
              .filter((column) =>
                Boolean(errors[cellErrorKey(row.rowIndex, column.field_key)])
              )
              .map((column) => ({ rowId: row.id, columnId: column.field_key }))
          )
        : [];
    return [...inOrder(blockingErrors), ...inOrder(warningErrors)];
  }, [blockingErrors, warningErrors, rows, columns]);

  // Where the stepper is in `issues`. Reset whenever the set changes, so
  // fixing a cell restarts the walk rather than skipping the next one.
  const issueCursor = useRef(-1);
  const issueSignature = issues
    .map((i) => `${i.rowId}:${i.columnId}`)
    .join('|');
  const prevSignature = useRef(issueSignature);
  if (prevSignature.current !== issueSignature) {
    prevSignature.current = issueSignature;
    issueCursor.current = -1;
  }

  const interactions = useGridInteractions({
    table,
    rowIndexById,
    getValue,
    execute: history.execute,
    undo: history.undo,
    redo: history.redo,
    canEdit,
    scrollToCell
  });

  const stepIssue = useCallback(
    (delta: 1 | -1) => {
      if (!issues.length) return;
      const cursor = issueCursor.current;
      const next =
        cursor < 0
          ? delta > 0
            ? 0
            : issues.length - 1
          : (cursor + delta + issues.length) % issues.length;
      issueCursor.current = next;
      const issue = issues[next];
      interactions.focusCell(issue.rowId, issue.columnId);
      // The stepper button took focus on the click; the grid needs it back or
      // the next arrow key would step the button instead of the selection.
      gridRef.current?.focus();
    },
    [interactions, issues]
  );

  const blockingCount = Object.keys(blockingErrors ?? {}).length;
  const warningCount = Object.keys(warningErrors ?? {}).length;
  // The bar also stays up while a save is in flight, so the write has somewhere
  // to report from after the buffer it came from is already empty.
  const showBar = Boolean(
    pending &&
      (pending.count > 0 || pending.saving || blockingCount + warningCount > 0)
  );

  // The status bar sits inside the element's own height box, so an auto-sized
  // grid grows to make room for it rather than losing a row while it is up.
  const fitHeight = useMemo(() => {
    const base = spreadsheetViewportHeight(heightUnit, rows.length);
    if (base === undefined) return undefined;
    return base + (showBar ? PENDING_BAR_HEIGHT : 0);
  }, [heightUnit, rows.length, showBar]);

  return (
    <div
      css={{
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        minHeight: 0,
        ...(fitHeight ? { height: `${fitHeight}px` } : {})
      }}
    >
      {showBar && pending ? (
        <PendingChangesBar
          pendingCount={pending.count}
          blockingCount={blockingCount}
          warningCount={warningCount}
          saving={pending.saving}
          onSave={pending.onSave}
          onDiscard={pending.onDiscard}
          onStepIssue={stepIssue}
        />
      ) : null}
      <SpreadsheetGrid
        ref={gridRef}
        table={table}
        interactions={interactions}
        canEdit={canEdit}
        rowIndexById={rowIndexById}
        getCellShading={getCellShading}
        cellRules={cellRules}
        onAddColumn={onAddColumn}
        onInsertRow={onInsertRow}
        onDeleteRow={onDeleteRow}
      />
    </div>
  );
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
