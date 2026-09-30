import type { CellValueType } from './spreadsheet/validation';
import type { CellValue } from './spreadsheet/model';

export type Action = {
  label: string;
};

export type Column = {
  name: string;
  field_id: string;
  field_type: string;
  field_key: string;
  // Set when the table's data_source is 'hub': the Data Hub field this column maps to.
  hub_field_id?: string;
  hub_field_key?: string;
};

export type CellCoord = { rowIndex: number; colIndex: number };

// Where table rows are stored: one form field per column, a Data Hub, or one
// hidden field holding the whole grid as an array of rows of cells.
export type TableDataSource = 'fields' | 'hub' | 'hidden_field';

// One cell to write. Batched so a range edit (paste, drag-fill, clear, undo)
// reaches the backend as a single submission per row/column rather than one
// request per cell.
export type CellWrite = {
  fieldKey: string;
  rowIndex: number;
  value: any;
};

export type TableDisplayMode = 'classic' | 'spreadsheet';

/**
 * A column as the user defines it when adding or editing one. `default` is
 * what a new row starts with in that column; left out (or empty), a new row's
 * cell is blank.
 */
export type ColumnDraft = {
  name: string;
  field_type: CellValueType;
  /** Blank cells in the column are flagged. */
  required?: boolean;
  default?: CellValue;
};

/** What a column control asks the table to open, anchored to that control. */
export type ColumnRequest =
  // `atIndex` places the new column there; without it the column is appended
  | { kind: 'add'; anchor: HTMLElement; atIndex?: number }
  | { kind: 'edit' | 'delete'; fieldKey: string; anchor: HTMLElement };

/**
 * The column changes the form user may make. Only a data source that owns its
 * own schema can offer them — field-backed tables take their columns from
 * designer-set element properties and Data Hub tables from the Hub's fields,
 * so today only a hidden field source supplies this. Each header and grid
 * affordance renders only when its permission is set.
 */
export type ColumnControls = {
  canAdd: boolean;
  // Inserting between columns shifts the ones after it, so unlike appending it
  // waits, like a delete, until the spreadsheet's held edits are resolved.
  canInsert: boolean;
  // Asked per column: a hidden field column's own `canEdit` / `canDelete`
  // overrides the table's setting for it.
  canEdit: (fieldKey: string) => boolean;
  canDelete: (fieldKey: string) => boolean;
  onRequest: (request: ColumnRequest) => void;
};

/**
 * Visual treatment applied to a cell or row by Feathery — not by the form
 * builder. Reserved for states the SDK derives itself, such as a Data Hub
 * write that failed validation.
 *
 * Colors are plain CSS colors so a shade can come from a theme token or a
 * hard-coded status color without this type caring which.
 */
export type CellShading = {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  /** Surfaced as the cell's title/aria-description, e.g. the validation error. */
  message?: string;
  /**
   * How serious the message is. `error` blocks a save; `warning` is advisory
   * (a staged Data Hub row is not held to the hub's field rules until it is
   * verified). Drives the color of the bubble shown on the focused cell.
   */
  severity?: 'error' | 'warning';
};

export type CellShadingContext = {
  rowIndex: number;
  fieldKey: string;
  columnIndex: number;
  value: any;
};

/**
 * Resolves the shading for one cell. Returning `null`/`undefined` leaves the
 * cell unshaded. A row-level shade is expressed by returning the same result
 * for every column in that row; a cell-level shade wins over it.
 */
export type GetCellShading = (
  context: CellShadingContext
) => CellShading | null | undefined;
