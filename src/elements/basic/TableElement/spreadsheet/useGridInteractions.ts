import React from 'react';
import type {
  CellSelectionBounds,
  CellSelectionDirection,
  CellSelectionRangeOperation,
  CellSelectionState
} from '@tanstack/react-table';
import { CellWrite } from '../types';
import {
  buildFillPatches,
  cellValuesEqual,
  CellPatch,
  CellValue,
  FillPreview,
  formatCellValue,
  GridBounds,
  parseInputValue,
  parseTsv,
  serializeTsv
} from './model';
import type { SpreadsheetTable } from './table';

export type EditingCell = {
  rowId: string;
  columnId: string;
  draft: string;
  /**
   * The editor was opened by typing, so `draft` is that first character rather
   * than the cell's stored value. The editor uses this to place the caret
   * after it instead of selecting it — selecting would let the next keystroke
   * replace it, which reads as the first letter going missing.
   */
  seeded: boolean;
};

type GridInteractionOptions = {
  table: SpreadsheetTable;
  /** Feathery row index for each TanStack row id. */
  rowIndexById: Map<string, number>;
  getValue: (rowIndex: number, fieldKey: string) => CellValue;
  /** Records the change for undo AND writes it through the source. */
  execute: (label: string, patches: CellPatch[]) => void;
  undo: () => void;
  redo: () => void;
  canEdit: boolean;
  scrollToCell: (rowId: string, columnId: string) => void;
};

export function useGridInteractions(options: GridInteractionOptions) {
  const {
    table,
    rowIndexById,
    getValue,
    execute,
    undo,
    redo,
    canEdit,
    scrollToCell
  } = options;
  const [editing, setEditing] = React.useState<EditingCell | null>(null);

  // A read-only table keeps selection and copy, so an editor left open when
  // editing is revoked has to close.
  React.useEffect(() => {
    if (!canEdit) setEditing(null);
  }, [canEdit]);

  const valueByIds = React.useCallback(
    (rowId: string, columnId: string): CellValue => {
      const rowIndex = rowIndexById.get(rowId);
      if (rowIndex === undefined) return null;
      return getValue(rowIndex, columnId);
    },
    [getValue, rowIndexById]
  );

  const getDisplayRows = React.useCallback(
    () => table.getRowsInDisplayOrder(),
    [table]
  );
  const getDisplayColumns = React.useCallback(
    () => [
      ...table.getStartVisibleLeafColumns(),
      ...table.getCenterVisibleLeafColumns(),
      ...table.getEndVisibleLeafColumns()
    ],
    [table]
  );

  const getActiveRange = React.useCallback(
    () => table.atoms.cellSelection.get().at(-1),
    [table]
  );

  const getSelectedBounds = React.useCallback(
    () => table.getCellSelectionBounds(),
    [table]
  );

  const scrollToActiveCorner = React.useCallback(() => {
    requestAnimationFrame(() => {
      const active = getActiveRange();
      if (active) scrollToCell(active.focusRowId, active.focusColumnId);
    });
  }, [getActiveRange, scrollToCell]);

  const moveSelection = React.useCallback(
    (direction: CellSelectionDirection, extend = false) => {
      if (extend) table.extendCellSelection(direction);
      else table.moveCellSelection(direction);
      scrollToActiveCorner();
    },
    [scrollToActiveCorner, table]
  );

  const startEditing = React.useCallback(
    (rowId: string, columnId: string, replacement?: string) => {
      if (!canEdit) return;
      table.setFocusedCell(rowId, columnId);
      setEditing({
        rowId,
        columnId,
        draft: replacement ?? formatCellValue(valueByIds(rowId, columnId)),
        seeded: replacement !== undefined
      });
      scrollToCell(rowId, columnId);
    },
    [canEdit, scrollToCell, table, valueByIds]
  );

  const startEditingActive = React.useCallback(() => {
    const active = getActiveRange();
    if (active) startEditing(active.anchorRowId, active.anchorColumnId);
  }, [getActiveRange, startEditing]);

  const setEditingDraft = React.useCallback(
    (draft: string) =>
      setEditing((current) => (current ? { ...current, draft } : current)),
    []
  );

  const commitCellValue = React.useCallback(
    (
      rowId: string,
      columnId: string,
      draft: string,
      move?: CellSelectionDirection
    ) => {
      const rowIndex = rowIndexById.get(rowId);
      const before = valueByIds(rowId, columnId);
      const after = parseInputValue(draft);
      if (rowIndex !== undefined && !cellValuesEqual(before, after)) {
        execute('Edit cell', [{ rowIndex, fieldKey: columnId, before, after }]);
      }

      table.setFocusedCell(rowId, columnId);
      setEditing(null);
      if (move) {
        table.moveCellSelection(move);
        scrollToActiveCorner();
      }
    },
    [execute, rowIndexById, scrollToActiveCorner, table, valueByIds]
  );

  /**
   * Commit whatever the editor is holding. `draft` overrides the state copy for
   * an editor that decides its own value in one gesture — picking from a
   * dropdown sets and commits together, before React has applied the setState.
   */
  const commitEditing = React.useCallback(
    (move?: CellSelectionDirection, draft?: string) => {
      if (!editing) return;
      commitCellValue(
        editing.rowId,
        editing.columnId,
        draft ?? editing.draft,
        move
      );
    },
    [commitCellValue, editing]
  );

  const cancelEditing = React.useCallback(() => setEditing(null), []);

  /**
   * Build the patches for every cell inside `bounds`. `getAfter` receives the
   * cell's offset within its bound so a paste can index into its matrix.
   */
  const patchesForBounds = React.useCallback(
    (
      bounds: ReadonlyArray<CellSelectionBounds>,
      getAfter: (
        rowOffset: number,
        columnOffset: number,
        before: CellValue
      ) => CellValue
    ): CellPatch[] => {
      const displayRows = getDisplayRows();
      const displayColumns = getDisplayColumns();
      // Ranges can overlap, so the last write for a cell wins rather than the
      // cell being patched twice.
      const patchesByCell = new Map<string, CellPatch>();

      for (const bound of bounds) {
        for (let row = bound.minRowIndex; row <= bound.maxRowIndex; row++) {
          const displayRow = displayRows.at(row);
          if (!displayRow) continue;
          const rowIndex = rowIndexById.get(displayRow.id);
          if (rowIndex === undefined) continue;

          for (
            let column = bound.minColumnIndex;
            column <= bound.maxColumnIndex;
            column++
          ) {
            const displayColumn = displayColumns.at(column);
            if (!displayColumn) continue;

            const fieldKey = displayColumn.id;
            const before = getValue(rowIndex, fieldKey);
            const after = getAfter(
              row - bound.minRowIndex,
              column - bound.minColumnIndex,
              before
            );
            if (cellValuesEqual(before, after)) continue;

            patchesByCell.set(`${rowIndex}\0${fieldKey}`, {
              rowIndex,
              fieldKey,
              before,
              after
            });
          }
        }
      }

      return [...patchesByCell.values()];
    },
    [getDisplayColumns, getDisplayRows, getValue, rowIndexById]
  );

  const clearSelection = React.useCallback(() => {
    if (!canEdit) return;
    execute(
      'Clear cells',
      patchesForBounds(getSelectedBounds(), () => null)
    );
  }, [canEdit, execute, getSelectedBounds, patchesForBounds]);

  const selectBounds = React.useCallback(
    (bounds: GridBounds) => {
      const displayRows = getDisplayRows();
      const displayColumns = getDisplayColumns();
      const anchorRow = displayRows.at(bounds.minRowIndex);
      const focusRow = displayRows.at(bounds.maxRowIndex);
      const anchorColumn = displayColumns.at(bounds.minColumnIndex);
      const focusColumn = displayColumns.at(bounds.maxColumnIndex);
      if (!anchorRow || !focusRow || !anchorColumn || !focusColumn) return;

      table.selectCellRange({
        anchorRowId: anchorRow.id,
        focusRowId: focusRow.id,
        anchorColumnId: anchorColumn.id,
        focusColumnId: focusColumn.id
      });
      scrollToCell(focusRow.id, focusColumn.id);
    },
    [getDisplayColumns, getDisplayRows, scrollToCell, table]
  );

  const selectedTsv = React.useCallback(
    () => serializeTsv(table.getSelectedCellRangesData() as CellValue[][][]),
    [table]
  );

  const copySelection = React.useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      const text = selectedTsv();
      if (!text) return;
      event.preventDefault();
      event.clipboardData.setData('text/plain', text);
    },
    [selectedTsv]
  );

  const cutSelection = React.useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      copySelection(event);
      clearSelection();
    },
    [clearSelection, copySelection]
  );

  const pasteText = React.useCallback(
    (text: string) => {
      if (!canEdit) return;
      const active = getActiveRange();
      if (!active) return;

      const matrix = parseTsv(text);
      const displayRows = getDisplayRows();
      const displayColumns = getDisplayColumns();
      const rowStart = displayRows.findIndex(
        (row) => row.id === active.anchorRowId
      );
      const columnStart = displayColumns.findIndex(
        (column) => column.id === active.anchorColumnId
      );
      if (rowStart < 0 || columnStart < 0) return;

      // Excel behaviour: one copied cell pasted over a multi-cell selection
      // fills that whole selection instead of writing a single cell.
      const activeBound = getSelectedBounds().at(-1);
      const fillsActiveRange =
        matrix.length === 1 &&
        matrix[0]?.length === 1 &&
        activeBound != null &&
        (activeBound.maxRowIndex > activeBound.minRowIndex ||
          activeBound.maxColumnIndex > activeBound.minColumnIndex);

      if (fillsActiveRange) {
        const after = parseInputValue(matrix[0][0] ?? '');
        execute(
          'Paste cells',
          patchesForBounds([activeBound], () => after)
        );
        return;
      }

      const patches: CellPatch[] = [];
      let maxRow = rowStart;
      let maxColumn = columnStart;

      matrix.forEach((matrixRow, rowOffset) => {
        const displayRow = displayRows.at(rowStart + rowOffset);
        if (!displayRow) return;
        const rowIndex = rowIndexById.get(displayRow.id);
        if (rowIndex === undefined) return;
        maxRow = rowStart + rowOffset;

        matrixRow.forEach((cellText, columnOffset) => {
          const displayColumn = displayColumns.at(columnStart + columnOffset);
          if (!displayColumn) return;
          maxColumn = Math.max(maxColumn, columnStart + columnOffset);

          const fieldKey = displayColumn.id;
          const before = getValue(rowIndex, fieldKey);
          const after = parseInputValue(cellText);
          if (!cellValuesEqual(before, after)) {
            patches.push({ rowIndex, fieldKey, before, after });
          }
        });
      });

      execute('Paste cells', patches);
      selectBounds({
        minRowIndex: rowStart,
        maxRowIndex: maxRow,
        minColumnIndex: columnStart,
        maxColumnIndex: maxColumn
      });
    },
    [
      canEdit,
      execute,
      getActiveRange,
      getDisplayColumns,
      getDisplayRows,
      getSelectedBounds,
      getValue,
      patchesForBounds,
      rowIndexById,
      selectBounds
    ]
  );

  const pasteSelection = React.useCallback(
    (event: React.ClipboardEvent<HTMLElement>) => {
      if (!getActiveRange()) return;
      event.preventDefault();
      pasteText(event.clipboardData.getData('text/plain'));
    },
    [getActiveRange, pasteText]
  );

  const applyFill = React.useCallback(
    (source: GridBounds, preview: FillPreview) => {
      if (!canEdit) return;
      const displayRows = getDisplayRows();
      const patches = buildFillPatches({
        source,
        preview,
        rowIndices: displayRows.map((row) => rowIndexById.get(row.id) ?? -1),
        fieldKeys: getDisplayColumns().map((column) => column.id),
        getValue
      });

      execute('Fill cells', patches);
      selectBounds(preview.expanded);
    },
    [
      canEdit,
      execute,
      getDisplayColumns,
      getDisplayRows,
      getValue,
      rowIndexById,
      selectBounds
    ]
  );

  const selectColumnRange = React.useCallback(
    (
      anchorColumnId: string,
      focusColumnId: string,
      baseSelection: CellSelectionState,
      operation: CellSelectionRangeOperation
    ) => {
      const displayRows = getDisplayRows();
      if (!displayRows.length) return;
      table.setCellSelection([
        ...baseSelection,
        {
          anchorRowId: displayRows[0].id,
          focusRowId: displayRows[displayRows.length - 1].id,
          anchorColumnId,
          focusColumnId,
          operation
        }
      ]);
    },
    [getDisplayRows, table]
  );

  const selectRowRange = React.useCallback(
    (
      anchorRowId: string,
      focusRowId: string,
      baseSelection: CellSelectionState,
      operation: CellSelectionRangeOperation
    ) => {
      const displayColumns = getDisplayColumns();
      if (!displayColumns.length) return;
      table.setCellSelection([
        ...baseSelection,
        {
          anchorRowId,
          focusRowId,
          anchorColumnId: displayColumns[0].id,
          focusColumnId: displayColumns[displayColumns.length - 1].id,
          operation
        }
      ]);
    },
    [getDisplayColumns, table]
  );

  /** Typing a printable character over a selected cell opens the editor. */
  const handleGridTextEntry = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (editing || !canEdit) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 || event.nativeEvent.isComposing) return;

      event.preventDefault();
      const active = getActiveRange();
      if (active) {
        startEditing(active.anchorRowId, active.anchorColumnId, event.key);
      }
    },
    [canEdit, editing, getActiveRange, startEditing]
  );

  /**
   * Collapses the selection onto one cell and brings it into view. Used to
   * walk the user through failing cells from the status bar, so it also takes
   * keyboard focus back to the grid — otherwise the next arrow key would still
   * go to the button that moved the selection.
   */
  const focusCell = React.useCallback(
    (rowId: string, columnId: string) => {
      setEditing(null);
      table.setFocusedCell(rowId, columnId);
      scrollToCell(rowId, columnId);
    },
    [scrollToCell, table]
  );

  // Typed against HTMLElement rather than HTMLInputElement: a column with a
  // fixed set of values edits through a <select>, and both share this handler.
  const handleEditorKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditing();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        commitEditing(event.shiftKey ? 'up' : 'down');
      } else if (event.key === 'Tab') {
        event.preventDefault();
        commitEditing(event.shiftKey ? 'left' : 'right');
      }
    },
    [cancelEditing, commitEditing]
  );

  return {
    editing,
    setEditingDraft,
    getActiveRange,
    getSelectedBounds,
    startEditing,
    startEditingActive,
    focusCell,
    moveSelection,
    commitCellValue,
    commitEditing,
    cancelEditing,
    clearSelection,
    copySelection,
    cutSelection,
    pasteSelection,
    applyFill,
    selectBounds,
    selectColumnRange,
    selectRowRange,
    handleGridTextEntry,
    handleEditorKeyDown,
    undo,
    redo
  };
}

export type GridInteractions = ReturnType<typeof useGridInteractions>;
export type { CellWrite };
