import { useCallback, useRef, useState } from 'react';
import { CellWrite } from '../types';
import { CellPatch } from './model';

export type SpreadsheetCommand = {
  label: string;
  patches: CellPatch[];
};

const HISTORY_LIMIT = 100;

/**
 * Undo/redo for spreadsheet edits.
 *
 * Unlike a standalone spreadsheet, the rows here are NOT owned by this hook —
 * they live in form field values or a Data Hub. So history stores only the
 * before/after patches and replays them back through the same batched write
 * path a user edit takes, which keeps undo persisting like any other edit
 * rather than silently diverging from the backend.
 */
export function useSpreadsheetHistory(
  applyWrites: (writes: CellWrite[]) => void
) {
  const [past, setPast] = useState<SpreadsheetCommand[]>([]);
  const [future, setFuture] = useState<SpreadsheetCommand[]>([]);

  const applyRef = useRef(applyWrites);
  applyRef.current = applyWrites;

  const execute = useCallback((label: string, patches: CellPatch[]) => {
    if (!patches.length) return;
    applyRef.current(toWrites(patches, 'after'));
    setPast((current) =>
      [...current, { label, patches }].slice(-HISTORY_LIMIT)
    );
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((current) => {
      const command = current[current.length - 1];
      if (!command) return current;
      applyRef.current(toWrites(command.patches, 'before'));
      setFuture((upcoming) => [command, ...upcoming]);
      return current.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((current) => {
      const command = current[0];
      if (!command) return current;
      applyRef.current(toWrites(command.patches, 'after'));
      setPast((previous) => [...previous, command].slice(-HISTORY_LIMIT));
      return current.slice(1);
    });
  }, []);

  /**
   * Patches are keyed by row index, so anything that shifts indices — adding
   * or deleting a row, a Data Hub refetch that reorders rows — invalidates the
   * whole stack. Replaying a stale patch would write to the wrong row, so the
   * history is dropped instead.
   */
  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return {
    execute,
    undo,
    redo,
    reset,
    canUndo: past.length > 0,
    canRedo: future.length > 0
  };
}

function toWrites(
  patches: CellPatch[],
  value: 'before' | 'after'
): CellWrite[] {
  return patches.map((patch) => ({
    fieldKey: patch.fieldKey,
    rowIndex: patch.rowIndex,
    value: patch[value]
  }));
}

export type SpreadsheetHistory = ReturnType<typeof useSpreadsheetHistory>;
