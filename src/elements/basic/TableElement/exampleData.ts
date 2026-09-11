import { Column } from './types';
import {
  STATUS_HUB_FIELD_ID,
  STATUS_LABEL_UNVERIFIED,
  STATUS_LABEL_VERIFIED
} from './hubStatus';

export function generateExampleData(
  columns: Column[],
  numRows = 2
): Record<string, any[]> {
  const exampleData: Record<string, any[]> = {};

  columns.forEach((column) => {
    // The designer preview alternates the status column so the builder sees
    // both states it can show, instead of a column of "Sample".
    exampleData[column.field_key] =
      column.hub_field_id === STATUS_HUB_FIELD_ID
        ? Array.from({ length: numRows }, (_, index) =>
            index % 2 ? STATUS_LABEL_UNVERIFIED : STATUS_LABEL_VERIFIED
          )
        : Array(numRows).fill('Sample');
  });

  return exampleData;
}
