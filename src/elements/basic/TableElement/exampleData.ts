import { Column } from './types';

export function generateExampleData(
  columns: Column[],
  numRows = 1
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
