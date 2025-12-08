import { Column } from './types';

export const EXAMPLE_COLUMNS: Column[] = [
  {
    name: 'Name',
    field_id: 'example_name',
    field_type: 'text',
    field_key: 'example_column_0'
  },
  {
    name: 'Email',
    field_id: 'example_email',
    field_type: 'text',
    field_key: 'example_column_1'
  },
  {
    name: 'Status',
    field_id: 'example_status',
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
