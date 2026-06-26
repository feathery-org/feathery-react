import { rerenderAllForms } from './formHelperFunctions';

// Ephemeral, per-session table row-selection state. Keyed by table element id
// (always present, even on legacy tables that have no logic name/key).
export const tableSelectionState: Record<string, Set<number>> = {};

// Total base row counts, registered by mounted TableElements so the Table
// entity can clamp/validate selection without reaching into React.
export const tableRowCounts: Record<string, number> = {};

export const registerTableRowCount = (tableId: string, rowCount: number): void => {
  tableRowCounts[tableId] = rowCount;
};

export const unregisterTableRowCount = (tableId: string): void => {
  delete tableRowCounts[tableId];
};

export const getTableRowCount = (tableId: string): number =>
  tableRowCounts[tableId] ?? 0;

// Keep only unique, in-range integer indices, sorted ascending.
export const clampIndices = (indices: number[], rowCount: number): number[] => {
  const unique = new Set<number>();
  indices.forEach((i) => {
    if (Number.isInteger(i) && i >= 0 && i < rowCount) unique.add(i);
  });
  return Array.from(unique).sort((a, b) => a - b);
};

export const getSelectedRows = (tableId: string): number[] =>
  clampIndices(Array.from(tableSelectionState[tableId] ?? []), getTableRowCount(tableId));

export const setSelectedRows = (tableId: string, indices: number[]): void => {
  tableSelectionState[tableId] = new Set(clampIndices(indices, getTableRowCount(tableId)));
  rerenderAllForms();
};

export const toggleRow = (tableId: string, index: number): void => {
  const next = new Set(tableSelectionState[tableId] ?? []);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  tableSelectionState[tableId] = next;
  rerenderAllForms();
};

export const clearTableSelection = (tableId: string): void => {
  tableSelectionState[tableId] = new Set();
  rerenderAllForms();
};

// On row delete: drop the deleted base index and shift higher indices down by 1.
export const remapAfterDelete = (tableId: string, deletedIndex: number): void => {
  const current = tableSelectionState[tableId];
  if (!current) return;
  const remapped = new Set<number>();
  current.forEach((i) => {
    if (i === deletedIndex) return;
    remapped.add(i > deletedIndex ? i - 1 : i);
  });
  tableSelectionState[tableId] = remapped;
};
