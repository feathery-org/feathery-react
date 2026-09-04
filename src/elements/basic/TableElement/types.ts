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

// Where the table's rows come from: form field values, a Data Hub, or a single
// hidden field holding an array of arrays.
export type TableDataSource = 'fields' | 'hub' | '2d_array';
