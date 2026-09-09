import { Column } from './types';

// A 2d_array table has no configured columns -- they come from the field value
// at runtime -- so the builder needs placeholders to render anything.
export function exampleArrayColumns(numColumns = 3): Column[] {
  return Array.from({ length: numColumns }, (_, index) => ({
    name: `Column ${index + 1}`,
    field_id: '',
    field_type: '',
    field_key: `example_column_${index}`
  }));
}

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
