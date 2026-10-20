import { useCallback, useEffect, useRef } from 'react';
import { fieldValues } from '../../utils/init';

// One generated form field of a data-driven container, mirroring one column
// of the container's Data Hub. `field_key` is hydrated server-side.
export type HubBinding = {
  hub_field_id: string;
  hub_field_key: string;
  field_id: string;
  field_type: string;
  field_key?: string;
};

type DataDrivenProperties = {
  hub_id?: string;
  hub_entry_field?: string;
  hub_entry_field_type?: string;
  hub_entry_field_key?: string;
  hub_bindings?: HubBinding[];
};

export type DataDrivenContainer = {
  id: string;
  properties?: DataDrivenProperties;
};

type HubAction = (options: {
  hubId: string;
  operation: 'get' | 'update';
  where?: Array<{ entryId: string }>;
  data?: Record<string, any>;
}) => Promise<any>;

type HubClient = {
  dataHubAction?: HubAction;
  submitCustom?: (values: Record<string, any>) => any;
};

// Where a bound field's value lives in the Hub, for the write-back.
type BoundField = { hubId: string; entryId: string; hubFieldKey: string };

type LoadTarget = {
  containerId: string;
  hubId: string;
  entryId: string;
  bindings: Array<HubBinding & { field_key: string }>;
};

type UseHubEntrySyncProps = {
  step: { subgrids?: DataDrivenContainer[] } | null | undefined;
  client: HubClient | null | undefined;
  updateFieldValues: (
    values: Record<string, any>,
    options?: {
      rerender?: boolean;
      clearErrors?: boolean;
      triggerErrors?: boolean;
    }
  ) => any;
  // Servar type per field key, for value conversions in both directions.
  servarTypeByKey: (fieldKey: string) => string | undefined;
  onWriteError?: (fieldKey: string, message: string) => void;
};

// Edits are coalesced per field so a keystroke burst becomes one write.
const WRITE_DEBOUNCE_MS = 300;

const isDataDriven = (container: DataDrivenContainer) => {
  const props = container.properties;
  return !!(
    props?.hub_id &&
    props.hub_entry_field_key &&
    props.hub_bindings?.some((binding) => binding.field_key)
  );
};

// The containers of a step that load a Data Hub entry into their fields.
export const dataDrivenContainers = (
  step: { subgrids?: DataDrivenContainer[] } | null | undefined
): DataDrivenContainer[] => (step?.subgrids ?? []).filter(isDataDriven);

// A Hub value shaped for the form field that shows it.
export function fromHubValue(value: any, servarType?: string) {
  if (servarType === 'checkbox') return !!value;
  if (value == null) return '';
  if (servarType === 'integer_field') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

// A form field value shaped for its Hub column. Null clears the column.
export function toHubValue(value: any, servarType?: string) {
  if (servarType === 'checkbox') return !!value;
  if (value === '' || value == null) return null;
  if (servarType === 'integer_field') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return value;
}

const errorMessage = (error: any): string => {
  const detail = error?.response?.data ?? error?.data ?? error?.payload;
  if (detail) {
    const messages: string[] = [];
    const collect = (item: any) => {
      if (typeof item === 'string') messages.push(item);
      else if (Array.isArray(item)) item.forEach(collect);
      else if (item && typeof item === 'object') {
        Object.entries(item).forEach(([key, child]) => {
          if (key !== 'constraint' && key !== 'code') collect(child);
        });
      }
    };
    collect(detail);
    if (messages.length) return messages.join(' ');
  }
  return error?.message || 'Failed to save to the Data Hub';
};

/**
 * Keeps the fields of data-driven containers in sync with one Data Hub entry
 * each: when the entry id a container points at changes, the entry is loaded
 * into the bound fields; when a bound field changes, the edit is written back.
 */
export function useHubEntrySync({
  step,
  client,
  updateFieldValues,
  servarTypeByKey,
  onWriteError
}: UseHubEntrySyncProps) {
  // `fieldValues` is mutated outside React and the form re-renders its
  // elements when a field changes, so reading the entry ids here on every
  // render is what makes a container follow its entry field.
  const targets: LoadTarget[] = dataDrivenContainers(step).map((container) => {
    const props = container.properties!;
    return {
      containerId: container.id,
      hubId: props.hub_id!,
      entryId: String(fieldValues[props.hub_entry_field_key!] ?? '').trim(),
      bindings: (props.hub_bindings ?? []).filter(
        (binding): binding is HubBinding & { field_key: string } =>
          !!binding.field_key
      )
    };
  });
  const loadKey = JSON.stringify(
    targets.map((t) => [t.containerId, t.hubId, t.entryId])
  );

  // Field key -> where its value lives in the Hub, for the fields of entries
  // that have loaded. A field of an entry that failed to load (or has no entry
  // yet) is not bound, so an edit there is never written to the wrong row.
  const boundRef = useRef<Record<string, BoundField>>({});
  const latest = useRef({
    client,
    updateFieldValues,
    servarTypeByKey,
    onWriteError,
    targets
  });
  latest.current = {
    client,
    updateFieldValues,
    servarTypeByKey,
    onWriteError,
    targets
  };
  // Bumped per load so a slower, older load cannot land on top of a newer one.
  const loadSeq = useRef(0);

  useEffect(() => {
    const { client, updateFieldValues, servarTypeByKey, targets } =
      latest.current;
    const seq = ++loadSeq.current;
    boundRef.current = {};
    if (!client?.dataHubAction) return;
    targets.forEach(async (target) => {
      if (!target.entryId) return;
      let entry: { id: string; data: Record<string, any> } | undefined;
      try {
        const result = await client.dataHubAction!({
          hubId: target.hubId,
          operation: 'get',
          where: [{ entryId: target.entryId }]
        });
        entry = Array.isArray(result) ? result[0] : result;
      } catch {
        return;
      }
      if (seq !== loadSeq.current || !entry?.data) return;
      const values: Record<string, any> = {};
      target.bindings.forEach((binding) => {
        values[binding.field_key] = fromHubValue(
          entry!.data[binding.hub_field_key],
          servarTypeByKey(binding.field_key)
        );
        boundRef.current[binding.field_key] = {
          hubId: target.hubId,
          entryId: target.entryId,
          hubFieldKey: binding.hub_field_key
        };
      });
      updateFieldValues(values, { clearErrors: false, triggerErrors: false });
      client.submitCustom?.(values);
    });
  }, [loadKey]);

  // Writes go out one at a time so edits land in the order they were made.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const writeField = useCallback((fieldKey: string, bound: BoundField) => {
    const { client, servarTypeByKey, onWriteError } = latest.current;
    if (!client?.dataHubAction) return;
    const value = toHubValue(fieldValues[fieldKey], servarTypeByKey(fieldKey));
    queueRef.current = queueRef.current
      .then(() =>
        client.dataHubAction!({
          hubId: bound.hubId,
          operation: 'update',
          where: [{ entryId: bound.entryId }],
          data: { [bound.hubFieldKey]: value }
        })
      )
      .then((result) => {
        if (result?.error) throw result;
      })
      .catch((error) => onWriteError?.(fieldKey, errorMessage(error)));
  }, []);

  // Called by the form after a field's value changed. Unbound fields are
  // ignored, so this is safe to call for every change.
  const onFieldChange = useCallback(
    (fieldKey: string) => {
      const bound = boundRef.current[fieldKey];
      if (!bound) return;
      clearTimeout(timersRef.current[fieldKey]);
      timersRef.current[fieldKey] = setTimeout(
        () => writeField(fieldKey, bound),
        WRITE_DEBOUNCE_MS
      );
    },
    [writeField]
  );

  useEffect(
    () => () => Object.values(timersRef.current).forEach(clearTimeout),
    []
  );

  return { onFieldChange };
}
