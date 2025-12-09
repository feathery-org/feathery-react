import { Column } from './types';

export const EXAMPLE_COLUMNS: Column[] = [
  {
    name: 'Header 1',
    field_id: 'header_1',
    field_type: 'text',
    field_key: 'example_column_0'
  },
  {
    name: 'Header 2',
    field_id: 'header_2',
    field_type: 'text',
    field_key: 'example_column_1'
  },
  {
    name: 'Header 3',
    field_id: 'header_3',
    field_type: 'text',
    field_key: 'example_column_2'
  }
];

export function generateExampleData(
  columns: Column[],
  numRows = 3
): Record<string, any[]> {
  const exampleData: Record<string, any[]> = {};

  columns.forEach((column) => {
    const values: any[] = [];
    for (let i = 0; i < numRows; i++) {
      values.push(`Sample ${i + 1}`);
    }
    exampleData[column.field_key] = values;
  });

  return exampleData;
}
