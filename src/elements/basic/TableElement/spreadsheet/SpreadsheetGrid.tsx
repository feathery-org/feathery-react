import React from 'react';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  CellSelectionBounds,
  CellSelectionRangeOperation,
  CellSelectionState
} from '@tanstack/react-table';
import type { VirtualItem } from '@tanstack/react-virtual';
import { featheryDoc } from '../../../../utils/browser';
import { TABLE_CLASS } from '../classNames';
import { AddColumnHandler, CellShading, GetCellShading } from '../types';
import { getFillPreview } from './model';
import { RowMenu, RowMenuTarget } from './RowMenu';
import type { FillPreview, GridBounds, GridCoordinate } from './model';
import {
  addRowStripLabelStyle,
  addRowStripStyle,
  canvasStyle,
  cellEditorStyle,
  cellFillPreviewStyle,
  cellFocusedStyle,
  cellZIndex,
  cellSelectedStyle,
  cellStyle,
  cellValueStyle,
  columnHeaderLabelStyle,
  columnHeaderStyle,
  columnResizerActiveStyle,
  columnResizerStyle,
  cornerHeaderStyle,
  edgeVars,
  fillHandleStyle,
  frozenRegionStyle,
  frozenRowStyle,
  gridStyle,
  headerRowStyle,
  headerHighlightStyle,
  headerSelectedStyle,
  lastPinnedStyle,
  pinnedCellStyle,
  pinnedHeaderStyle,
  rowHeaderStyle,
  rowRaisedStyle,
  rowStyle,
  CELL_HORIZONTAL_PADDING,
  DEFAULT_COLUMN_WIDTH,
  HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  ROW_HEIGHT
} from './styles';
import type {
  SpreadsheetTable,
  SpreadsheetTableCell,
  SpreadsheetTableColumn,
  SpreadsheetTableHeader,
  SpreadsheetTableRow
} from './table';
import type { GridInteractions } from './useGridInteractions';

export type SpreadsheetGridHandle = {
  scrollToCell: (rowId: string, columnId: string) => void;
};

type SpreadsheetGridProps = {
  table: SpreadsheetTable;
  interactions: GridInteractions;
  canEdit: boolean;
  rowIndexById: Map<string, number>;
  getCellShading?: GetCellShading;
  /**
   * Renders a trailing add-column header when supplied. No data source
   * provides one yet, so it is currently never rendered.
   */
  onAddColumn?: AddColumnHandler;
  /** Enables the row context menu's insert items and the trailing add strip. */
  onInsertRow?: (atIndex: number) => void;
  /** Enables the row context menu's delete item. */
  onDeleteRow?: (rowIndex: number) => void;
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
    onAddColumn,
    onInsertRow,
    onDeleteRow
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
      { hotkey: 'Tab', callback: () => interactions.moveSelection('right') },
      {
        hotkey: 'Shift+Tab',
        callback: () => interactions.moveSelection('left')
      },
      { hotkey: 'Enter', callback: () => interactions.moveSelection('down') },
      {
        hotkey: 'Shift+Enter',
        callback: () => interactions.moveSelection('up')
      },
      { hotkey: 'F2', callback: interactions.startEditingActive },
      { hotkey: 'Delete', callback: interactions.clearSelection },
      { hotkey: 'Backspace', callback: interactions.clearSelection },
      { hotkey: 'Escape', callback: () => table.resetCellSelection(true) },
      { hotkey: 'Mod+A', callback: () => table.selectAllCells() },
      { hotkey: 'Mod+Z', callback: interactions.undo },
      { hotkey: 'Mod+Shift+Z', callback: interactions.redo },
      { hotkey: 'Mod+Y', callback: interactions.redo }
    ],
    {
      target: scrollRef,
      // While a cell editor is open the keys belong to the <input>.
      enabled: interactions.editing == null,
      preventDefault: true,
      stopPropagation: true
    }
  );

  const startColumns = table.getStartVisibleLeafColumns();
  const centerColumns = table.getCenterVisibleLeafColumns();
  const endColumns = table.getEndVisibleLeafColumns();
  const topRows = table.getTopRows();
  const centerRows = table.getCenterRows();
  const columnSizing = table.state.columnSizing;

  const startWidth = startColumns.reduce(
    (total, column) => total + getColumnSize(column, columnSizing),
    0
  );
  const endWidth = endColumns.reduce(
    (total, column) => total + getColumnSize(column, columnSizing),
    0
  );
  const frozenRowsHeight = topRows.length * ROW_HEIGHT;

  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: centerRows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => centerRows[index]?.id ?? index,
    estimateSize: () => ROW_HEIGHT,
    paddingStart: HEADER_HEIGHT + frozenRowsHeight,
    scrollPaddingStart: HEADER_HEIGHT + frozenRowsHeight,
    overscan: 8
  });

  const columnVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: centerColumns.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => centerColumns[index]?.id ?? index,
    estimateSize: (index) => getColumnSize(centerColumns[index], columnSizing),
    horizontal: true,
    paddingStart: ROW_HEADER_WIDTH + startWidth,
    paddingEnd: endWidth,
    scrollPaddingStart: ROW_HEADER_WIDTH + startWidth,
    scrollPaddingEnd: endWidth,
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
      scrollToCell(rowId, columnId) {
        // Frozen rows and pinned columns are always on screen already.
        const isFrozenRow = topRows.some((row) => row.id === rowId);
        if (!isFrozenRow) {
          const rowIndex = centerRows.findIndex((row) => row.id === rowId);
          if (rowIndex >= 0) rowVirtualizer.scrollToIndex(rowIndex);
        }

        const isPinnedColumn =
          startColumns.some((column) => column.id === columnId) ||
          endColumns.some((column) => column.id === columnId);
        if (!isPinnedColumn) {
          const columnIndex = centerColumns.findIndex(
            (column) => column.id === columnId
          );
          if (columnIndex >= 0) columnVirtualizer.scrollToIndex(columnIndex);
        }
      }
    }),
    [
      centerColumns,
      centerRows,
      columnVirtualizer,
      endColumns,
      rowVirtualizer,
      startColumns,
      topRows
    ]
  );

  const [fillPreview, setFillPreview] = React.useState<FillPreview | null>(
    null
  );
  const [rowMenu, setRowMenu] = React.useState<RowMenuTarget | null>(null);
  const closeRowMenu = React.useCallback(() => setRowMenu(null), []);
  const hasRowMenu = Boolean(onInsertRow || onDeleteRow);
  const fillDragRef = React.useRef<FillDrag | null>(null);
  const headerSelectionDragRef = React.useRef<HeaderSelectionDrag | null>(null);

  const getDisplayColumns = React.useCallback(
    () => [...startColumns, ...centerColumns, ...endColumns],
    [centerColumns, endColumns, startColumns]
  );

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

      let row: SpreadsheetTableRow | undefined;
      if (topRows.length && localY < HEADER_HEIGHT + frozenRowsHeight) {
        const topIndex = clamp(
          Math.floor((localY - HEADER_HEIGHT) / ROW_HEIGHT),
          0,
          topRows.length - 1
        );
        row = topRows[topIndex];
      } else {
        const item = rowVirtualizer.getVirtualItemForOffset(
          element.scrollTop + localY
        );
        row = item ? centerRows[item.index] : undefined;
      }

      let column: SpreadsheetTableColumn | undefined;
      if (startColumns.length && localX < ROW_HEADER_WIDTH + startWidth) {
        let offset = ROW_HEADER_WIDTH;
        column = startColumns.find((candidate) => {
          const nextOffset = offset + candidate.getSize();
          const match = localX >= offset && localX < nextOffset;
          offset = nextOffset;
          return match;
        });
      } else if (endColumns.length && localX > rect.width - endWidth) {
        let offset = rect.width - endWidth;
        column = endColumns.find((candidate) => {
          const nextOffset = offset + candidate.getSize();
          const match = localX >= offset && localX < nextOffset;
          offset = nextOffset;
          return match;
        });
      } else {
        const item = columnVirtualizer.getVirtualItemForOffset(
          element.scrollLeft + localX
        );
        column = item ? centerColumns[item.index] : undefined;
      }

      if (!row || !column) return null;
      const columnIndex =
        table.getCellSelectionColumnIndexes()[column.id] ?? -1;
      const rowIndex = row.getDisplayIndex();
      if (rowIndex < 0 || columnIndex < 0) return null;
      return { rowIndex, columnIndex };
    },
    [
      centerColumns,
      centerRows,
      columnVirtualizer,
      endColumns,
      endWidth,
      frozenRowsHeight,
      rowVirtualizer,
      startColumns,
      startWidth,
      table,
      topRows
    ]
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
            ? getDisplayColumns()[coordinate.columnIndex]?.id
            : table.getRowsInDisplayOrder()[coordinate.rowIndex]?.id;
        if (focusId) applyHeaderSelectionDrag(headerDrag, focusId);
        return;
      }

      if (!table._isSelectingCells) return;
      const row = table.getRowsInDisplayOrder()[coordinate.rowIndex];
      const column = getDisplayColumns()[coordinate.columnIndex];
      if (!row || !column) return;
      row.getAllCellsByColumnId()[column.id]?.getSelectionExtendHandler()(
        event
      );
    },
    [applyHeaderSelectionDrag, getDisplayColumns, resolveCoordinate, table]
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
  const canvasWidth = columnVirtualizer.getTotalSize();
  const rowsHeight = rowVirtualizer.getTotalSize();
  const canvasHeight = rowsHeight + (onInsertRow ? ROW_HEIGHT : 0);
  const displayColumnCount = getDisplayColumns().length;

  return (
    <>
      <div
        ref={scrollRef}
        className={TABLE_CLASS.grid}
        role='grid'
        tabIndex={0}
        aria-rowcount={table.getRowsInDisplayOrder().length + 1}
        aria-colcount={displayColumnCount}
        aria-readonly={!canEdit || undefined}
        css={gridStyle}
        onKeyDown={interactions.handleGridTextEntry}
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
                centerHeaders={table.getCenterLeafHeaders()}
                startHeaders={table.getStartLeafHeaders()}
                endHeaders={table.getEndLeafHeaders()}
                onStartSelection={startHeaderSelection}
                onExtendSelection={extendHeaderSelection}
                onAddColumn={onAddColumn}
              />
            )}
          </table.Subscribe>

          {topRows.length ? (
            <div css={{ ...frozenRegionStyle, height: frozenRowsHeight }}>
              {topRows.map((row, index) => (
                <SubscribedRow
                  key={row.id}
                  row={row}
                  top={index * ROW_HEIGHT}
                  frozen
                  table={table}
                  columnSizing={columnSizing}
                  virtualColumns={virtualColumns}
                  interactions={interactions}
                  canEdit={canEdit}
                  rowIndexById={rowIndexById}
                  getCellShading={getCellShading}
                  fillPreview={fillPreview}
                  onStartHeaderSelection={startHeaderSelection}
                  onExtendHeaderSelection={extendHeaderSelection}
                  onOpenRowMenu={hasRowMenu ? setRowMenu : undefined}
                  onStartFill={startFillDrag}
                />
              ))}
            </div>
          ) : null}

          {virtualRows.map((virtualRow) => {
            const row = centerRows[virtualRow.index];
            if (!row) return null;
            return (
              <SubscribedRow
                key={row.id}
                row={row}
                top={virtualRow.start}
                frozen={false}
                table={table}
                columnSizing={columnSizing}
                virtualColumns={virtualColumns}
                interactions={interactions}
                canEdit={canEdit}
                rowIndexById={rowIndexById}
                getCellShading={getCellShading}
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
  centerHeaders: SpreadsheetTableHeader[];
  startHeaders: SpreadsheetTableHeader[];
  endHeaders: SpreadsheetTableHeader[];
  onStartSelection: (
    event: React.MouseEvent<HTMLElement>,
    axis: 'column',
    id: string,
    fullySelected: boolean
  ) => void;
  onExtendSelection: (axis: 'column', id: string) => void;
  onAddColumn?: AddColumnHandler;
};

function HeaderRow({
  table,
  columnSizing,
  resizingColumnId,
  selectionBounds,
  virtualColumns,
  centerHeaders,
  startHeaders,
  endHeaders,
  onStartSelection,
  onExtendSelection,
  onAddColumn
}: HeaderRowProps) {
  const rowCount = table.getRowsInDisplayOrder().length;
  const shared = {
    table,
    bounds: selectionBounds,
    columnSizing,
    resizingColumnId,
    rowCount,
    onStartSelection,
    onExtendSelection
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
      {startHeaders.map((header) => (
        <HeaderCell
          key={header.id}
          header={header}
          pinned='start'
          {...shared}
        />
      ))}
      {virtualColumns.map((virtualColumn) => {
        const header = centerHeaders[virtualColumn.index];
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
      {endHeaders.map((header) => (
        <HeaderCell key={header.id} header={header} pinned='end' {...shared} />
      ))}
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
  left?: number;
  pinned?: 'start' | 'end';
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
  pinned
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
  const startColumns = table.getStartVisibleLeafColumns();
  const isLastPinnedStart =
    pinned === 'start' && startColumns.at(-1)?.id === column.id;

  return (
    <div
      className={TABLE_CLASS.gridHeaderCell}
      role='columnheader'
      aria-colindex={columnIndex + 1}
      aria-selected={fullySelected}
      title={label}
      css={{
        ...columnHeaderStyle,
        ...getColumnPositionStyle(
          column,
          columnSizing,
          left,
          pinned,
          isLastPinnedStart
        ),
        ...(pinned ? pinnedHeaderStyle : {}),
        ...(inSelection ? headerHighlightStyle : {}),
        ...(fullySelected ? headerSelectedStyle : {})
      }}
      onMouseDown={(event) =>
        onStartSelection(event, 'column', column.id, fullySelected)
      }
      onMouseEnter={() => onExtendSelection('column', column.id)}
    >
      <span
        css={{
          ...columnHeaderLabelStyle,
          ...(fullySelected ? { color: 'inherit' } : {})
        }}
      >
        {label}
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
  frozen: boolean;
  table: SpreadsheetTable;
  columnSizing: SpreadsheetTable['state']['columnSizing'];
  virtualColumns: VirtualItem[];
  interactions: GridInteractions;
  canEdit: boolean;
  rowIndexById: Map<string, number>;
  getCellShading?: GetCellShading;
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
        const columnCount =
          table.getStartVisibleLeafColumns().length +
          table.getCenterVisibleLeafColumns().length +
          table.getEndVisibleLeafColumns().length;

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
  frozen,
  table,
  columnSizing,
  virtualColumns,
  interactions,
  canEdit,
  rowIndexById,
  getCellShading,
  fillPreview,
  onStartHeaderSelection,
  onExtendHeaderSelection,
  onOpenRowMenu,
  onStartFill,
  selection
}: SubscribedRowProps & { selection: RowSelectionSnapshot }) {
  const rowIndex = row.getDisplayIndex();
  const centerCells = row.getCenterVisibleCells();
  const startCells = row.getStartVisibleCells();
  const endCells = row.getEndVisibleCells();

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
    onStartFill
  };

  return (
    <div
      className={TABLE_CLASS.gridRow}
      role='row'
      aria-rowindex={rowIndex + 2}
      css={{
        ...rowStyle,
        // A frozen row is already lifted above the scrolling rows; raising a
        // selected one further would drop it out of the frozen region.
        ...(frozen
          ? frozenRowStyle
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
          ...(selection.inSelection ? headerHighlightStyle : {}),
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
      {startCells.map((cell) => (
        <SpreadsheetCell key={cell.id} cell={cell} pinned='start' {...shared} />
      ))}
      {virtualColumns.map((virtualColumn) => {
        const cell = centerCells[virtualColumn.index];
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
      {endCells.map((cell) => (
        <SpreadsheetCell key={cell.id} cell={cell} pinned='end' {...shared} />
      ))}
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
  left?: number;
  pinned?: 'start' | 'end';
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
  left,
  pinned,
  onStartFill
}: SpreadsheetCellProps) {
  const columnIndex =
    table.getCellSelectionColumnIndexes()[cell.column.id] ?? -1;
  const isLastPinnedStart =
    pinned === 'start' &&
    table.getStartVisibleLeafColumns().at(-1)?.id === cell.column.id;
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
  const showFillHandle =
    canEdit &&
    activeBound != null &&
    rowIndex === activeBound.maxRowIndex &&
    columnIndex === activeBound.maxColumnIndex;

  const value = cell.getValue();
  const shading = getCellShading?.({
    rowIndex: sourceRowIndex,
    fieldKey: cell.column.id,
    columnIndex,
    value
  });

  return (
    <div
      className={TABLE_CLASS.gridCell}
      role='gridcell'
      aria-colindex={columnIndex + 1}
      aria-selected={isSelected}
      aria-readonly={!canEdit || undefined}
      title={shading?.message}
      data-row-id={cell.row.id}
      data-column-id={cell.column.id}
      data-feathery-field={cell.column.id}
      tabIndex={isEditing ? -1 : isFocused ? 0 : -1}
      css={{
        ...cellStyle,
        ...getColumnPositionStyle(
          cell.column,
          columnSizing,
          left,
          pinned,
          isLastPinnedStart
        ),
        ...(pinned ? pinnedCellStyle : {}),
        zIndex: cellZIndex(Boolean(pinned), isSelected || isFocused),
        ...(isSelected ? cellSelectedStyle : {}),
        ...(isFocused ? cellFocusedStyle : {}),
        ...(edges.top ? edgeVars.top : {}),
        ...(edges.right ? edgeVars.right : {}),
        ...(edges.bottom ? edgeVars.bottom : {}),
        ...(edges.left ? edgeVars.left : {}),
        ...(isFillTarget ? cellFillPreviewStyle : {}),
        // Feathery-controlled shading (e.g. a rejected value) is applied last
        // so a validation state stays visible through selection.
        ...shadingToStyle(shading)
      }}
      onMouseDown={(event) => {
        if (isEditing || event.button !== 0) return;
        // Keyboard handling lives on the scroll container, so clicking a cell
        // has to return focus there rather than leave it on the cell div.
        event.currentTarget
          .closest<HTMLElement>(`.${TABLE_CLASS.grid}`)
          ?.focus({ preventScroll: true });
        cell.getSelectionStartHandler(featheryDoc())(event);
      }}
      onMouseEnter={cell.getSelectionExtendHandler()}
      onDoubleClick={() =>
        interactions.startEditing(cell.row.id, cell.column.id)
      }
    >
      {isEditing ? (
        <input
          autoFocus
          className={TABLE_CLASS.gridCellEditor}
          aria-label={`Edit ${cell.column.columnDef.meta?.name ?? ''} row ${
            rowIndex + 1
          }`}
          value={interactions.editing?.draft ?? ''}
          css={cellEditorStyle}
          onFocus={(event) => event.currentTarget.select()}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => interactions.setEditingDraft(event.target.value)}
          onKeyDown={interactions.handleEditorKeyDown}
          onBlur={() => interactions.commitEditing()}
        />
      ) : (
        <span css={cellValueStyle}>{formatRenderedValue(value)}</span>
      )}
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
  left?: number,
  pinned?: 'start' | 'end',
  isLastPinnedStart?: boolean
): React.CSSProperties {
  const width = getColumnSize(column, columnSizing);
  if (pinned === 'start') {
    return {
      width,
      insetInlineStart: ROW_HEADER_WIDTH + column.getStart('start'),
      // Only the innermost frozen column casts the shadow onto the scrolling
      // region, so the frozen block reads as one unit.
      ...(isLastPinnedStart ? lastPinnedStyle : {})
    };
  }
  if (pinned === 'end') {
    return { width, insetInlineEnd: column.getAfter('end') };
  }
  return { width, left };
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

function measureTextWidth(value: string, bold = false): number {
  if (!textMeasurementContext) {
    textMeasurementContext = featheryDoc()
      .createElement('canvas')
      .getContext('2d');
  }
  // jsdom has no 2d context; fall back to a rough per-character estimate.
  if (!textMeasurementContext) return value.length * 6;

  textMeasurementContext.font = `${bold ? '600 ' : ''}11px Arial, sans-serif`;
  return textMeasurementContext.measureText(value).width;
}

function getAutoFitColumnWidth(
  table: SpreadsheetTable,
  column: SpreadsheetTableColumn
): number {
  const fieldKey = column.columnDef.meta?.fieldKey;
  if (!fieldKey) return column.getSize();

  let widest = measureTextWidth(column.columnDef.meta?.name ?? '', true);
  for (const row of table.options.data) {
    widest = Math.max(
      widest,
      measureTextWidth(formatRenderedValue(row.cells[fieldKey]))
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
