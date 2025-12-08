import { Column } from './types';

export const DUMMY_COLUMNS: Column[] = [
  {
    name: 'Name',
    field_id: 'dummy_name',
    field_type: 'text',
    field_key: 'dummy_column_0'
  },
  {
    name: 'Email',
    field_id: 'dummy_email',
    field_type: 'text',
    field_key: 'dummy_column_1'
  },
  {
    name: 'Status',
    field_id: 'dummy_status',
    field_type: 'text',
    field_key: 'dummy_column_2'
  }
];

export function generateDummyDataForColumns(
  columns: Column[],
  numRows = 3
): Record<string, any[]> {
  const dummyData: Record<string, any[]> = {};

  columns.forEach((column) => {
    const values: any[] = [];
    for (let i = 0; i < numRows; i++) {
      values.push(`Sample ${i + 1}`);
    }
    dummyData[column.field_key] = values;
  });

  return dummyData;
}
