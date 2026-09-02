import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { featheryWindow } from '../../../utils/browser';
import { HubFieldSchema, HubSchema } from '../../components/dataMapping/types';
import { CellRules, hubCellRules } from './spreadsheet/validation';
import { CellWrite, Column } from './types';

export type HubVerification = 'verified' | 'unverified' | 'all';

type HubEntry = {
  id: string;
  data: Record<string, any>;
  verified?: boolean;
};
type HubRow = {
  localId: string;
  entryId: string | null;
  data: Record<string, any>;
  // Only meaningful when a verification filter was sent: the Hub labels each
  // entry then. Writes to an unverified row must say so, since update and
  // delete default to the verified set server-side.
  verified: boolean;
  // Hub field key -> message, for cells whose last write the Hub rejected.
  // Drives the validation shading in spreadsheet mode.
  errors?: Record<string, string>;
};

type DataHubAction = (options: {
  hubId: string;
  operation: 'get' | 'create' | 'update' | 'delete';
  entryId?: string;
  data?: Record<string, any>;
  where?: Array<{ entryId: string } | { fieldId: string; value?: any }>;
  verification?: HubVerification;
}) => Promise<any>;

type UseHubTableSourceProps = {
  element: {
    id: string;
    properties: {
      columns: Column[];
      hub_id?: string;
      hidden_hub_fields?: string[];
      hub_verification?: HubVerification;
    };
  };
  client:
    | {
        dataHubAction?: DataHubAction;
        getHubSchemas?: (hubIds: string[]) => Promise<{ hubs: HubSchema[] }>;
      }
    | null
    | undefined;
  enabled: boolean;
  /**
   * Holds off background resyncs. A refetch replaces every row, so it would
   * silently rewrite the rows that unsaved edits are keyed to.
   */
  blockRefetch?: boolean;
};

type UseHubTableSourceReturn = {
  hubColumns: Column[];
  hubFieldValues: Record<string, any[]>;
  entryIds: Array<string | null>;
  loading: boolean;
  saving: boolean;
  errors: string[];
  // `${rowIndex}:${fieldKey}` -> message, for cells the Hub rejected.
  cellErrors: Record<string, string>;
  // The hub's own field rules, so the grid can flag a bad value before a save
  // rather than only after one is rejected.
  cellRules: CellRules;
  // Whether each row is verified, in row order. A staged (unverified) row is
  // not held to the hub's field rules until it is verified.
  rowVerified: boolean[];
  // Adding is impossible while reading unverified rows: `create` with
  // `verification: unverified` is a batch REPLACE of the staged set.
  canAddRows: boolean;
  refetch: () => void;
  handleCellEdit: (fieldKey: string, rowIndex: number, newValue: any) => void;
  handleCellsEdit: (writes: CellWrite[]) => void;
  handleAddRow: () => void;
  handleInsertRow: (atIndex: number) => void;
  handleDeleteRow: (rowIndex: number) => void;
  // Drops rows added since the last save that were never written to the Hub.
  discardNewRows: () => void;
};

const syntheticKey = (tableId: string, hubFieldKey: string) =>
  `__hub_${tableId}_${hubFieldKey}`;

const ROW_GONE_MESSAGE =
  'This row was changed or removed in the Data Hub. Refresh to see the latest data.';

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
  enabled,
  blockRefetch = false
}: UseHubTableSourceProps): UseHubTableSourceReturn {
  const tableId = element.id;
  const hubId = element.properties?.hub_id;
  const userColumns: Column[] = element.properties?.columns || [];
  const hiddenHubFields = element.properties?.hidden_hub_fields;
  // Omitted means verified-only, which is what the Hub API already defaults to.
  const verification: HubVerification =
    element.properties?.hub_verification ?? 'verified';

  const [schemaFields, setSchemaFields] = useState<HubFieldSchema[] | null>(
    null
  );

  // Columns derive from the live Hub schema minus the hidden (blacklisted)
  // fields, so fields added to the Hub later show up without republishing the
  // form. The columns stored on the element are only a fallback until the
  // schema loads.
  const resolvedColumns: Column[] = useMemo(() => {
    if (!schemaFields) return userColumns;
    const hidden = new Set(hiddenHubFields ?? []);
    return schemaFields
      .filter((field) => !hidden.has(field.id))
      .map((field) => ({
        name: field.key,
        field_id: '',
        field_type: '',
        field_key: '',
        hub_field_id: field.id,
        hub_field_key: field.key
      }));
  }, [schemaFields, userColumns, hiddenHubFields]);

  // Columns whose runtime storage key points into the Hub-derived value map.
  const { hubColumns, syntheticToHubKey } = useMemo(() => {
    const map: Record<string, string> = {};
    const cols = resolvedColumns.map((col) => {
      const hubFieldKey = col.hub_field_key || '';
      const key = hubFieldKey
        ? syntheticKey(tableId, hubFieldKey)
        : col.field_key;
      if (hubFieldKey) map[key] = hubFieldKey;
      return { ...col, field_key: key };
    });
    return { hubColumns: cols, syntheticToHubKey: map };
  }, [resolvedColumns, tableId]);

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
      // A schema failure (e.g. a backend without the endpoint yet) falls back
      // to the columns stored on the element instead of erroring the table.
      const [schemas, entries] = await Promise.all([
        client.getHubSchemas
          ? client.getHubSchemas([hubId]).catch(() => null)
          : Promise.resolve(null),
        client.dataHubAction({ hubId, operation: 'get', verification })
      ]);
      const fields = schemas?.hubs?.find((h) => h.id === hubId)?.fields;
      if (Array.isArray(fields)) setSchemaFields(fields);
      const list: HubEntry[] = Array.isArray(entries) ? [...entries] : [];
      list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      commitRows(
        list.map((entry) => ({
          localId: `entry:${entry.id}`,
          entryId: entry.id,
          data: { ...entry.data },
          // The Hub only labels entries when a verification filter was sent;
          // with the default filter every row it returns is verified.
          verified: entry.verified ?? true
        }))
      );
    } catch (error) {
      setErrors(errorMessages(error));
    } finally {
      setLoading(false);
    }
  }, [enabled, hubId, client, commitRows, verification]);

  const blockRefetchRef = useRef(blockRefetch);
  blockRefetchRef.current = blockRefetch;

  const refetch = useCallback(() => {
    // A reload would drop in-flight writes, unsaved edits, and rows that have
    // not been created yet, so only resync when nothing is outstanding.
    if (pendingRef.current > 0 || blockRefetchRef.current) return;
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

  const rowVerified = useMemo(() => rows.map((row) => row.verified), [rows]);

  const cellRules = useMemo(
    () => hubCellRules(hubColumns, schemaFields),
    [hubColumns, schemaFields]
  );

  // Re-key row-local errors onto the (rowIndex, synthetic field key) pairs the
  // grid renders, so shading survives rows being added or removed above them.
  const cellErrors = useMemo(() => {
    const hubKeyToSynthetic: Record<string, string> = {};
    Object.entries(syntheticToHubKey).forEach(([synthetic, hubFieldKey]) => {
      hubKeyToSynthetic[hubFieldKey] = synthetic;
    });

    const result: Record<string, string> = {};
    rows.forEach((row, rowIndex) => {
      if (!row.errors) return;
      Object.entries(row.errors).forEach(([hubFieldKey, message]) => {
        const fieldKey = hubKeyToSynthetic[hubFieldKey];
        if (fieldKey) result[`${rowIndex}:${fieldKey}`] = message;
      });
    });
    return result;
  }, [rows, syntheticToHubKey]);

  /**
   * Commit any number of cells. Writes are grouped by row so a pasted or
   * drag-filled block costs one request per touched row instead of one per
   * cell, and every cell in a row lands in a single atomic Hub update.
   */
  const handleCellsEdit = useCallback(
    (writes: CellWrite[]) => {
      if (!writes.length) return;

      // Row index -> the hub-field changes destined for that row.
      const changesByLocalId = new Map<string, Record<string, any>>();
      const previousByLocalId = new Map<string, Record<string, any>>();

      writes.forEach(({ fieldKey, rowIndex, value }) => {
        const hubFieldKey = syntheticToHubKey[fieldKey];
        const target = rowsRef.current[rowIndex];
        if (!hubFieldKey || !target) return;

        const changes = changesByLocalId.get(target.localId) ?? {};
        changes[hubFieldKey] = value;
        changesByLocalId.set(target.localId, changes);

        const previous = previousByLocalId.get(target.localId) ?? {};
        // Only the FIRST value seen for a cell is the pre-edit one to roll
        // back to; a later write in the same batch is itself an edit.
        if (!(hubFieldKey in previous)) {
          previous[hubFieldKey] = target.data[hubFieldKey];
        }
        previousByLocalId.set(target.localId, previous);
      });

      if (!changesByLocalId.size) return;

      // One commit for the whole batch, so a large paste is a single render.
      commitRows(
        rowsRef.current.map((row) => {
          const changes = changesByLocalId.get(row.localId);
          if (!changes) return row;
          return {
            ...row,
            data: { ...row.data, ...changes },
            errors: omitKeys(row.errors, Object.keys(changes))
          };
        })
      );
      setErrors([]);

      changesByLocalId.forEach((changes, localId) => {
        enqueue(async () => {
          if (!hubId || !client?.dataHubAction) return;
          const row = rowsRef.current.find((r) => r.localId === localId);
          if (!row) return;
          const changedKeys = Object.keys(changes);
          try {
            if (row.entryId) {
              const result = await client.dataHubAction({
                hubId,
                operation: 'update',
                // Update defaults to the verified set, so correcting a staged
                // row has to name it explicitly.
                ...(row.verified ? {} : { verification: 'unverified' }),
                where: [{ entryId: row.entryId }],
                data: Object.fromEntries(
                  changedKeys.map((key) => [key, row.data[key]])
                )
              });
              // The Hub answers 200 with a count, so a row that matched
              // nothing — deleted or verified elsewhere since it was loaded —
              // is a failure the caller has to notice for itself.
              if (result?.updated === 0) throw new Error(ROW_GONE_MESSAGE);
              // A staged row is stored even when it breaks a field rule, and
              // the Hub reports the rule it broke alongside the success. Keep
              // it on the cells so the grid can flag them; the row is
              // unverified, so the table treats it as a warning.
              if (result?.error) {
                updateRow(localId, (r) => ({
                  ...r,
                  errors: {
                    ...r.errors,
                    ...Object.fromEntries(
                      changedKeys.map((key) => [key, result.error])
                    )
                  }
                }));
              }
              return;
            }
            // Rows stay provisional until their first edit, so the first edit
            // is what creates them (an empty row would just fail required
            // fields).
            const created: HubEntry | null = await client.dataHubAction({
              hubId,
              operation: 'create',
              data: row.data
            });
            if (!created?.id) {
              throw new Error('Data Hub did not return a row ID');
            }
            updateRow(localId, (r) => ({
              ...r,
              entryId: created.id,
              data: { ...r.data, ...created.data }
            }));
          } catch (error) {
            const messages = errorMessages(error);
            const message = messages[0];
            const previous = previousByLocalId.get(localId) ?? {};
            updateRow(localId, (r) => ({
              ...r,
              // A failed create keeps the typed values so the user can fix and
              // retry; a failed update has stored values to fall back to.
              data: r.entryId ? { ...r.data, ...previous } : r.data,
              errors: {
                ...r.errors,
                ...Object.fromEntries(changedKeys.map((key) => [key, message]))
              }
            }));
            setErrors(messages);
          }
        });
      });
    },
    [syntheticToHubKey, commitRows, updateRow, enqueue, hubId, client]
  );

  const handleCellEdit = useCallback(
    (fieldKey: string, rowIndex: number, newValue: any) => {
      handleCellsEdit([{ fieldKey, rowIndex, value: newValue }]);
    },
    [handleCellsEdit]
  );

  const handleInsertRow = useCallback(
    (atIndex: number) => {
      const data = Object.fromEntries(
        Object.values(syntheticToHubKey).map((hubFieldKey) => [hubFieldKey, ''])
      );
      const rows = rowsRef.current;
      const at = Math.max(0, Math.min(atIndex, rows.length));
      commitRows([
        ...rows.slice(0, at),
        {
          localId: `new:${nextLocalId.current++}`,
          entryId: null,
          data,
          // A row the user just added is theirs to fill in, never staged data.
          verified: true
        },
        ...rows.slice(at)
      ]);
      setErrors([]);
    },
    [syntheticToHubKey, commitRows]
  );

  const handleAddRow = useCallback(() => handleInsertRow(0), [handleInsertRow]);

  // A row with no entry yet exists only here. Besides being what Discard
  // should take back, it also holds off every background refetch (see
  // `refetch`), so leaving one behind would keep the table stale for good.
  const discardNewRows = useCallback(() => {
    const kept = rowsRef.current.filter((row) => row.entryId != null);
    if (kept.length !== rowsRef.current.length) commitRows(kept);
  }, [commitRows]);

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
          const result = await client.dataHubAction({
            hubId,
            operation: 'delete',
            ...(target.verified ? {} : { verification: 'unverified' }),
            where: [{ entryId: target.entryId as string }]
          });
          // Zero matches means the Hub's copy has moved on (the row was
          // verified or removed elsewhere); the local removal has to be
          // undone so the table keeps matching the Hub.
          if (result?.deleted === 0) throw new Error(ROW_GONE_MESSAGE);
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
    cellErrors,
    cellRules,
    rowVerified,
    canAddRows: verification !== 'unverified',
    refetch,
    handleCellEdit,
    handleCellsEdit,
    handleAddRow,
    handleInsertRow,
    handleDeleteRow,
    discardNewRows
  };
}

function omitKeys(
  source: Record<string, string> | undefined,
  keys: string[]
): Record<string, string> | undefined {
  if (!source) return undefined;
  const remaining = Object.entries(source).filter(
    ([key]) => !keys.includes(key)
  );
  return remaining.length ? Object.fromEntries(remaining) : undefined;
}
