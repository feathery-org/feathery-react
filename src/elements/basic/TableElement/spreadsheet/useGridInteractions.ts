import React from 'react';
import { featheryDoc } from '../../../../utils/browser';
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
import type { SeedAction } from './fieldEditors';
import { choiceRows } from './ChoiceMenu';
import type { SpreadsheetTable } from './table';

/** Where the selection goes after a commit: an arrow direction, or along the Tab order. */
export type CommitMove = CellSelectionDirection | 'next' | 'prev';

export type EditingCell = {
  rowId: string;
  columnId: string;
  draft: string;
  /** The cell's value as text when the editor opened. */
  stored: string;
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
  onInsertRow?: (atIndex: number) => void;
  scrollToCell: (rowId: string, columnId: string) => void;
  /** Hands the keyboard back to the grid once a cell editor closes. */
  restoreFocus?: () => void;
  /**
   * What typing a character on a cell in this column should do. Decided by the
   * column, because the character is picked before an editor exists to filter
   * it — which is how a letter used to end up inside a number cell.
   */
  seedAction?: (fieldKey: string, char: string) => SeedAction;
  /**
   * A column the grid shows but must never write — a hub file field holds
   * upload references no editor can author. Enforced on every write path
   * (editor, paste, fill, clear), not only in the editor's input, because the
   * editor's `readOnly` attribute stops typing and nothing else.
   */
  isReadOnly?: (fieldKey: string) => boolean;
  /**
   * Text from an editor or the clipboard as the value the column stores.
   * Defaults to shape-based guessing; a column with a rule should decide by
   * type instead, so `007` in a text column stays `007`.
   */
  parseValue?: (fieldKey: string, text: string, before: CellValue) => CellValue;
  /**
   * The fixed values a column offers, when it has them. Such a column edits
   * through a menu the grid drives from the keyboard, so focus never leaves.
   */
  choicesFor?: (fieldKey: string) => string[] | null;
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
    onInsertRow,
    scrollToCell,
    restoreFocus,
    seedAction,
    isReadOnly,
    parseValue,
    choicesFor
  } = options;
  const [editing, setEditing] = React.useState<EditingCell | null>(null);
  const pendingChoice = React.useRef<{
    rowId: string;
    columnId: string;
  } | null>(null);
  const pendingRowFocus = React.useRef<{
    rowIndex: number;
    columnId: string;
  } | null>(null);

  // Insertion updates the source asynchronously with React's render. Select
  // only after the new row exists in the table's model.
  React.useEffect(() => {
    const pending = pendingRowFocus.current;
    if (!pending) return;
    const row = table
      .getRowsInDisplayOrder()
      .find((row) => rowIndexById.get(row.id) === pending.rowIndex);
    if (!row) return;
    pendingRowFocus.current = null;
    table.setFocusedCell(row.id, pending.columnId);
    scrollToCell(row.id, pending.columnId);
    restoreFocus?.();
  }, [restoreFocus, rowIndexById, scrollToCell, table]);

  const appendAfterLastRow = React.useCallback(
    (rowId: string, columnId: string) => {
      if (!canEdit || !onInsertRow) return false;
      if (pendingRowFocus.current) return true;
      if (table.getRowsInDisplayOrder().at(-1)?.id !== rowId) return false;
      const rowIndex = rowIndexById.get(rowId);
      if (rowIndex === undefined) return false;
      pendingRowFocus.current = { rowIndex: rowIndex + 1, columnId };
      onInsertRow(rowIndex + 1);
      return true;
    },
    [canEdit, onInsertRow, rowIndexById, table]
  );

  // A native choice commits and unmounts its select before Enter is released.
  // That release can reach the document before the grid regains focus. Keep
  // only this gesture: a later keydown or pointer gesture cancels the handoff.
  React.useEffect(() => {
    const doc = featheryDoc();
    const clear = () => {
      pendingChoice.current = null;
    };
    const release = (event: KeyboardEvent) => {
      const choice = pendingChoice.current;
      clear();
      if (!choice || !canEdit || event.key !== 'Enter') return;
      table.setFocusedCell(choice.rowId, choice.columnId);
      if (
        event.shiftKey ||
        !appendAfterLastRow(choice.rowId, choice.columnId)
      ) {
        table.moveCellSelection(event.shiftKey ? 'up' : 'down');
        const active = table.atoms.cellSelection.get().at(-1);
        if (active) scrollToCell(active.focusRowId, active.focusColumnId);
      }
      restoreFocus?.();
    };
    doc.addEventListener('keydown', clear, true);
    doc.addEventListener('pointerdown', clear, true);
    doc.addEventListener('keyup', release, true);
    return () => {
      doc.removeEventListener('keydown', clear, true);
      doc.removeEventListener('pointerdown', clear, true);
      doc.removeEventListener('keyup', release, true);
    };
  }, [appendAfterLastRow, canEdit, restoreFocus, scrollToCell, table]);

  const parse = React.useCallback(
    (fieldKey: string, text: string, before: CellValue): CellValue =>
      parseValue ? parseValue(fieldKey, text, before) : parseInputValue(text),
    [parseValue]
  );

  /** Drop the patches aimed at a column that cannot be written at all. */
  // Every bulk write (paste, fill, clear) goes through this and nothing else:
  // a value that breaks the column's rule still lands and is flagged, exactly
  // as a typed one is — an address missing its domain is on its way to being
  // valid, not something to throw away. Only a read-only column takes nothing.
  const writable = React.useCallback(
    (patches: CellPatch[]): CellPatch[] =>
      isReadOnly
        ? patches.filter((patch) => !isReadOnly(patch.fieldKey))
        : patches,
    [isReadOnly]
  );

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
    () => table.getAllLeafColumns(),
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

  /**
   * Tab order: along the row, then on to the next row's first cell (or back
   * to the previous row's last). False only past the grid's first or last
   * cell, where Tab is left to move focus out of the grid.
   */
  const moveTab = React.useCallback(
    (backwards: boolean): boolean => {
      const active = getActiveRange();
      if (!active) return false;
      const columns = getDisplayColumns();
      const rows = getDisplayRows();
      const columnIndex = columns.findIndex(
        (column) => column.id === active.focusColumnId
      );
      const rowIndex = rows.findIndex((row) => row.id === active.focusRowId);
      if (columnIndex < 0 || rowIndex < 0) return false;
      let nextColumn = columnIndex + (backwards ? -1 : 1);
      let nextRow = rowIndex;
      if (nextColumn >= columns.length) {
        nextColumn = 0;
        nextRow += 1;
      } else if (nextColumn < 0) {
        nextColumn = columns.length - 1;
        nextRow -= 1;
      }
      if (nextRow < 0 || nextRow >= rows.length) return false;
      table.setFocusedCell(rows[nextRow].id, columns[nextColumn].id);
      scrollToActiveCorner();
      return true;
    },
    [
      getActiveRange,
      getDisplayColumns,
      getDisplayRows,
      scrollToActiveCorner,
      table
    ]
  );

  const startEditing = React.useCallback(
    (rowId: string, columnId: string, replacement?: string) => {
      // No editor at all on a read-only column: the stored value may not even
      // be text (a file cell holds an array), and an editor that opened on its
      // String() form would commit that form back over the real value.
      if (!canEdit || isReadOnly?.(columnId)) return;
      table.setFocusedCell(rowId, columnId);
      const stored = formatCellValue(valueByIds(rowId, columnId));
      setEditing({
        rowId,
        columnId,
        draft: replacement ?? stored,
        stored,
        seeded: replacement !== undefined
      });
      scrollToCell(rowId, columnId);
    },
    [canEdit, isReadOnly, scrollToCell, table, valueByIds]
  );

  const startEditingActive = React.useCallback(() => {
    const active = getActiveRange();
    if (active) startEditing(active.anchorRowId, active.anchorColumnId);
  }, [getActiveRange, startEditing]);

  const enterActiveCell = React.useCallback(() => {
    const active = getActiveRange();
    if (active && appendAfterLastRow(active.focusRowId, active.focusColumnId))
      return;
    startEditingActive();
  }, [appendAfterLastRow, getActiveRange, startEditingActive]);

  const setEditingDraft = React.useCallback(
    (draft: string) =>
      setEditing((current) => (current ? { ...current, draft } : current)),
    []
  );

  const commitCellValue = React.useCallback(
    (rowId: string, columnId: string, draft: string, move?: CommitMove) => {
      const rowIndex = rowIndexById.get(rowId);
      const before = valueByIds(rowId, columnId);
      const after = parse(columnId, draft, before);
      if (
        rowIndex !== undefined &&
        !isReadOnly?.(columnId) &&
        !cellValuesEqual(before, after)
      ) {
        execute('Edit cell', [{ rowIndex, fieldKey: columnId, before, after }]);
      }

      table.setFocusedCell(rowId, columnId);
      setEditing(null);
      if (move === 'next' || move === 'prev') {
        moveTab(move === 'prev');
      } else if (
        move &&
        !(move === 'down' && appendAfterLastRow(rowId, columnId))
      ) {
        table.moveCellSelection(move);
        scrollToActiveCorner();
      }
      // The editor being unmounted was holding focus; without this the grid's
      // keys are bound to an element nothing is focused on any more.
      restoreFocus?.();
    },
    [
      appendAfterLastRow,
      execute,
      isReadOnly,
      moveTab,
      parse,
      restoreFocus,
      rowIndexById,
      scrollToActiveCorner,
      table,
      valueByIds
    ]
  );

  /**
   * Commit whatever the editor is holding. `draft` overrides the state copy for
   * an editor that decides its own value in one gesture — picking from a
   * dropdown sets and commits together, before React has applied the setState.
   */
  const commitEditing = React.useCallback(
    (move?: CommitMove, draft?: string) => {
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

  const commitChoice = React.useCallback(
    (draft: string) => {
      if (!editing) return;
      pendingChoice.current = {
        rowId: editing.rowId,
        columnId: editing.columnId
      };
      commitEditing(undefined, draft);
    },
    [commitEditing, editing]
  );

  const cancelEditing = React.useCallback(() => {
    setEditing(null);
    restoreFocus?.();
  }, [restoreFocus]);

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
        before: CellValue,
        fieldKey: string
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
              before,
              fieldKey
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
      writable(patchesForBounds(getSelectedBounds(), () => null))
    );
  }, [canEdit, execute, getSelectedBounds, patchesForBounds, writable]);

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
        const text = matrix[0][0] ?? '';
        execute(
          'Paste cells',
          writable(
            patchesForBounds([activeBound], (_row, _column, before, fieldKey) =>
              parse(fieldKey, text, before)
            )
          )
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
          const after = parse(fieldKey, cellText, before);
          if (!cellValuesEqual(before, after)) {
            patches.push({ rowIndex, fieldKey, before, after });
          }
        });
      });

      execute('Paste cells', writable(patches));
      selectBounds({
        minRowIndex: rowStart,
        maxRowIndex: maxRow,
        minColumnIndex: columnStart,
        maxColumnIndex: maxColumn
      });
    },
    [
      writable,
      canEdit,
      execute,
      getActiveRange,
      getDisplayColumns,
      getDisplayRows,
      getSelectedBounds,
      getValue,
      parse,
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

      execute('Fill cells', writable(patches));
      selectBounds(preview.expanded);
    },
    [
      writable,
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

      const active = getActiveRange();
      if (!active) return;

      const action = seedAction?.(active.anchorColumnId, event.key) ?? 'seed';
      if (action === 'ignore') {
        // Swallowed on purpose: the column cannot hold this character, so it
        // must not open an editor already containing it.
        event.preventDefault();
        return;
      }
      event.preventDefault();
      startEditing(
        active.anchorRowId,
        active.anchorColumnId,
        action === 'seed' ? event.key : undefined
      );
    },
    [canEdit, editing, getActiveRange, seedAction, startEditing]
  );

  /**
   * Tab walks the row like a spreadsheet, but it must still be a way OUT of
   * the grid: at the last column (or the first, going backwards) the key is
   * left to the browser, so a keyboard user can reach the rest of the form
   * instead of being trapped in the table.
   */
  const handleGridTabKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Tab' || editing) return;
      if (moveTab(event.shiftKey)) event.preventDefault();
    },
    [editing, moveTab]
  );

  /**
   * Keys while a choice menu is open. The grid holds focus, so they arrive
   * here: arrows move the highlight, Enter/Tab commit it (moving on like the
   * text editor does), Escape closes, a letter jumps to the first match.
   * Everything else is swallowed so nothing reaches the grid underneath.
   */
  const handleChoiceMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>): boolean => {
      if (!editing) return false;
      const choices = choicesFor?.(editing.columnId);
      if (!choices) return false;
      const rows = choiceRows(choices);
      const step = (delta: number) => {
        const at = rows.indexOf(editing.draft);
        const next =
          at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta));
        setEditingDraft(rows[next]);
      };
      switch (event.key) {
        case 'ArrowDown':
          step(1);
          break;
        case 'ArrowUp':
          step(-1);
          break;
        case 'Home':
          setEditingDraft(rows[0]);
          break;
        case 'End':
          setEditingDraft(rows[rows.length - 1]);
          break;
        case 'Enter':
          commitEditing(event.shiftKey ? 'up' : 'down');
          break;
        case 'Tab':
          commitEditing(event.shiftKey ? 'prev' : 'next');
          break;
        case 'Escape':
          cancelEditing();
          break;
        default: {
          if (event.metaKey || event.ctrlKey || event.altKey) return false;
          if (event.key.length !== 1) return false;
          const prefix = event.key.toLowerCase();
          const match = choices.find((choice) =>
            choice.toLowerCase().startsWith(prefix)
          );
          if (match) setEditingDraft(match);
        }
      }
      event.preventDefault();
      return true;
    },
    [cancelEditing, choicesFor, commitEditing, editing, setEditingDraft]
  );

  const handleGridKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (handleChoiceMenuKeyDown(event)) return;
      handleGridTabKey(event);
      if (!event.defaultPrevented) handleGridTextEntry(event);
    },
    [handleChoiceMenuKeyDown, handleGridTabKey, handleGridTextEntry]
  );

  /**
   * Collapses the selection onto one cell and brings it into view. DOM focus
   * is the caller's call: the issue stepper hands the keyboard back to the
   * grid afterwards, while find-in-grid keeps it in the search input.
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
        commitEditing(event.shiftKey ? 'prev' : 'next');
      }
    },
    [cancelEditing, commitEditing]
  );

  // One identity per set of callbacks: the grid keys document-level listener
  // effects on this object, and a fresh one per keystroke in an editor would
  // tear those listeners down and re-add them on every character.
  const isColumnReadOnly = React.useCallback(
    (fieldKey: string) => Boolean(isReadOnly?.(fieldKey)),
    [isReadOnly]
  );

  return React.useMemo(
    () => ({
      editing,
      setEditingDraft,
      isColumnReadOnly,
      getActiveRange,
      getSelectedBounds,
      startEditing,
      startEditingActive,
      enterActiveCell,
      focusCell,
      moveSelection,
      commitCellValue,
      commitEditing,
      commitChoice,
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
      handleGridKeyDown,
      handleEditorKeyDown,
      undo,
      redo
    }),
    [
      editing,
      setEditingDraft,
      isColumnReadOnly,
      getActiveRange,
      getSelectedBounds,
      startEditing,
      startEditingActive,
      enterActiveCell,
      focusCell,
      moveSelection,
      commitCellValue,
      commitEditing,
      commitChoice,
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
      handleGridKeyDown,
      handleEditorKeyDown,
      undo,
      redo
    ]
  );
}

export type GridInteractions = ReturnType<typeof useGridInteractions>;
export type { CellWrite };
