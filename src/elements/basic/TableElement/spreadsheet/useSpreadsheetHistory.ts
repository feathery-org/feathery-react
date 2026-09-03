import { useCallback, useRef, useState } from 'react';
import { CellWrite } from '../types';
import { CellPatch } from './model';

export type SpreadsheetCommand = {
  label: string;
  patches: CellPatch[];
};

type HistoryStacks = {
  past: SpreadsheetCommand[];
  future: SpreadsheetCommand[];
};

const HISTORY_LIMIT = 100;
const EMPTY_HISTORY: HistoryStacks = { past: [], future: [] };

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
  const [stacks, setStacks] = useState<HistoryStacks>(EMPTY_HISTORY);
  // The stacks are read through a ref so undo/redo can apply their writes
  // BEFORE calling setState. Applying inside a functional updater would run a
  // sibling component's setState during this one's render, which React
  // forbids (and Strict Mode would double-apply).
  const stacksRef = useRef(stacks);
  const commit = useCallback((next: HistoryStacks) => {
    stacksRef.current = next;
    setStacks(next);
  }, []);

  const applyRef = useRef(applyWrites);
  applyRef.current = applyWrites;

  const execute = useCallback(
    (label: string, patches: CellPatch[]) => {
      if (!patches.length) return;
      applyRef.current(toWrites(patches, 'after'));
      const { past } = stacksRef.current;
      commit({
        past: [...past, { label, patches }].slice(-HISTORY_LIMIT),
        future: []
      });
    },
    [commit]
  );

  const undo = useCallback(() => {
    const { past, future } = stacksRef.current;
    const command = past[past.length - 1];
    if (!command) return;
    applyRef.current(toWrites(command.patches, 'before'));
    commit({ past: past.slice(0, -1), future: [command, ...future] });
  }, [commit]);

  const redo = useCallback(() => {
    const { past, future } = stacksRef.current;
    const command = future[0];
    if (!command) return;
    applyRef.current(toWrites(command.patches, 'after'));
    commit({
      past: [...past, command].slice(-HISTORY_LIMIT),
      future: future.slice(1)
    });
  }, [commit]);

  /**
   * Patches are keyed by row index, so anything that shifts indices — adding
   * or deleting a row, a Data Hub refetch that reorders rows — invalidates the
   * whole stack. Replaying a stale patch would write to the wrong row, so the
   * history is dropped instead.
   */
  const reset = useCallback(() => commit(EMPTY_HISTORY), [commit]);

  return {
    execute,
    undo,
    redo,
    reset,
    canUndo: stacks.past.length > 0,
    canRedo: stacks.future.length > 0
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
