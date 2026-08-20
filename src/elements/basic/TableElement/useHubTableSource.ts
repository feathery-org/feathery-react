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
  isDirty: boolean;
  isCellDirty: (fieldKey: string, rowIndex: number) => boolean;
  refetch: () => void;
  save: () => Promise<void>;
  reset: () => Promise<void>;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleAddRow: () => void;
  handleDeleteRow: (rowIndex: number) => void;
};

const syntheticKey = (tableId: string, hubFieldKey: string) =>
  `__hub_${tableId}_${hubFieldKey}`;

const valuesEqual = (left: any, right: any) =>
  left === right || JSON.stringify(left) === JSON.stringify(right);

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
  const [baselineEntries, setBaselineEntries] = useState<
    Record<string, HubEntry>
  >({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const baselineRef = useRef(baselineEntries);
  baselineRef.current = baselineEntries;
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const nextLocalId = useRef(0);

  const projectEntries = useCallback((entries: HubEntry[]) => {
    const nextRows = entries.map((entry) => ({
      localId: `entry:${entry.id}`,
      entryId: entry.id,
      data: { ...entry.data }
    }));
    const nextBaseline = Object.fromEntries(
      entries.map((entry) => [entry.id, { ...entry, data: { ...entry.data } }])
    );
    rowsRef.current = nextRows;
    baselineRef.current = nextBaseline;
    setRows(nextRows);
    setBaselineEntries(nextBaseline);
  }, []);

  const loadEntries = useCallback(async () => {
    if (!enabled || !hubId || !client?.dataHubAction) return;
    setLoading(true);
    setErrors([]);
    try {
      const entries = await client.dataHubAction({ hubId, operation: 'get' });
      const list: HubEntry[] = Array.isArray(entries) ? [...entries] : [];
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      projectEntries(list);
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, hubId, client, projectEntries]);

  const refetch = useCallback(() => {
    loadEntries().catch(() => {});
  }, [loadEntries]);

  useEffect(() => {
    if (!enabled) return;
    refetch();
    const onFocus = () => {
      if (!dirtyRef.current && !savingRef.current) refetch();
    };
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

  const isCellDirty = useCallback(
    (fieldKey: string, rowIndex: number) => {
      const row = rows[rowIndex];
      const hubFieldKey = syntheticToHubKey[fieldKey];
      if (!row || !hubFieldKey) return false;
      const baseline = row.entryId ? baselineEntries[row.entryId] : undefined;
      return baseline
        ? !valuesEqual(
            row.data[hubFieldKey] ?? '',
            baseline.data[hubFieldKey] ?? ''
          )
        : !valuesEqual(row.data[hubFieldKey] ?? '', '');
    },
    [rows, baselineEntries, syntheticToHubKey]
  );

  const isDirty = useMemo(() => {
    const persistedIds = new Set(
      rows.flatMap((row) => (row.entryId ? [row.entryId] : []))
    );
    if (
      rows.some((row) => row.entryId == null) ||
      Object.keys(baselineEntries).some((id) => !persistedIds.has(id))
    ) {
      return true;
    }
    return rows.some((row, rowIndex) =>
      hubColumns.some((column) => isCellDirty(column.field_key, rowIndex))
    );
  }, [rows, baselineEntries, hubColumns, isCellDirty]);
  dirtyRef.current = isDirty;

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      const hubFieldKey = syntheticToHubKey[fieldKey];
      if (!hubFieldKey) return;
      const nextRows = rowsRef.current.map((row, index) =>
        index === rowIndex
          ? { ...row, data: { ...row.data, [hubFieldKey]: newValue } }
          : row
      );
      rowsRef.current = nextRows;
      setRows(nextRows);
      setErrors([]);
    },
    [syntheticToHubKey]
  );

  const handleAddRow = useCallback(() => {
    const data = Object.fromEntries(
      Object.values(syntheticToHubKey).map((hubFieldKey) => [hubFieldKey, ''])
    );
    const nextRows = [
      {
        localId: `new:${nextLocalId.current++}`,
        entryId: null,
        data
      },
      ...rowsRef.current
    ];
    rowsRef.current = nextRows;
    setRows(nextRows);
    setErrors([]);
  }, [syntheticToHubKey]);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    const nextRows = rowsRef.current.filter((_, index) => index !== rowIndex);
    rowsRef.current = nextRows;
    setRows(nextRows);
    setErrors([]);
  }, []);

  const save = useCallback(async () => {
    if (!hubId || !client?.dataHubAction || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErrors([]);

    const snapshotRows = rowsRef.current.map((row) => ({
      ...row,
      data: { ...row.data }
    }));
    const originalBaseline = baselineRef.current;
    const nextBaseline: Record<string, HubEntry> = { ...originalBaseline };
    const nextRows = snapshotRows.map((row) => ({
      ...row,
      data: { ...row.data }
    }));
    const failures: string[] = [];
    const currentEntryIds = new Set(
      snapshotRows.flatMap((row) => (row.entryId ? [row.entryId] : []))
    );
    const deletedEntryIds = Object.keys(originalBaseline).filter(
      (id) => !currentEntryIds.has(id)
    );

    for (let rowIndex = 0; rowIndex < snapshotRows.length; rowIndex += 1) {
      const row = snapshotRows[rowIndex];
      try {
        if (!row.entryId) {
          const created: HubEntry | null = await client.dataHubAction({
            hubId,
            operation: 'create',
            data: row.data
          });
          if (!created?.id) throw new Error('Data Hub did not return a row ID');
          const savedData = { ...row.data, ...created.data };
          nextRows[rowIndex] = {
            ...row,
            entryId: created.id,
            data: savedData
          };
          nextBaseline[created.id] = { id: created.id, data: savedData };
          continue;
        }

        const baseline = originalBaseline[row.entryId];
        const changedData = Object.fromEntries(
          Object.entries(row.data).filter(
            ([key, value]) =>
              !valuesEqual(value ?? '', baseline?.data[key] ?? '')
          )
        );
        if (!Object.keys(changedData).length) continue;
        await client.dataHubAction({
          hubId,
          operation: 'update',
          where: [{ entryId: row.entryId }],
          data: changedData
        });
        nextBaseline[row.entryId] = {
          id: row.entryId,
          data: { ...baseline?.data, ...row.data }
        };
      } catch (error) {
        errorMessages(error).forEach((message) =>
          failures.push(`Row ${rowIndex + 1}: ${message}`)
        );
      }
    }

    for (const entryId of deletedEntryIds) {
      try {
        await client.dataHubAction({
          hubId,
          operation: 'delete',
          where: [{ entryId }]
        });
        delete nextBaseline[entryId];
      } catch (error) {
        errorMessages(error).forEach((message) =>
          failures.push(`Deleted row: ${message}`)
        );
      }
    }

    rowsRef.current = nextRows;
    baselineRef.current = nextBaseline;
    setRows(nextRows);
    setBaselineEntries(nextBaseline);
    setErrors(failures);
    savingRef.current = false;
    setSaving(false);
  }, [hubId, client]);

  const reset = useCallback(async () => {
    if (savingRef.current) return;
    await loadEntries();
  }, [loadEntries]);

  return {
    hubColumns,
    hubFieldValues,
    entryIds,
    loading,
    saving,
    errors,
    isDirty,
    isCellDirty,
    refetch,
    save,
    reset,
    handleCellEdit,
    handleAddRow,
    handleDeleteRow
  };
}
