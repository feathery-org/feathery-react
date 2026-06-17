export type Action = {
  label: string;
};

export type Column = {
  name: string;
  field_id: string;
  field_type: string;
  field_key: string;
};

export type CellCoord = { rowIndex: number; colIndex: number };
