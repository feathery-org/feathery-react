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

// Table row storage lives in a Data Hub instead of form field values.
export type TableDataSource = 'fields' | 'hub';

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
 * Appends a column to the table. Only a data source that owns its own schema
 * can implement this — neither field-backed tables (columns are designer-set
 * element properties) nor Data Hub tables (columns are the Hub's fields) do,
 * so it is currently supplied by no source. The grid renders its add-column
 * affordance only when a source provides one.
 */
export type AddColumnHandler = (name?: string) => void;

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
