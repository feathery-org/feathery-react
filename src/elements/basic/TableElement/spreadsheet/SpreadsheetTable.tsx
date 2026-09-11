import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useCreateAtom } from '@tanstack/react-store';
import { createColumnHelper, useTable } from '@tanstack/react-table';
import type { CellSelectionState } from '@tanstack/react-table';
import { AddColumnHandler, CellWrite, Column, GetCellShading } from '../types';
import { CellValue } from './model';
import {
  choicesFor,
  editorKindFor,
  parseCellInput,
  seedActionFor
} from './fieldEditors';
import { PendingChangesBar } from './PendingChangesBar';
import { SearchBar } from './SearchBar';
import type { SpreadsheetSort } from './HeaderMenu';
import { SpreadsheetGrid, SpreadsheetGridHandle } from './SpreadsheetGrid';
import { cellErrorKey, CellRules } from './validation';
import { CellIssues, countIssues, issueRank } from './issues';
import {
  DEFAULT_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  PENDING_BAR_HEIGHT,
  SEARCH_CURRENT_SHADING,
  SEARCH_MATCH_SHADING,
  spreadsheetViewportHeight
} from './styles';
import {
  spreadsheetFeatures,
  SpreadsheetRow,
  SpreadsheetTableState
} from './table';
import { useGridInteractions } from './useGridInteractions';
import { useGridSearch } from './useGridSearch';
import {
  SpreadsheetGeometryContext,
  useSpreadsheetGeometry
} from './useSpreadsheetGeometry';
import { useMeasured } from './useMeasured';
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
   * Failing cells keyed `${rowIndex}:${fieldKey}`, each with its severity and
   * whether it stops a save. The bar's stepper walks them blocking-first.
   */
  cellIssues?: CellIssues;
  /**
   * Columns the user cannot write to, on top of what the column's own rule
   * says (a file column is never typed into). Paste, fill and clear skip them.
   */
  readOnlyFieldKeys?: Set<string>;
  /** Column sort, offered from each header's right-click menu. */
  sort?: SpreadsheetSort;
};

export function SpreadsheetTable({
  columns,
  rowIndices,
  fieldValues,
  canEdit,
  heightUnit,
  onCellsEdit,
  onAddColumn,
  onInsertRow,
  onDeleteRow,
  getCellShading,
  cellRules,
  rowIdentityVersion = 0,
  pending,
  cellIssues,
  readOnlyFieldKeys,
  sort
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
      columnResizeMode: 'onChange'
    },
    (state: SpreadsheetTableState) => ({
      columnResizing: state.columnResizing,
      columnSizing: state.columnSizing
    })
  );

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
  const restoreFocus = useCallback(() => gridRef.current?.restoreFocus(), []);
  const seedAction = useCallback(
    (fieldKey: string, char: string) =>
      seedActionFor(cellRules?.[fieldKey], char),
    [cellRules]
  );
  const isReadOnly = useCallback(
    (fieldKey: string) =>
      Boolean(readOnlyFieldKeys?.has(fieldKey)) ||
      editorKindFor(cellRules?.[fieldKey]) === 'readonly',
    [cellRules, readOnlyFieldKeys]
  );
  const parseValue = useCallback(
    (fieldKey: string, text: string, before: CellValue) =>
      parseCellInput(text, cellRules?.[fieldKey], before),
    [cellRules]
  );
  const columnChoices = useCallback(
    (fieldKey: string) => choicesFor(cellRules?.[fieldKey]),
    [cellRules]
  );

  // Failing cells in reading order — down the rows, left to right — grouped
  // by how much they matter: what holds the save back first, then the other
  // rule breaks, then the advisory findings.
  const issues = useMemo(() => {
    if (!cellIssues || !Object.keys(cellIssues).length) return [];
    const ordered: { rank: number; rowId: string; columnId: string }[] = [];
    rows.forEach((row) =>
      columns.forEach((column) => {
        const issue = cellIssues[cellErrorKey(row.rowIndex, column.field_key)];
        if (issue) {
          ordered.push({
            rank: issueRank(issue),
            rowId: row.id,
            columnId: column.field_key
          });
        }
      })
    );
    // Stable sort keeps reading order inside each rank.
    return ordered
      .map((issue, index) => ({ ...issue, index }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map(({ rowId, columnId }) => ({ rowId, columnId }));
  }, [cellIssues, rows, columns]);

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
    onInsertRow,
    scrollToCell,
    restoreFocus,
    seedAction,
    isReadOnly,
    parseValue,
    choicesFor: columnChoices
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

  const search = useGridSearch({
    rows,
    columns,
    cellRules,
    focusCell: interactions.focusCell
  });

  // Search tint sits under any Feathery-controlled shading: a rejected value
  // stays red whether or not it also matches the query.
  const shadeCell = useCallback<GetCellShading>(
    (context) => {
      const base = getCellShading?.(context);
      if (base) return base;
      const state = search.matchState(context.rowIndex, context.fieldKey);
      if (state === 'current') return SEARCH_CURRENT_SHADING;
      if (state === 'match') return SEARCH_MATCH_SHADING;
      return null;
    },
    [getCellShading, search.matchState]
  );

  const closeSearch = useCallback(() => {
    search.close();
    // Escape in the find bar hands the keyboard back to the grid.
    gridRef.current?.focus();
  }, [search]);

  const counts = useMemo(() => countIssues(cellIssues ?? {}), [cellIssues]);
  const issueCount = counts.blocking + counts.errors + counts.warnings;
  // The bar also stays up while a save is in flight, so the write has somewhere
  // to report from after the buffer it came from is already empty.
  const showBar = Boolean(
    pending && (pending.count > 0 || pending.saving || issueCount > 0)
  );

  // The status bar and the horizontal scrollbar both sit inside the element's
  // height box, so an auto-sized grid grows by their measured heights.
  const containerRef = useRef<HTMLDivElement>(null);
  const geometry = useSpreadsheetGeometry(containerRef);
  const [scrollbarHeight, setScrollbarHeight] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const [barHeight, setBarHeight] = useState(PENDING_BAR_HEIGHT);
  const measureBar = useCallback(
    (bar: HTMLDivElement) =>
      setBarHeight(bar.offsetHeight || PENDING_BAR_HEIGHT),
    []
  );
  useMeasured(barRef, measureBar, showBar);
  const barSpace = showBar ? barHeight : 0;
  const fitHeight = useMemo(() => {
    const base = spreadsheetViewportHeight(
      heightUnit,
      rows.length,
      { addRow: Boolean(onInsertRow), scrollbarHeight },
      geometry
    );
    if (base === undefined) return undefined;
    return base + barSpace;
  }, [
    heightUnit,
    rows.length,
    onInsertRow,
    scrollbarHeight,
    barSpace,
    geometry
  ]);

  return (
    <SpreadsheetGeometryContext.Provider value={geometry}>
      <div
        ref={containerRef}
        style={
          {
            '--feathery-table-effective-row-height': `${geometry.rowHeight}px`,
            '--feathery-table-effective-header-height': `${geometry.headerHeight}px`
          } as React.CSSProperties
        }
        css={{
          position: 'relative',
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          minHeight: 0,
          ...(fitHeight ? { height: `${fitHeight}px` } : {})
        }}
      >
        {search.open && (
          <SearchBar
            query={search.query}
            onQueryChange={search.setQuery}
            matchCount={search.matches.length}
            cursor={search.cursor}
            onStep={search.step}
            onClose={closeSearch}
            focusToken={search.focusToken}
            top={barSpace + geometry.headerHeight + 8}
          />
        )}
        {showBar && pending ? (
          <div ref={barRef} css={{ flex: '0 0 auto' }}>
            <PendingChangesBar
              pendingCount={pending.count}
              blockingCount={counts.blocking}
              errorCount={counts.errors}
              warningCount={counts.warnings}
              saving={pending.saving}
              onSave={pending.onSave}
              onDiscard={pending.onDiscard}
              onStepIssue={stepIssue}
            />
          </div>
        ) : null}
        <SpreadsheetGrid
          ref={gridRef}
          table={table}
          interactions={interactions}
          canEdit={canEdit}
          rowIndexById={rowIndexById}
          getCellShading={shadeCell}
          cellRules={cellRules}
          onAddColumn={onAddColumn}
          onInsertRow={onInsertRow}
          onDeleteRow={onDeleteRow}
          onOpenSearch={search.openSearch}
          sort={sort}
          onScrollbarHeight={setScrollbarHeight}
        />
      </div>
    </SpreadsheetGeometryContext.Provider>
  );
}
