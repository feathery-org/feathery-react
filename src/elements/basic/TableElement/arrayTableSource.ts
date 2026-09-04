import { stringifyWithNull } from '../../../utils/primitives';
import { Column } from './types';

// Names the field so a form builder knows which one to go fix.
export const arraySourceError = (fieldKey: string) =>
  `${fieldKey || 'Table data'} must be an array of arrays`;

export type ParsedArrayValue = {
  rows: any[][];
  // A text-typed hidden field arrives as a JSON string, and the backend
  // rejects a non-string written back to one, so writes must match the shape
  // they were read in.
  wasString: boolean;
  error?: string;
};

export function parseArrayTableValue(
  raw: any,
  fieldKey = ''
): ParsedArrayValue {
  const wasString = typeof raw === 'string';

  // An unset field is an empty table, not a misconfigured one.
  if (raw === null || raw === undefined || raw === '') {
    return { rows: [], wasString };
  }

  let value = raw;
  if (wasString) {
    try {
      value = JSON.parse(raw);
    } catch {
      return { rows: [], wasString, error: arraySourceError(fieldKey) };
    }
  }

  if (!Array.isArray(value) || !value.every((row) => Array.isArray(row))) {
    return { rows: [], wasString, error: arraySourceError(fieldKey) };
  }

  return { rows: value, wasString };
}

// Cells render as text. Objects need JSON because they would otherwise
// stringify to '[object Object]'.
export function castArrayCell(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return stringifyWithNull(value);
}

export const arrayColumnKey = (tableId: string, columnIndex: number) =>
  `__array_${tableId}_${columnIndex}`;

// The widest row sets the column count so extra cells are never dropped.
export const arrayColumnCount = (rows: any[][]) =>
  rows.reduce((max, row) => Math.max(max, row.length), 0);

export function deriveArrayColumns(tableId: string, rows: any[][]): Column[] {
  const [headerRow = []] = rows;
  return Array.from({ length: arrayColumnCount(rows) }, (_, index) => ({
    name: castArrayCell(headerRow[index]),
    field_id: '',
    field_type: '',
    field_key: arrayColumnKey(tableId, index)
  }));
}

export function deriveArrayFieldValues(
  columns: Column[],
  rows: any[][]
): Record<string, any[]> {
  const dataRows = rows.slice(1);
  const values: Record<string, any[]> = {};
  columns.forEach((column, index) => {
    values[column.field_key] = dataRows.map((row) => castArrayCell(row[index]));
  });
  return values;
}
