import { useCallback, useMemo, useState } from 'react';
import { CellWrite } from '../types';
import { CellValue } from './model';
import { cellErrorKey } from './validation';

type PendingState = {
  /** `${rowIndex}:${fieldKey}` -> the value the user typed. */
  values: Record<string, CellValue>;
  /** Feathery row indices the user removed but has not saved yet. */
  deletedRows: number[];
};

const EMPTY: PendingState = { values: {}, deletedRows: [] };

export type PendingEdits = {
  /** Cell edits plus row deletions still waiting on a Save. */
  count: number;
  /** The buffered value for a cell, or `undefined` if it has none. */
  peek: (rowIndex: number, fieldKey: string) => CellValue | undefined;
  isRowDeleted: (rowIndex: number) => boolean;
  /** Buffered edits in the shape the source's batch writer takes. */
  writes: CellWrite[];
  /** Deleted rows, highest index first, so applying them in order is safe. */
  deletedRows: number[];
  record: (writes: CellWrite[]) => void;
  recordDelete: (rowIndex: number) => void;
  /** Renumber buffered edits after a row is inserted into the source data. */
  shiftForInsert: (atIndex: number) => void;
  discard: () => void;
  clear: () => void;
};

/**
 * Holds spreadsheet edits until the user saves them.
 *
 * Both table data sources otherwise write through on every keystroke — a Data
 * Hub request per row, or a `submitCustom` per edit — which makes a spreadsheet
 * feel like it is saving constantly and leaves no room to validate a change
 * before it lands. Buffering here rather than inside either source keeps one
 * implementation for both, and keeps the underlying write path (batched,
 * ordered, undo-replayable) exactly as it was.
 *
 * Buffered edits are keyed by SOURCE row index, which is stable while they are
 * held: nothing removes a row from the source until the save, and an insert is
 * remapped through `shiftForInsert`.
 */
export function usePendingEdits(): PendingEdits {
  const [pending, setPending] = useState<PendingState>(EMPTY);

  const record = useCallback((writes: CellWrite[]) => {
    if (!writes.length) return;
    setPending((current) => {
      const values = { ...current.values };
      writes.forEach(({ rowIndex, fieldKey, value }) => {
        values[cellErrorKey(rowIndex, fieldKey)] = value;
      });
      return { ...current, values };
    });
  }, []);

  const recordDelete = useCallback((rowIndex: number) => {
    setPending((current) => {
      if (current.deletedRows.includes(rowIndex)) return current;
      // Edits to a row that is going away would be written and then deleted.
      const values = Object.fromEntries(
        Object.entries(current.values).filter(
          ([key]) => rowOf(key) !== rowIndex
        )
      );
      return { values, deletedRows: [...current.deletedRows, rowIndex] };
    });
  }, []);

  const shiftForInsert = useCallback((atIndex: number) => {
    setPending((current) => {
      const shift = (index: number) => (index >= atIndex ? index + 1 : index);
      return {
        values: Object.fromEntries(
          Object.entries(current.values).map(([key, value]) => [
            cellErrorKey(shift(rowOf(key)), fieldOf(key)),
            value
          ])
        ),
        deletedRows: current.deletedRows.map(shift)
      };
    });
  }, []);

  const clear = useCallback(() => setPending(EMPTY), []);

  const peek = useCallback(
    (rowIndex: number, fieldKey: string) =>
      pending.values[cellErrorKey(rowIndex, fieldKey)],
    [pending.values]
  );

  const deletedRowSet = useMemo(
    () => new Set(pending.deletedRows),
    [pending.deletedRows]
  );

  const isRowDeleted = useCallback(
    (rowIndex: number) => deletedRowSet.has(rowIndex),
    [deletedRowSet]
  );

  const writes = useMemo(
    () =>
      Object.entries(pending.values).map(([key, value]) => ({
        rowIndex: rowOf(key),
        fieldKey: fieldOf(key),
        value
      })),
    [pending.values]
  );

  // Deleting from the end first keeps the earlier indices valid as each one is
  // applied to the source.
  const deletedRows = useMemo(
    () => [...pending.deletedRows].sort((a, b) => b - a),
    [pending.deletedRows]
  );

  // A stable object matters here: the grid derives its rows from values this
  // hook returns, so a fresh identity every render would rebuild the whole
  // virtualized table on every keystroke elsewhere in the form.
  return useMemo(
    () => ({
      count: writes.length + deletedRows.length,
      peek,
      isRowDeleted,
      writes,
      deletedRows,
      record,
      recordDelete,
      shiftForInsert,
      discard: clear,
      clear
    }),
    [
      writes,
      deletedRows,
      peek,
      isRowDeleted,
      record,
      recordDelete,
      shiftForInsert,
      clear
    ]
  );
}

// Keys are `${rowIndex}:${fieldKey}`; a field key may itself contain colons,
// so only the first separator is significant.
function rowOf(key: string): number {
  return Number(key.slice(0, key.indexOf(':')));
}

function fieldOf(key: string): string {
  return key.slice(key.indexOf(':') + 1);
}
