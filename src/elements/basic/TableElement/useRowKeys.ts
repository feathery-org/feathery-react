import { useCallback, useMemo, useRef } from 'react';
import {
  insertRowKey,
  makeRowKeyMinter,
  reconcileRowKeys,
  removeRowKey,
  RowKeyMinter
} from './rowKeys';

export type RowKeys = {
  /** One key per source row, in source order. */
  keys: string[];
  keyAt: (rowIndex: number) => string | undefined;
  /** Undefined once the row is gone — a stale key resolves to nothing. */
  rowIndexOf: (rowKey: string) => number | undefined;
  onRowInserted: (rowIndex: number) => void;
  onRowRemoved: (rowIndex: number) => void;
};

type UseRowKeysProps = {
  tableId: string;
  /** Rows in the source data, however the table is fed. */
  rowCount: number;
  /**
   * A Data Hub table's own row ids (`entry:<id>` / `new:<n>`). Given, they are
   * the row keys: the hub source already keeps them stable across saves,
   * refetches and rows being added around them.
   */
  hubLocalIds?: string[];
};

/**
 * Stable identity for the rows of one table. See `./rowKeys` for why a row
 * index will not do.
 */
export function useRowKeys({
  tableId,
  rowCount,
  hubLocalIds
}: UseRowKeysProps): RowKeys {
  const mintRef = useRef<RowKeyMinter | undefined>(undefined);
  if (!mintRef.current) mintRef.current = makeRowKeyMinter(tableId);
  const mint = mintRef.current;

  const mintedRef = useRef<string[]>([]);
  // Reconciled during render, not in an effect: an annotation resolved this
  // render has to see the keys of the rows being rendered, not last render's.
  // `reconcileRowKeys` is idempotent, so running it twice changes nothing.
  if (!hubLocalIds)
    mintedRef.current = reconcileRowKeys(mintedRef.current, rowCount, mint);

  const keys = hubLocalIds ?? mintedRef.current;

  // `keys` keeps its identity while the rows are unchanged — `reconcileRowKeys`
  // hands back the array it was given — so these memos hold across renders.
  const keyAt = useCallback((rowIndex: number) => keys[rowIndex], [keys]);

  const index = useMemo(
    () => new Map(keys.map((key, rowIndex) => [key, rowIndex])),
    [keys]
  );
  const rowIndexOf = useCallback(
    (rowKey: string) => index.get(rowKey),
    [index]
  );

  // Hub rows carry their own identity, so there is nothing to bookkeep there.
  const onRowInserted = useCallback(
    (rowIndex: number) => {
      if (hubLocalIds) return;
      mintedRef.current = insertRowKey(mintedRef.current, rowIndex, mint);
    },
    [hubLocalIds, mint]
  );
  const onRowRemoved = useCallback(
    (rowIndex: number) => {
      if (hubLocalIds) return;
      mintedRef.current = removeRowKey(mintedRef.current, rowIndex);
    },
    [hubLocalIds]
  );

  return { keys, keyAt, rowIndexOf, onRowInserted, onRowRemoved };
}
