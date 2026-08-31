import {
  cellSelectionFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  metaHelper,
  rowPinningFeature,
  tableFeatures
} from '@tanstack/react-table';
import type {
  Cell,
  Column,
  Header,
  ReactTable,
  Row,
  TableState
} from '@tanstack/react-table';

/**
 * One rendered spreadsheet row. `rowIndex` is the table element's own row
 * coordinate, which every mutation handler (`handleCellEdit`, `handleDeleteRow`,
 * Data Hub writes) is keyed on, so it stays attached to the row rather than
 * being recomputed from display position.
 */
export type SpreadsheetRow = {
  id: string;
  rowIndex: number;
  cells: Record<string, unknown>;
};

export type SpreadsheetColumnMeta = {
  fieldKey: string;
  name: string;
  index: number;
};

/**
 * Sorting, searching and pagination stay in `useTableData` rather than moving
 * into TanStack: the classic table shares them, and spreadsheet mode renders
 * every row through the virtualizer instead of paging.
 */
export const spreadsheetFeatures = tableFeatures({
  cellSelectionFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnResizingFeature,
  columnSizingFeature,
  rowPinningFeature,
  columnMeta: metaHelper<SpreadsheetColumnMeta>()
});

export type SpreadsheetFeatures = typeof spreadsheetFeatures;

export type SpreadsheetTableState = Pick<
  TableState<SpreadsheetFeatures>,
  | 'columnOrder'
  | 'columnPinning'
  | 'columnResizing'
  | 'columnSizing'
  | 'rowPinning'
>;

export type SpreadsheetTable = ReactTable<
  SpreadsheetFeatures,
  SpreadsheetRow,
  SpreadsheetTableState
>;
export type SpreadsheetTableRow = Row<SpreadsheetFeatures, SpreadsheetRow>;
export type SpreadsheetTableColumn = Column<
  SpreadsheetFeatures,
  SpreadsheetRow,
  unknown
>;
export type SpreadsheetTableHeader = Header<
  SpreadsheetFeatures,
  SpreadsheetRow,
  unknown
>;
export type SpreadsheetTableCell = Cell<
  SpreadsheetFeatures,
  SpreadsheetRow,
  unknown
>;
