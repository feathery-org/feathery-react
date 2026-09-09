import React from 'react';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  CellSelectionBounds,
  CellSelectionRangeOperation,
  CellSelectionState
} from '@tanstack/react-table';
import type { ScrollToOptions, VirtualItem } from '@tanstack/react-virtual';
import { featheryDoc } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import { AddColumnHandler, CellShading, GetCellShading } from '../types';
import { CellValue, getFillPreview } from './model';
import { CellEditor } from './CellEditor';
import { CellErrorTooltip } from './CellErrorTooltip';
import { RowMenu, RowMenuTarget } from './RowMenu';
import { HeaderMenu, HeaderMenuTarget, SpreadsheetSort } from './HeaderMenu';
import { columnSortKey } from '../useTableData';
import { choicesFor, formatCellDisplay } from './fieldEditors';
import { CellRules } from './validation';
import type { FillPreview, GridBounds, GridCoordinate } from './model';
import {
  addRowStripLabelStyle,
  addRowStripStyle,
  canvasStyle,
  cellChipChevronStyle,
  cellChipInteractiveStyle,
  cellChipLabelStyle,
  cellChipStyle,
  cellFillPreviewStyle,
  cellZIndex,
  cellSelectedStyle,
  cellStyle,
  cellValueStyle,
  columnHeaderContentStyle,
  columnHeaderLabelStyle,
  columnHeaderStyle,
  columnResizerActiveStyle,
  columnResizerStyle,
  cornerHeaderStyle,
  cellEdgeVars,
  fillHandleStyle,
  gridExitHintStyle,
  gridStyle,
  headerRowStyle,
  headerSelectedStyle,
  rowHeaderStyle,
  rowFocusedStyle,
  rowRaisedStyle,
  rowStyle,
  sortIndicatorStyle,
  CELL_HORIZONTAL_PADDING,
  DEFAULT_COLUMN_WIDTH,
  FONT_SIZE,
  GRID_FONT_FAMILY,
  HEADER_FONT_SIZE,
  HEADER_FONT_WEIGHT,
  HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  ROW_HEIGHT,
  TOOLTIP_SCROLL_MARGIN
} from './styles';
import type {
  SpreadsheetTable,
  SpreadsheetTableCell,
  SpreadsheetTableColumn,
  SpreadsheetTableHeader,
  SpreadsheetTableRow
} from './table';
import type { GridInteractions } from './useGridInteractions';
import { useMeasured } from './useMeasured';

export type SpreadsheetGridHandle = {
  scrollToCell: (
    rowId: string,
    columnId?: string,
    scroll?: ScrollToOptions
  ) => void;
  /** Returns keyboard focus to the grid, e.g. after a control above it acts. */
  focus: () => void;
  /**
   * Takes focus back after a cell editor closes, but only if nothing else has
   * claimed it. Closing an editor unmounts the focused element, which drops
   * focus to `body` — and the grid's keys are bound to the grid element, so
   * arrows and Enter stop working until it is focused again. Clicking Save or
   * Discard also blurs the editor, so an unconditional grab would steal focus
   * straight back off the button the user just pressed.
   */
  restoreFocus: () => void;
  getVisibleRowIndexes: () => number[];
};

type SpreadsheetGridProps = {
  table: SpreadsheetTable;
  interactions: GridInteractions;
  canEdit: boolean;
  rowIndexById: Map<string, number>;
  getCellShading?: GetCellShading;
  /** Column rules, so a cell's editor matches what the column accepts. */
  cellRules?: CellRules;
  /**
   * Renders a trailing add-column header when supplied. No data source
   * provides one yet, so it is currently never rendered.
   */
  onAddColumn?: AddColumnHandler;
  /** Enables the row context menu's insert items and the trailing add strip. */
  onInsertRow?: (atIndex: number) => void;
  /** Enables the row context menu's delete item. */
  onDeleteRow?: (rowIndex: number) => void;
  /** Opens the find bar; bound to Mod+F while the grid has focus. */
  onOpenSearch?: () => void;
  /** Enables the column header's right-click sort menu. */
  sort?: SpreadsheetSort;
  /** Reports the horizontal scrollbar's height (0 when the columns fit). */
  onScrollbarHeight?: (height: number) => void;
};

type FillDrag = {
  source: GridBounds;
  preview: FillPreview | null;
};

type HeaderSelectionDrag = {
  axis: 'column' | 'row';
  anchorId: string;
  baseSelection: CellSelectionState;
  operation: CellSelectionRangeOperation;
};

export const SpreadsheetGrid = React.forwardRef<
  SpreadsheetGridHandle,
  SpreadsheetGridProps
>(function SpreadsheetGrid(
  {
    table,
    interactions,
    canEdit,
    rowIndexById,
    getCellShading,
    cellRules,
    onAddColumn,
    onInsertRow,
    onDeleteRow,
    onOpenSearch,
    sort,
    onScrollbarHeight
  },
  forwardedRef
) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  useHotkeys(
    [
      { hotkey: 'ArrowUp', callback: () => interactions.moveSelection('up') },
      {
        hotkey: 'ArrowDown',
        callback: () => interactions.moveSelection('down')
      },
      {
        hotkey: 'ArrowLeft',
        callback: () => interactions.moveSelection('left')
      },
      {
        hotkey: 'ArrowRight',
        callback: () => interactions.moveSelection('right')
      },
      {
        hotkey: 'Shift+ArrowUp',
        callback: () => interactions.moveSelection('up', true)
      },
      {
        hotkey: 'Shift+ArrowDown',
        callback: () => interactions.moveSelection('down', true)
      },
      {
        hotkey: 'Shift+ArrowLeft',
        callback: () => interactions.moveSelection('left', true)
      },
      {
        hotkey: 'Shift+ArrowRight',
        callback: () => interactions.moveSelection('right', true)
      },
      // Tab is not bound here: it moves the selection only while there is a
      // column to move to, and otherwise has to leave the grid — see
      // handleGridKeyDown.
      // Enter opens the editor, or appends a row at the bottom when adding is
      // enabled. Committing an editor with Enter also moves down into that row.
      { hotkey: 'Enter', callback: interactions.enterActiveCell },
      {
        hotkey: 'Shift+Enter',
        callback: () => interactions.moveSelection('up')
      },
      { hotkey: 'F2', callback: interactions.startEditingActive },
      { hotkey: 'Delete', callback: interactions.clearSelection },
      { hotkey: 'Backspace', callback: interactions.clearSelection },
      // The way out for keyboard users (Tab walks the rows): the first press
      // clears the selection, the next leaves the grid. Announced by the hint.
      {
        hotkey: 'Escape',
        callback: () => {
          if (table.getCellSelectionBounds().length) {
            table.resetCellSelection(true);
          } else if (scrollRef.current) {
            focusAfter(scrollRef.current);
          }
        }
      },
      { hotkey: 'Mod+A', callback: () => table.selectAllCells() },
      { hotkey: 'Mod+Z', callback: interactions.undo },
      { hotkey: 'Mod+Shift+Z', callback: interactions.redo },
      { hotkey: 'Mod+Y', callback: interactions.redo },
      { hotkey: 'Mod+F', callback: () => onOpenSearch?.() }
    ],
    {
      target: scrollRef,
      // While a cell editor is open the keys belong to the <input>.
      enabled: interactions.editing == null,
      preventDefault: true,
      stopPropagation: true
    }
  );

  const columns = table.getAllLeafColumns();
  const rows = table.getRowModel().rows;
  const columnSizing = table.state.columnSizing;
  const exitHintId = React.useId();

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => rows[index]?.id ?? index,
    estimateSize: () => ROW_HEIGHT,
    paddingStart: HEADER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    // Stop short of the bottom edge so a scrolled-to cell has room beneath it
    // for its message bubble, which hangs below the cell.
    scrollPaddingEnd: TOOLTIP_SCROLL_MARGIN,
    // A comfortable margin of rows beyond the viewport, so a fast scroll or
    // a find-jump lands on rows that are already painted.
    overscan: 16
  });

  const columnVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: columns.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => columns[index]?.id ?? index,
    estimateSize: (index) => getColumnSize(columns[index], columnSizing),
    horizontal: true,
    paddingStart: ROW_HEADER_WIDTH,
    scrollPaddingStart: ROW_HEADER_WIDTH,
    overscan: 3
  });

  // Resizing changes measured widths without changing the column count, which
  // the virtualizer would otherwise not re-measure for.
  React.useEffect(() => {
    columnVirtualizer.measure();
  }, [columnVirtualizer, columnSizing]);

  React.useImperativeHandle(
    forwardedRef,
    () => ({
      focus() {
        scrollRef.current?.focus({ preventScroll: true });
      },
      restoreFocus() {
        // Deferred so the check sees where focus actually landed once the
        // editor has unmounted — and a timeout rather than an animation frame,
        // because rAF does not run at all in a hidden tab, which would leave
        // the grid unfocusable for anyone who edits in a background tab.
        setTimeout(() => {
          const grid = scrollRef.current;
          if (!grid) return;
          const active = featheryDoc().activeElement;
          const lost = !active || active === featheryDoc().body;
          // Never off an editor. A click on cell B while cell A is open
          // commits A on mousedown and opens B on click, and on a fast click
          // or a trackpad tap this timeout fires only after B has focused
          // its control — pulling focus back to the grid would blur, and so
          // close, the editor the user just opened.
          const inEditor =
            !!active &&
            grid.contains(active) &&
            active.matches('input, select, textarea');
          if (inEditor) return;
          if (lost || grid.contains(active)) {
            grid.focus({ preventScroll: true });
          }
        }, 0);
      },
      scrollToCell(rowId, columnId, scroll) {
        const rowIndex = rows.findIndex((row) => row.id === rowId);
        const columnIndex = columns.findIndex(
          (column) => column.id === columnId
        );
        const [top] =
          (rowIndex >= 0 &&
            rowVirtualizer.getOffsetForIndex(rowIndex, scroll?.align)) ||
          [];
        const [left] =
          (columnIndex >= 0 &&
            columnVirtualizer.getOffsetForIndex(columnIndex)) ||
          [];
        // Both axes in one call since a second scrollTo cancels a smooth one, optional as jsdom lacks it
        scrollRef.current?.scrollTo?.({
          top,
          left,
          behavior: scroll?.behavior
        });
      },
      getVisibleRowIndexes() {
        const range = rowVirtualizer.range;
        return range
          ? rows
              .slice(range.startIndex, range.endIndex + 1)
              .map((row) => row.original.rowIndex)
          : [];
      }
    }),
    [columns, columnVirtualizer, rows, rowVirtualizer]
  );

  const measureScrollbar = React.useCallback(
    (grid: HTMLDivElement) =>
      onScrollbarHeight?.(Math.max(0, grid.offsetHeight - grid.clientHeight)),
    [onScrollbarHeight]
  );
  useMeasured(scrollRef, measureScrollbar, table.getTotalSize());

  const [fillPreview, setFillPreview] = React.useState<FillPreview | null>(
    null
  );
  const [rowMenu, setRowMenu] = React.useState<RowMenuTarget | null>(null);
  const closeRowMenu = React.useCallback(() => setRowMenu(null), []);
  const [headerMenu, setHeaderMenu] = React.useState<HeaderMenuTarget | null>(
    null
  );
  const closeHeaderMenu = React.useCallback(() => setHeaderMenu(null), []);
  const hasRowMenu = Boolean(onInsertRow || onDeleteRow);
  const fillDragRef = React.useRef<FillDrag | null>(null);
  const headerSelectionDragRef = React.useRef<HeaderSelectionDrag | null>(null);

  /** Map a pointer position to the grid cell under it. */
  const resolveCoordinate = React.useCallback(
    (clientX: number, clientY: number): GridCoordinate | null => {
      const element = scrollRef.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const localX = clamp(
        clientX - rect.left,
        ROW_HEADER_WIDTH + 1,
        rect.width - 1
      );
      const localY = clamp(
        clientY - rect.top,
        HEADER_HEIGHT + 1,
        rect.height - 1
      );

      const rowItem = rowVirtualizer.getVirtualItemForOffset(
        element.scrollTop + localY
      );
      const row = rowItem ? rows[rowItem.index] : undefined;

      const columnItem = columnVirtualizer.getVirtualItemForOffset(
        element.scrollLeft + localX
      );
      const column = columnItem ? columns[columnItem.index] : undefined;

      if (!row || !column) return null;
      const columnIndex =
        table.getCellSelectionColumnIndexes()[column.id] ?? -1;
      const rowIndex = row.getDisplayIndex();
      if (rowIndex < 0 || columnIndex < 0) return null;
      return { rowIndex, columnIndex };
    },
    [columns, columnVirtualizer, rows, rowVirtualizer, table]
  );

  const applyHeaderSelectionDrag = React.useCallback(
    (drag: HeaderSelectionDrag, focusId: string) => {
      if (drag.axis === 'column') {
        interactions.selectColumnRange(
          drag.anchorId,
          focusId,
          drag.baseSelection,
          drag.operation
        );
      } else {
        interactions.selectRowRange(
          drag.anchorId,
          focusId,
          drag.baseSelection,
          drag.operation
        );
      }
    },
    [interactions]
  );

  const updateDragTarget = React.useCallback(
    (event: MouseEvent) => {
      const coordinate = resolveCoordinate(event.clientX, event.clientY);
      if (!coordinate) return;

      const fillDrag = fillDragRef.current;
      if (fillDrag) {
        const preview = getFillPreview(fillDrag.source, coordinate);
        fillDrag.preview = preview;
        setFillPreview(preview);
        return;
      }

      const headerDrag = headerSelectionDragRef.current;
      if (headerDrag) {
        const focusId =
          headerDrag.axis === 'column'
            ? columns[coordinate.columnIndex]?.id
            : table.getRowsInDisplayOrder()[coordinate.rowIndex]?.id;
        if (focusId) applyHeaderSelectionDrag(headerDrag, focusId);
        return;
      }

      if (!table._isSelectingCells) return;
      const row = table.getRowsInDisplayOrder()[coordinate.rowIndex];
      const column = columns[coordinate.columnIndex];
      if (!row || !column) return;
      row.getAllCellsByColumnId()[column.id]?.getSelectionExtendHandler()(
        event
      );
    },
    [applyHeaderSelectionDrag, columns, resolveCoordinate, table]
  );

  React.useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (
        fillDragRef.current ||
        headerSelectionDragRef.current ||
        table._isSelectingCells
      ) {
        updateDragTarget(event);
      }
    };

    const handleMouseUp = () => {
      const fillDrag = fillDragRef.current;
      if (fillDrag?.preview) {
        interactions.applyFill(fillDrag.source, fillDrag.preview);
      }
      fillDragRef.current = null;
      headerSelectionDragRef.current = null;
      setFillPreview(null);
    };

    // Listen on the document, not the grid: a drag that leaves the grid still
    // has to keep extending, and its mouseup must still end the drag.
    const doc = featheryDoc();
    doc.addEventListener('mousemove', handleMouseMove);
    doc.addEventListener('mouseup', handleMouseUp);
    return () => {
      doc.removeEventListener('mousemove', handleMouseMove);
      doc.removeEventListener('mouseup', handleMouseUp);
    };
  }, [interactions, table, updateDragTarget]);

  const startHeaderSelection = React.useCallback(
    (
      event: React.MouseEvent<HTMLElement>,
      axis: HeaderSelectionDrag['axis'],
      id: string,
      fullySelected: boolean
    ) => {
      if (event.button !== 0) return;
      event.preventDefault();
      scrollRef.current?.focus({ preventScroll: true });

      const currentSelection = table.atoms.cellSelection.get();
      const activeRange = currentSelection.at(-1);
      let anchorId = id;
      let baseSelection: CellSelectionState = [];
      let operation: CellSelectionRangeOperation = 'include';

      if (event.shiftKey && activeRange) {
        // Shift extends from the existing anchor, replacing the active range.
        anchorId =
          axis === 'column'
            ? activeRange.anchorColumnId
            : activeRange.anchorRowId;
        baseSelection = currentSelection.slice(0, -1);
        operation = activeRange.operation ?? 'include';
      } else if (event.metaKey || event.ctrlKey) {
        // Cmd/Ctrl adds a range, or subtracts one already fully selected.
        baseSelection = currentSelection;
        operation = fullySelected ? 'exclude' : 'include';
      }

      const drag = { axis, anchorId, baseSelection, operation };
      headerSelectionDragRef.current = drag;
      applyHeaderSelectionDrag(drag, id);
    },
    [applyHeaderSelectionDrag, table]
  );

  const extendHeaderSelection = React.useCallback(
    (axis: HeaderSelectionDrag['axis'], id: string) => {
      const drag = headerSelectionDragRef.current;
      if (drag?.axis === axis) applyHeaderSelectionDrag(drag, id);
    },
    [applyHeaderSelectionDrag]
  );

  const startFillDrag = React.useCallback(
    (event: React.MouseEvent, source: GridBounds) => {
      event.preventDefault();
      event.stopPropagation();
      scrollRef.current?.focus({ preventScroll: true });
      fillDragRef.current = { source, preview: null };
      setFillPreview(null);
    },
    []
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();

  // An editor whose cell scrolls out of the virtual window unmounts with no
  // blur or cancel, leaving the grid stuck in editing. Cancel it once the cell
  // has been rendered and then dropped (never before it has scrolled into view).
  const editing = interactions.editing;
  const editingKey = editing ? `${editing.rowId}\0${editing.columnId}` : null;
  const editingRendered =
    editing != null &&
    virtualRows.some((item) => rows[item.index]?.id === editing.rowId) &&
    virtualColumns.some((item) => columns[item.index]?.id === editing.columnId);
  const renderedEditorKey = React.useRef<string | null>(null);
  if (editingRendered) renderedEditorKey.current = editingKey;
  React.useEffect(() => {
    if (!editingKey || editingRendered) return;
    if (renderedEditorKey.current === editingKey) interactions.cancelEditing();
  }, [editingKey, editingRendered, interactions]);
  const canvasWidth = columnVirtualizer.getTotalSize();
  const rowsHeight = rowVirtualizer.getTotalSize();
  // No trailing gutter: a bubble on one of the last rows flips above the cell
  // instead (CellErrorTooltip measures against the grid's visible box), so
  // the canvas ends at the last row and nothing blank scrolls into view.
  const canvasHeight = rowsHeight + (onInsertRow ? ROW_HEIGHT : 0);

  return (
    <>
      <div
        ref={scrollRef}
        className={TABLE_CLASS.grid}
        role='grid'
        tabIndex={0}
        aria-describedby={exitHintId}
        aria-rowcount={table.getRowsInDisplayOrder().length + 1}
        aria-colcount={columns.length}
        aria-readonly={!canEdit || undefined}
        css={gridStyle}
        onKeyDown={interactions.handleGridKeyDown}
        onCopy={interactions.copySelection}
        onCut={interactions.cutSelection}
        onPaste={interactions.pasteSelection}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.currentTarget.focus({ preventScroll: true });
          }
        }}
      >
        <div css={{ ...canvasStyle, width: canvasWidth, height: canvasHeight }}>
          <table.Subscribe
            source={table.atoms.cellSelection}
            selector={() => table.getCellSelectionBounds()}
          >
            {(selectionBounds) => (
              <HeaderRow
                table={table}
                columnSizing={columnSizing}
                resizingColumnId={table.state.columnResizing.isResizingColumn}
                selectionBounds={selectionBounds}
                virtualColumns={virtualColumns}
                headers={table.getLeafHeaders()}
                onStartSelection={startHeaderSelection}
                onExtendSelection={extendHeaderSelection}
                onAddColumn={onAddColumn}
                sort={sort}
                onOpenHeaderMenu={sort ? setHeaderMenu : undefined}
              />
            )}
          </table.Subscribe>

          {virtualRows.map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;
            return (
              <SubscribedRow
                key={row.id}
                row={row}
                top={virtualRow.start}
                table={table}
                columnSizing={columnSizing}
                virtualColumns={virtualColumns}
                interactions={interactions}
                canEdit={canEdit}
                rowIndexById={rowIndexById}
                getCellShading={getCellShading}
                cellRules={cellRules}
                fillPreview={fillPreview}
                onStartHeaderSelection={startHeaderSelection}
                onExtendHeaderSelection={extendHeaderSelection}
                onOpenRowMenu={hasRowMenu ? setRowMenu : undefined}
                onStartFill={startFillDrag}
              />
            );
          })}

          {onInsertRow ? (
            <button
              type='button'
              className={TABLE_CLASS.gridAddRow}
              css={{
                ...addRowStripStyle,
                transform: `translateY(${rowsHeight}px)`
              }}
              onClick={() => onInsertRow(table.getRowsInDisplayOrder().length)}
            >
              <span css={addRowStripLabelStyle}>+ Add row</span>
            </button>
          ) : null}
        </div>
      </div>
      <div
        id={exitHintId}
        className={TABLE_CLASS.gridExitHint}
        css={gridExitHintStyle}
      >
        Press Escape to clear the selection, and again to leave the table.
      </div>
      {headerMenu && sort ? (
        <HeaderMenu target={headerMenu} sort={sort} onClose={closeHeaderMenu} />
      ) : null}
      {rowMenu ? (
        <RowMenu
          target={rowMenu}
          canInsert={Boolean(onInsertRow)}
          canDelete={Boolean(onDeleteRow)}
          onInsertAbove={() => onInsertRow?.(rowMenu.rowIndex)}
          onInsertBelow={() => onInsertRow?.(rowMenu.rowIndex + 1)}
          onDelete={() => onDeleteRow?.(rowMenu.rowIndex)}
          onClose={closeRowMenu}
        />
      ) : null}
    </>
  );
});

type HeaderRowProps = {
  table: SpreadsheetTable;
  columnSizing: SpreadsheetTable['state']['columnSizing'];
  resizingColumnId: false | string;
  selectionBounds: CellSelectionBounds[];
  virtualColumns: VirtualItem[];
  headers: SpreadsheetTableHeader[];
  onStartSelection: (
    event: React.MouseEvent<HTMLElement>,
    axis: 'column',
    id: string,
    fullySelected: boolean
  ) => void;
  onExtendSelection: (axis: 'column', id: string) => void;
  onAddColumn?: AddColumnHandler;
  sort?: SpreadsheetSort;
  onOpenHeaderMenu?: (target: HeaderMenuTarget) => void;
};

function HeaderRow({
  table,
  columnSizing,
  resizingColumnId,
  selectionBounds,
  virtualColumns,
  headers,
  onStartSelection,
  onExtendSelection,
  onAddColumn,
  sort,
  onOpenHeaderMenu
}: HeaderRowProps) {
  const rowCount = table.getRowsInDisplayOrder().length;
  const shared = {
    table,
    bounds: selectionBounds,
    columnSizing,
    resizingColumnId,
    rowCount,
    onStartSelection,
    onExtendSelection,
    sort,
    onOpenHeaderMenu
  };

  return (
    <div className={TABLE_CLASS.gridHeader} role='row' css={headerRowStyle}>
      <button
        type='button'
        className={TABLE_CLASS.gridCornerHeader}
        aria-label='Select all cells'
        css={cornerHeaderStyle}
        onClick={() => table.selectAllCells()}
      />
      {virtualColumns.map((virtualColumn) => {
        const header = headers[virtualColumn.index];
        if (!header) return null;
        return (
          <HeaderCell
            key={header.id}
            header={header}
            left={virtualColumn.start}
            {...shared}
          />
        );
      })}
      {onAddColumn ? (
        <button
          type='button'
          aria-label='Add column'
          css={{
            ...columnHeaderStyle,
            left: table.getTotalSize() + ROW_HEADER_WIDTH,
            width: HEADER_HEIGHT,
            cursor: 'pointer'
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onAddColumn()}
        >
          +
        </button>
      ) : null}
    </div>
  );
}

type HeaderCellProps = {
  header: SpreadsheetTableHeader;
  table: SpreadsheetTable;
  bounds: CellSelectionBounds[];
  columnSizing: SpreadsheetTable['state']['columnSizing'];
  resizingColumnId: false | string;
  rowCount: number;
  onStartSelection: HeaderRowProps['onStartSelection'];
  onExtendSelection: HeaderRowProps['onExtendSelection'];
  left: number;
  sort?: SpreadsheetSort;
  onOpenHeaderMenu?: (target: HeaderMenuTarget) => void;
};

function HeaderCell({
  header,
  table,
  bounds,
  columnSizing,
  resizingColumnId,
  rowCount,
  onStartSelection,
  onExtendSelection,
  left,
  sort,
  onOpenHeaderMenu
}: HeaderCellProps) {
  const { column } = header;
  const columnIndex = table.getCellSelectionColumnIndexes()[column.id] ?? -1;
  const inSelection = bounds.some(
    (bound) =>
      columnIndex >= bound.minColumnIndex && columnIndex <= bound.maxColumnIndex
  );
  const fullySelected =
    inSelection &&
    bounds.some(
      (bound) =>
        bound.minRowIndex === 0 &&
        bound.maxRowIndex === rowCount - 1 &&
        columnIndex >= bound.minColumnIndex &&
        columnIndex <= bound.maxColumnIndex
    );
  const meta = column.columnDef.meta;
  const label = meta?.name ?? column.id;
  const sortKey = columnSortKey(column.id, meta?.index ?? columnIndex);
  const sortedHere = sort?.column === sortKey ? sort.direction : null;

  return (
    <div
      className={TABLE_CLASS.gridHeaderCell}
      role='columnheader'
      aria-colindex={columnIndex + 1}
      aria-selected={fullySelected}
      title={label}
      css={{
        ...columnHeaderStyle,
        ...getColumnPositionStyle(column, columnSizing, left),
        ...(fullySelected ? headerSelectedStyle : {})
      }}
      onMouseDown={(event) =>
        onStartSelection(event, 'column', column.id, fullySelected)
      }
      onMouseEnter={() => onExtendSelection('column', column.id)}
      onContextMenu={(event) => {
        if (!onOpenHeaderMenu) return;
        event.preventDefault();
        onOpenHeaderMenu({
          sortKey,
          name: label,
          x: event.clientX,
          y: event.clientY
        });
      }}
      aria-sort={
        sortedHere
          ? sortedHere === 'asc'
            ? 'ascending'
            : 'descending'
          : undefined
      }
    >
      <span css={columnHeaderContentStyle}>
        <span
          css={{
            ...columnHeaderLabelStyle,
            ...(fullySelected ? { color: 'inherit' } : {})
          }}
        >
          {label}
        </span>
        {sortedHere ? (
          // A flex sibling of the label, so the label truncates and the
          // arrow never does.
          <span
            className={TABLE_CLASS.gridSortIndicator}
            aria-hidden='true'
            css={sortIndicatorStyle}
          >
            {sortedHere === 'asc' ? '▲' : '▼'}
          </span>
        ) : null}
      </span>
      <div
        className={TABLE_CLASS.gridColumnResizer}
        role='separator'
        aria-label={`Resize column ${label}`}
        aria-orientation='vertical'
        css={{
          ...columnResizerStyle,
          ...(resizingColumnId === column.id ? columnResizerActiveStyle : {})
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
          header.getResizeHandler()(event);
        }}
        onTouchStart={(event) => {
          event.stopPropagation();
          header.getResizeHandler()(event);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          table.setColumnSizing((current) => ({
            ...current,
            [column.id]: getAutoFitColumnWidth(table, column)
          }));
        }}
      />
    </div>
  );
}

/**
 * A dropdown cell's value as a pill with a chevron, like a sheet's validation
 * list. Not focusable (the grid opens the menu); a button only when it can open.
 */
function DropdownChip({
  text,
  label,
  interactive,
  onOpen
}: {
  text: string;
  label: string;
  /** Whether a click opens the menu; a read-only cell's chip is only a value. */
  interactive: boolean;
  onOpen: (event: React.MouseEvent) => void;
}) {
  return (
    <span
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? label : undefined}
      className={TABLE_CLASS.gridCellChip}
      css={{
        ...cellChipStyle,
        ...(interactive ? cellChipInteractiveStyle : {})
      }}
      onClick={interactive ? onOpen : undefined}
    >
      <span css={cellChipLabelStyle}>{text}</span>
      <span aria-hidden css={cellChipChevronStyle} />
    </span>
  );
}

type RowSelectionSnapshot = {
  activeBound?: CellSelectionBounds;
  focusedColumnId?: string;
  fullySelected: boolean;
  inSelection: boolean;
  key: string;
};

type SubscribedRowProps = {
  row: SpreadsheetTableRow;
  top: number;
  table: SpreadsheetTable;
  columnSizing: SpreadsheetTable['state']['columnSizing'];
  virtualColumns: VirtualItem[];
  interactions: GridInteractions;
  canEdit: boolean;
  rowIndexById: Map<string, number>;
  getCellShading?: GetCellShading;
  cellRules?: CellRules;
  fillPreview: FillPreview | null;
  onStartHeaderSelection: (
    event: React.MouseEvent<HTMLElement>,
    axis: 'row',
    id: string,
    fullySelected: boolean
  ) => void;
  onExtendHeaderSelection: (axis: 'row', id: string) => void;
  onOpenRowMenu?: (target: RowMenuTarget) => void;
  onStartFill: (event: React.MouseEvent, source: GridBounds) => void;
};

/**
 * Subscribes each row to the selection atom on its own, so dragging a range
 * re-renders only the rows the range actually touches instead of the grid.
 */
function SubscribedRow(props: SubscribedRowProps) {
  const { row, table } = props;
  return (
    <table.Subscribe
      source={table.atoms.cellSelection}
      selector={(ranges) => {
        const bounds = table.getCellSelectionBounds();
        const rowIndex = row.getDisplayIndex();
        const activeRange = ranges.at(-1);
        const activeBound = bounds.at(-1);
        const columnCount = table.getAllLeafColumns().length;

        return {
          // Only the row holding the range's bottom edge draws a fill handle.
          activeBound:
            activeBound?.maxRowIndex === rowIndex ? activeBound : undefined,
          focusedColumnId:
            activeRange?.anchorRowId === row.id
              ? activeRange.anchorColumnId
              : undefined,
          fullySelected: bounds.some(
            (bound) =>
              bound.minColumnIndex === 0 &&
              bound.maxColumnIndex === columnCount - 1 &&
              rowIndex >= bound.minRowIndex &&
              rowIndex <= bound.maxRowIndex
          ),
          inSelection: bounds.some(
            (bound) =>
              rowIndex >= bound.minRowIndex && rowIndex <= bound.maxRowIndex
          ),
          key: rowSelectionKey(ranges, bounds, rowIndex, row.id)
        };
      }}
    >
      {(selection: RowSelectionSnapshot) => (
        <SpreadsheetRowView {...props} selection={selection} />
      )}
    </table.Subscribe>
  );
}

function SpreadsheetRowView({
  row,
  top,
  table,
  columnSizing,
  virtualColumns,
  interactions,
  canEdit,
  rowIndexById,
  getCellShading,
  cellRules,
  fillPreview,
  onStartHeaderSelection,
  onExtendHeaderSelection,
  onOpenRowMenu,
  onStartFill,
  selection
}: SubscribedRowProps & { selection: RowSelectionSnapshot }) {
  const rowIndex = row.getDisplayIndex();
  const cells = row.getAllCells();

  const shared = {
    rowIndex,
    selection,
    fillPreview,
    table,
    columnSizing,
    interactions,
    canEdit,
    rowIndexById,
    getCellShading,
    cellRules,
    onStartFill
  };

  return (
    <div
      className={TABLE_CLASS.gridRow}
      role='row'
      aria-rowindex={rowIndex + 2}
      css={{
        ...rowStyle,
        ...(selection.focusedColumnId
          ? rowFocusedStyle
          : selection.inSelection
          ? rowRaisedStyle
          : {}),
        height: ROW_HEIGHT,
        transform: `translateY(${top}px)`
      }}
    >
      <button
        type='button'
        className={TABLE_CLASS.gridRowNumber}
        aria-label={`Select row ${rowIndex + 1}`}
        aria-selected={selection.fullySelected}
        css={{
          ...rowHeaderStyle,
          ...(selection.fullySelected ? headerSelectedStyle : {})
        }}
        onMouseDown={(event) =>
          onStartHeaderSelection(event, 'row', row.id, selection.fullySelected)
        }
        onMouseEnter={() => onExtendHeaderSelection('row', row.id)}
        onContextMenu={(event) => {
          if (!onOpenRowMenu) return;
          event.preventDefault();
          onOpenRowMenu({
            rowIndex: rowIndexById.get(row.id) ?? rowIndex,
            displayNumber: rowIndex + 1,
            x: event.clientX,
            y: event.clientY
          });
        }}
      >
        {rowIndex + 1}
      </button>
      {virtualColumns.map((virtualColumn) => {
        const cell = cells[virtualColumn.index];
        if (!cell) return null;
        return (
          <SpreadsheetCell
            key={cell.id}
            cell={cell}
            left={virtualColumn.start}
            {...shared}
          />
        );
      })}
    </div>
  );
}

type SpreadsheetCellProps = {
  cell: SpreadsheetTableCell;
  rowIndex: number;
  selection: RowSelectionSnapshot;
  fillPreview: FillPreview | null;
  table: SpreadsheetTable;
  columnSizing: SpreadsheetTable['state']['columnSizing'];
  interactions: GridInteractions;
  canEdit: boolean;
  rowIndexById: Map<string, number>;
  getCellShading?: GetCellShading;
  cellRules?: CellRules;
  left: number;
  onStartFill: (event: React.MouseEvent, source: GridBounds) => void;
};

function SpreadsheetCell({
  cell,
  rowIndex,
  selection,
  fillPreview,
  table,
  columnSizing,
  interactions,
  canEdit,
  rowIndexById,
  getCellShading,
  cellRules,
  left,
  onStartFill
}: SpreadsheetCellProps) {
  const columnIndex =
    table.getCellSelectionColumnIndexes()[cell.column.id] ?? -1;
  const edges = cell.getSelectionEdges();
  const isSelected = cell.getIsSelected();
  const isFocused = selection.focusedColumnId === cell.column.id;
  const isEditing =
    interactions.editing?.rowId === cell.row.id &&
    interactions.editing.columnId === cell.column.id;

  const isFillTarget =
    fillPreview != null &&
    isWithinBounds(fillPreview.destination, rowIndex, columnIndex);
  const activeBound = selection.activeBound;

  const sourceRowIndex = rowIndexById.get(cell.row.id) ?? rowIndex;
  // Hidden for the whole grid while an editor is open: the handle belongs to
  // the selection, and mid-edit there is nothing to fill from yet.
  const showFillHandle =
    canEdit &&
    interactions.editing == null &&
    activeBound != null &&
    rowIndex === activeBound.maxRowIndex &&
    columnIndex === activeBound.maxColumnIndex;

  const value = cell.getValue();
  const rule = cellRules?.[cell.column.id];
  // Clicking a dropdown cell's chip opens the menu at once; clicking the rest
  // of the cell only selects it, so range selection works as anywhere else.
  const isDropdown = choicesFor(rule) !== null;
  const chipOpens =
    canEdit && isDropdown && !interactions.isColumnReadOnly(cell.column.id);
  const columnName = cell.column.columnDef.meta?.name ?? '';
  const openFromChip = (event: React.MouseEvent) => {
    if (!chipOpens || isEditing || event.button !== 0) return;
    // A modified click is extending the selection, not picking.
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey)
      return;
    event.stopPropagation();
    interactions.startEditing(cell.row.id, cell.column.id);
  };
  const shading = getCellShading?.({
    rowIndex: sourceRowIndex,
    fieldKey: cell.column.id,
    columnIndex,
    value
  });
  const showTooltip = Boolean(isFocused && !isEditing && shading?.message);

  return (
    <div
      className={TABLE_CLASS.gridCell}
      role='gridcell'
      aria-colindex={columnIndex + 1}
      aria-selected={isSelected}
      aria-readonly={!canEdit || undefined}
      // The focused cell shows the message as a bubble instead, so the native
      // tooltip would be a duplicate of it.
      title={showTooltip ? undefined : shading?.message}
      data-row-id={cell.row.id}
      data-column-id={cell.column.id}
      data-feathery-field={cell.column.id}
      // Deliberately no tabIndex: any tabIndex makes a div focusable by click,
      // and a focused cell that scrolls out of the virtualized window unmounts
      // and drops focus to <body>, killing the keyboard. Focus lives on the
      // scroll container, which never unmounts.
      css={{
        ...cellStyle,
        ...getColumnPositionStyle(cell.column, columnSizing, left),
        zIndex: cellZIndex(isSelected || isFocused, isFocused),
        ...(isSelected ? cellSelectedStyle : {}),
        ...cellEdgeVars(edges, isFocused, rowIndex === 0),
        ...(isFillTarget ? cellFillPreviewStyle : {}),
        // Feathery-controlled shading (e.g. a rejected value) is applied last
        // so a validation state stays visible through selection.
        ...shadingToStyle(shading)
      }}
      onMouseDown={(event) => {
        if (isEditing || event.button !== 0) return;
        // Keyboard handling lives on the scroll container, so clicking a cell
        // gives it focus (the cell itself is not focusable, see above).
        event.currentTarget
          .closest<HTMLElement>(`.${TABLE_CLASS.grid}`)
          ?.focus({ preventScroll: true });
        cell.getSelectionStartHandler(featheryDoc())(event);
      }}
      onMouseEnter={cell.getSelectionExtendHandler()}
      onDoubleClick={() => {
        if (!isEditing) interactions.startEditing(cell.row.id, cell.column.id);
      }}
    >
      {isDropdown ? (
        // Stays up while the menu is open, the way a chip does in a sheet.
        <DropdownChip
          text={formatCellDisplay(value as CellValue, rule)}
          label={`Choose ${columnName} for row ${rowIndex + 1}`}
          interactive={chipOpens}
          onOpen={openFromChip}
        />
      ) : isEditing ? null : (
        <span css={cellValueStyle}>
          {formatCellDisplay(value as CellValue, rule)}
        </span>
      )}
      {isEditing ? (
        <CellEditor
          rule={rule}
          draft={interactions.editing?.draft ?? ''}
          seeded={Boolean(interactions.editing?.seeded)}
          stored={interactions.editing?.stored ?? ''}
          label={`Edit ${cell.column.columnDef.meta?.name ?? ''} row ${
            rowIndex + 1
          }`}
          onChange={interactions.setEditingDraft}
          onCommit={(draft) => interactions.commitEditing(undefined, draft)}
          onCancel={interactions.cancelEditing}
          onKeyDown={interactions.handleEditorKeyDown}
          onBlur={() => interactions.commitEditing()}
        />
      ) : null}
      {showTooltip && shading?.message ? (
        <CellErrorTooltip
          message={shading.message}
          blocking={shading.severity !== 'warning'}
        />
      ) : null}
      {showFillHandle ? (
        <span
          className={TABLE_CLASS.gridFillHandle}
          aria-label='Drag to fill'
          css={fillHandleStyle}
          onMouseDown={(event) =>
            onStartFill(event, {
              minRowIndex: activeBound.minRowIndex,
              maxRowIndex: activeBound.maxRowIndex,
              minColumnIndex: activeBound.minColumnIndex,
              maxColumnIndex: activeBound.maxColumnIndex
            })
          }
        />
      ) : null}
    </div>
  );
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), ' +
  'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Moves focus to the next tabbable element after `element` (or off it). */
function focusAfter(element: HTMLElement) {
  const doc: Document = featheryDoc();
  const next = Array.from(doc.querySelectorAll<HTMLElement>(TABBABLE)).find(
    (candidate) =>
      !element.contains(candidate) &&
      Boolean(
        element.compareDocumentPosition(candidate) &
          Node.DOCUMENT_POSITION_FOLLOWING
      )
  );
  if (next) next.focus();
  else element.blur();
}

function shadingToStyle(shading: CellShading | null | undefined) {
  if (!shading) return {};
  return {
    ...(shading.backgroundColor
      ? { backgroundColor: shading.backgroundColor }
      : {}),
    ...(shading.textColor ? { color: shading.textColor } : {}),
    ...(shading.borderColor
      ? { boxShadow: `inset 0 0 0 1px ${shading.borderColor}` }
      : {})
  };
}

function getColumnPositionStyle(
  column: SpreadsheetTableColumn,
  columnSizing: SpreadsheetTable['state']['columnSizing'],
  left: number
): React.CSSProperties {
  return { width: getColumnSize(column, columnSizing), left };
}

function getColumnSize(
  column: SpreadsheetTableColumn | undefined,
  columnSizing: SpreadsheetTable['state']['columnSizing']
): number {
  if (!column) return DEFAULT_COLUMN_WIDTH;

  const sized = Object.prototype.hasOwnProperty.call(columnSizing, column.id)
    ? columnSizing[column.id]
    : undefined;

  return Math.min(
    Math.max(
      column.columnDef.minSize ?? 20,
      sized ?? column.columnDef.size ?? DEFAULT_COLUMN_WIDTH
    ),
    column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER
  );
}

/**
 * A compact fingerprint of everything about the selection that changes how this
 * row paints: its own membership, whether the neighbours above/below are in the
 * same range (which decides the range's top/bottom edges) and where the focus
 * ring is. Rows whose fingerprint is unchanged skip re-rendering during a drag.
 */
function rowSelectionKey(
  ranges: CellSelectionState,
  bounds: CellSelectionBounds[],
  rowIndex: number,
  rowId: string
): string {
  const active = ranges.at(-1);
  let key = active?.anchorRowId === rowId ? `f${active.anchorColumnId}` : '';

  for (const bound of bounds) {
    const self = rowIndex >= bound.minRowIndex && rowIndex <= bound.maxRowIndex;
    const above =
      rowIndex - 1 >= bound.minRowIndex && rowIndex - 1 <= bound.maxRowIndex;
    const below =
      rowIndex + 1 >= bound.minRowIndex && rowIndex + 1 <= bound.maxRowIndex;

    if (self || above || below) {
      key += `|${self ? 1 : 0}${above ? 1 : 0}${below ? 1 : 0}:${
        bound.minColumnIndex
      }-${bound.maxColumnIndex}`;
    }
  }

  return key;
}

function isWithinBounds(
  bounds: GridBounds,
  rowIndex: number,
  columnIndex: number
): boolean {
  return (
    rowIndex >= bounds.minRowIndex &&
    rowIndex <= bounds.maxRowIndex &&
    columnIndex >= bounds.minColumnIndex &&
    columnIndex <= bounds.maxColumnIndex
  );
}

function formatRenderedValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

let textMeasurementContext: CanvasRenderingContext2D | null = null;

type MeasuredFont = { size: number; weight: number };
const CELL_FONT: MeasuredFont = { size: FONT_SIZE, weight: 400 };
const HEADER_FONT: MeasuredFont = {
  size: HEADER_FONT_SIZE,
  weight: HEADER_FONT_WEIGHT
};

/**
 * The rendered width of `value` in the font the grid actually draws it in —
 * measuring in any other font fits the column to text it does not hold.
 */
export function measureTextWidth(value: string, font: MeasuredFont): number {
  if (!textMeasurementContext) {
    textMeasurementContext = featheryDoc()
      .createElement('canvas')
      .getContext('2d');
  }
  // jsdom has no 2d context; fall back to a rough per-character estimate.
  if (!textMeasurementContext) return value.length * font.size * 0.55;

  textMeasurementContext.font = `${font.weight} ${font.size}px ${GRID_FONT_FAMILY}`;
  return textMeasurementContext.measureText(value).width;
}

function getAutoFitColumnWidth(
  table: SpreadsheetTable,
  column: SpreadsheetTableColumn
): number {
  const fieldKey = column.columnDef.meta?.fieldKey;
  if (!fieldKey) return column.getSize();

  let widest = measureTextWidth(column.columnDef.meta?.name ?? '', HEADER_FONT);
  for (const row of table.options.data) {
    widest = Math.max(
      widest,
      measureTextWidth(formatRenderedValue(row.cells[fieldKey]), CELL_FONT)
    );
  }

  return Math.max(
    column.columnDef.minSize ?? 0,
    Math.ceil(widest + CELL_HORIZONTAL_PADDING + 2)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
