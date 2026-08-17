import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Column } from './types';

/**
 * Backs a Table element with Data Hub rows instead of form field values.
 *
 * Reads entries via the SDK `dataHubAction` channel on mount and whenever the
 * window regains focus (there is no push channel), projects them into the same
 * `{ syntheticKey -> value[] }` shape the field-backed table already renders,
 * and keeps an aligned `entryIds[]` (row index -> Hub entry id) so edits/deletes
 * target the right row. Writes go back through create/update/delete.
 *
 * Hub data is kept in table-local state on purpose: it never enters the global
 * `fieldValues` map or the `submitCustom` pipeline, so it can't leak into the
 * form submission.
 */

type HubEntry = { id: string; data: Record<string, any> };

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
  error: string | null;
  refetch: () => void;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleAddRow: () => void;
  handleDeleteRow: (rowIndex: number) => void;
};

const syntheticKey = (tableId: string, hubFieldKey: string) =>
  `__hub_${tableId}_${hubFieldKey}`;

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
      const key = hubFieldKey ? syntheticKey(tableId, hubFieldKey) : col.field_key;
      if (hubFieldKey) map[key] = hubFieldKey;
      return { ...col, field_key: key };
    });
    return { hubColumns: cols, syntheticToHubKey: map };
  }, [userColumns, tableId]);

  const [hubFieldValues, setHubFieldValues] = useState<Record<string, any[]>>(
    {}
  );
  // Row index -> Hub entry id. `null` marks a provisional row that has been
  // added locally but not yet persisted (created on its first cell edit).
  const [entryIds, setEntryIds] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columnsRef = useRef(hubColumns);
  columnsRef.current = hubColumns;

  const projectEntries = useCallback(
    (entries: HubEntry[]) => {
      const cols = columnsRef.current;
      const values: Record<string, any[]> = {};
      cols.forEach((col) => {
        const hubFieldKey = syntheticToHubKey[col.field_key];
        if (!hubFieldKey) return;
        values[col.field_key] = entries.map((e) => e.data?.[hubFieldKey] ?? '');
      });
      setHubFieldValues(values);
      setEntryIds(entries.map((e) => e.id));
    },
    [syntheticToHubKey]
  );

  const refetch = useCallback(() => {
    if (!enabled || !hubId || !client?.dataHubAction) return;
    setLoading(true);
    setError(null);
    client
      .dataHubAction({ hubId, operation: 'get' })
      .then((entries: HubEntry[] | null) => {
        const list = Array.isArray(entries) ? [...entries] : [];
        // Deterministic order so a focus-refetch doesn't reshuffle rows.
        list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        projectEntries(list);
      })
      .catch((e: any) => setError(e?.message || 'Failed to load Data Hub rows'))
      .finally(() => setLoading(false));
  }, [enabled, hubId, client, projectEntries]);

  // Fetch on mount and whenever the window regains focus.
  useEffect(() => {
    if (!enabled) return;
    refetch();
    const onFocus = () => refetch();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, refetch]);

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      const hubFieldKey = syntheticToHubKey[fieldKey];
      if (!hubId || !client?.dataHubAction || !hubFieldKey) return;

      // Optimistic local update.
      setHubFieldValues((prev) => {
        const col = [...(prev[fieldKey] || [])];
        col[rowIndex] = newValue;
        return { ...prev, [fieldKey]: col };
      });

      const entryId = entryIds[rowIndex];
      if (entryId == null) {
        // Provisional row: create it now, carrying this first edited cell.
        client
          .dataHubAction({
            hubId,
            operation: 'create',
            data: { [hubFieldKey]: newValue }
          })
          .then((created: HubEntry | null) => {
            if (!created?.id) return;
            setEntryIds((prev) => {
              const next = [...prev];
              next[rowIndex] = created.id;
              return next;
            });
          })
          .catch((e: any) =>
            setError(e?.message || 'Failed to create Data Hub row')
          );
      } else {
        client
          .dataHubAction({
            hubId,
            operation: 'update',
            where: [{ entryId }],
            data: { [hubFieldKey]: newValue }
          })
          .catch((e: any) => {
            setError(e?.message || 'Failed to save Data Hub cell');
            refetch();
          });
      }
    },
    [hubId, client, syntheticToHubKey, entryIds, refetch]
  );

  const handleAddRow = useCallback(() => {
    // Prepend a provisional (unpersisted) blank row; it is created in the Hub
    // on its first cell edit, avoiding an empty-required-field create.
    setHubFieldValues((prev) => {
      const next: Record<string, any[]> = {};
      columnsRef.current.forEach((col) => {
        next[col.field_key] = ['', ...(prev[col.field_key] || [])];
      });
      return next;
    });
    setEntryIds((prev) => [null, ...prev]);
  }, []);

  const handleDeleteRow = useCallback(
    (rowIndex: number) => {
      const entryId = entryIds[rowIndex];

      const spliceLocal = () => {
        setHubFieldValues((prev) => {
          const next: Record<string, any[]> = {};
          Object.keys(prev).forEach((k) => {
            next[k] = prev[k].filter((_, i) => i !== rowIndex);
          });
          return next;
        });
        setEntryIds((prev) => prev.filter((_, i) => i !== rowIndex));
      };

      if (entryId == null) {
        // Provisional row was never persisted.
        spliceLocal();
        return;
      }
      if (!hubId || !client?.dataHubAction) return;
      spliceLocal();
      client
        .dataHubAction({ hubId, operation: 'delete', where: [{ entryId }] })
        .catch((e: any) => {
          setError(e?.message || 'Failed to delete Data Hub row');
          refetch();
        });
    },
    [hubId, client, entryIds, refetch]
  );

  return {
    hubColumns,
    hubFieldValues,
    entryIds,
    loading,
    error,
    refetch,
    handleCellEdit,
    handleAddRow,
    handleDeleteRow
  };
}
