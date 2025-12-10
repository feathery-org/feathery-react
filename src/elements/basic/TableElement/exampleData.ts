import { Column } from './types';

export function generateExampleData(
  columns: Column[],
  numRows = 2
): Record<string, any[]> {
  const exampleData: Record<string, any[]> = {};

  columns.forEach((column) => {
    exampleData[column.field_key] = Array(numRows).fill('Sample');
  });

  return exampleData;
}
