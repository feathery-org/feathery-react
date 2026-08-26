import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';
import { Column } from './types';

type HubEntry = { id: string; data: Record<string, any> };
type HubRow = {
  localId: string;
  entryId: string | null;
  data: Record<string, any>;
};

type DataHubAction = (options: {
  hubId: string;
  operation: 'get' | 'create' | 'update' | 'delete';
  entryId?: string;
  data?: Record<string, any>;
  where?: Array<{ entryId: string } | { fieldId: string; value?: any }>;
}) => Promise<any>;

type UseHubTableSourceProps = {
  element: {
    id: string;
    properties: {
      columns: Column[];
      hub_id?: string;
    };
  };
  client: { dataHubAction?: DataHubAction } | null | undefined;
  enabled: boolean;
};

type UseHubTableSourceReturn = {
  hubColumns: Column[];
  hubFieldValues: Record<string, any[]>;
  entryIds: Array<string | null>;
  loading: boolean;
  saving: boolean;
  errors: string[];
  refetch: () => void;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleAddRow: () => void;
  handleDeleteRow: (rowIndex: number) => void;
};

const syntheticKey = (tableId: string, hubFieldKey: string) =>
  `__hub_${tableId}_${hubFieldKey}`;

const errorMessages = (error: any): string[] => {
  const detail = error?.response?.data ?? error?.data;
  if (detail) {
    const messages: string[] = [];
    const collect = (value: any) => {
      if (typeof value === 'string') messages.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === 'object') {
        Object.values(value).forEach(collect);
      }
    };
    collect(detail);
    if (messages.length) return messages;
  }
  return [error?.message || 'Failed to save Data Hub changes'];
};

export function useHubTableSource({
  element,
  client,
  enabled
}: UseHubTableSourceProps): UseHubTableSourceReturn {
  const tableId = element.id;
  const hubId = element.properties?.hub_id;
  const userColumns: Column[] = element.properties?.columns || [];

  // Columns whose runtime storage key points into the Hub-derived value map.
  const { hubColumns, syntheticToHubKey } = useMemo(() => {
    const map: Record<string, string> = {};
    const cols = userColumns.map((col) => {
      const hubFieldKey = col.hub_field_key || '';
      const key = hubFieldKey
        ? syntheticKey(tableId, hubFieldKey)
        : col.field_key;
      if (hubFieldKey) map[key] = hubFieldKey;
      return { ...col, field_key: key };
    });
    return { hubColumns: cols, syntheticToHubKey: map };
  }, [userColumns, tableId]);

  const [rows, setRows] = useState<HubRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pendingRef = useRef(0);
  const nextLocalId = useRef(0);

  const commitRows = useCallback((nextRows: HubRow[]) => {
    rowsRef.current = nextRows;
    setRows(nextRows);
  }, []);

  const updateRow = useCallback(
    (localId: string, change: (row: HubRow) => HubRow) => {
      commitRows(
        rowsRef.current.map((row) =>
          row.localId === localId ? change(row) : row
        )
      );
    },
    [commitRows]
  );

  // Writes go out one at a time so a cell edit can never race the create of the
  // row it belongs to, and so edits land in the order the user made them.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((task: () => Promise<void>) => {
    pendingRef.current += 1;
    setPending(pendingRef.current);
    queueRef.current = queueRef.current
      .then(task)
      .catch(() => {})
      .then(() => {
        pendingRef.current -= 1;
        setPending(pendingRef.current);
      });
  }, []);

  const loadEntries = useCallback(async () => {
    if (!enabled || !hubId || !client?.dataHubAction) return;
    setLoading(true);
    setErrors([]);
    try {
      const entries = await client.dataHubAction({ hubId, operation: 'get' });
      const list: HubEntry[] = Array.isArray(entries) ? [...entries] : [];
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      commitRows(
        list.map((entry) => ({
          localId: `entry:${entry.id}`,
          entryId: entry.id,
          data: { ...entry.data }
        }))
      );
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, hubId, client, commitRows]);

  const refetch = useCallback(() => {
    // A reload would drop in-flight writes and rows that have not been created
    // yet, so only resync when the table has nothing outstanding.
    if (pendingRef.current > 0) return;
    if (rowsRef.current.some((row) => row.entryId == null)) return;
    loadEntries().catch(() => {});
  }, [loadEntries]);

  useEffect(() => {
    if (!enabled) return;
    refetch();
    const onFocus = () => refetch();
    featheryWindow().addEventListener('focus', onFocus);
    return () => featheryWindow().removeEventListener('focus', onFocus);
  }, [enabled, refetch]);

  const hubFieldValues = useMemo(() => {
    const values: Record<string, any[]> = {};
    hubColumns.forEach((column) => {
      const hubFieldKey = syntheticToHubKey[column.field_key];
      if (!hubFieldKey) return;
      values[column.field_key] = rows.map((row) => row.data[hubFieldKey] ?? '');
    });
    return values;
  }, [hubColumns, rows, syntheticToHubKey]);

  const entryIds = useMemo(() => rows.map((row) => row.entryId), [rows]);

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      const hubFieldKey = syntheticToHubKey[fieldKey];
      const target = rowsRef.current[rowIndex];
      if (!hubFieldKey || !target) return;
      const { localId } = target;
      const previousValue = target.data[hubFieldKey];

      updateRow(localId, (row) => ({
        ...row,
        data: { ...row.data, [hubFieldKey]: newValue }
      }));
      setErrors([]);

      enqueue(async () => {
        if (!hubId || !client?.dataHubAction) return;
        const row = rowsRef.current.find((r) => r.localId === localId);
        if (!row) return;
        try {
          if (row.entryId) {
            await client.dataHubAction({
              hubId,
              operation: 'update',
              where: [{ entryId: row.entryId }],
              data: { [hubFieldKey]: row.data[hubFieldKey] }
            });
            return;
          }
          // Rows stay provisional until their first edit, so the first edit is
          // what creates them (an empty row would just fail required fields).
          const created: HubEntry | null = await client.dataHubAction({
            hubId,
            operation: 'create',
            data: row.data
          });
          if (!created?.id) throw new Error('Data Hub did not return a row ID');
          updateRow(localId, (r) => ({
            ...r,
            entryId: created.id,
            data: { ...r.data, ...created.data }
          }));
        } catch (error) {
          // A failed create keeps the typed value so the user can fix and retry;
          // a failed update has a stored value to fall back to.
          if (row.entryId) {
            updateRow(localId, (r) => ({
              ...r,
              data: { ...r.data, [hubFieldKey]: previousValue }
            }));
          }
          setErrors(errorMessages(error));
        }
      });
    },
    [syntheticToHubKey, updateRow, enqueue, hubId, client]
  );

  const handleAddRow = useCallback(() => {
    const data = Object.fromEntries(
      Object.values(syntheticToHubKey).map((hubFieldKey) => [hubFieldKey, ''])
    );
    commitRows([
      { localId: `new:${nextLocalId.current++}`, entryId: null, data },
      ...rowsRef.current
    ]);
    setErrors([]);
  }, [syntheticToHubKey, commitRows]);

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const target = rowsRef.current[rowIndex];
      if (!target) return;
      commitRows(rowsRef.current.filter((_, index) => index !== rowIndex));
      setErrors([]);
      if (!target.entryId) return;

      enqueue(async () => {
        if (!hubId || !client?.dataHubAction) return;
        try {
          await client.dataHubAction({
            hubId,
            operation: 'delete',
            where: [{ entryId: target.entryId as string }]
          });
        } catch (error) {
          // Put the row back so the table keeps matching the Hub.
          const restored = [...rowsRef.current];
          restored.splice(rowIndex, 0, target);
          commitRows(restored);
          setErrors(errorMessages(error));
        }
      });
    },
    [commitRows, enqueue, hubId, client]
  );

  return {
    hubColumns,
    hubFieldValues,
    entryIds,
    loading,
    saving: pending > 0,
    errors,
    refetch,
    handleCellEdit,
    handleAddRow,
    handleDeleteRow
  };
}
