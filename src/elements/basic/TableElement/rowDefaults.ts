import { HubFieldSchema } from '../../components/dataMapping/types';
import { TableRowDefault } from './types';

/**
 * The value one default puts in a new row: a static entry's value as typed, a
 * field entry's live form value. `undefined` when the source field is empty
 * or gone, so each caller decides what a blank means for its storage.
 */
export function resolveRowDefaultValue(
  entry: TableRowDefault,
  values: Record<string, any>
): any {
  if (entry.source === 'static') return entry.value ?? '';
  if (!entry.field_key) return undefined;
  const raw = values[entry.field_key];
  return raw == null || raw === '' ? undefined : raw;
}

/**
 * A field-backed table's defaults, keyed by the target column's `field_id`.
 * Entries without a resolved value are left out; later entries for the same
 * column win.
 */
export function fieldRowDefaults(
  rowDefaults: TableRowDefault[] | undefined,
  values: Record<string, any>
): Record<string, any> {
  const data: Record<string, any> = {};
  rowDefaults?.forEach((entry) => {
    if (!entry.column_field_id) return;
    const value = resolveRowDefaultValue(entry, values);
    if (value !== undefined) data[entry.column_field_id] = value;
  });
  return data;
}

/**
 * The hub column values a new row starts with, keyed by hub field key. A
 * field entry whose form field is empty or gone contributes nothing, so the
 * column stays blank rather than being set to "". Later entries for the same
 * column win.
 */
export function hubRowDefaults(
  rowDefaults: TableRowDefault[] | undefined,
  schemaFields: HubFieldSchema[] | null,
  values: Record<string, any>
): Record<string, any> {
  const data: Record<string, any> = {};
  rowDefaults?.forEach((entry) => {
    if (!entry.hub_field_id) return;
    // The live schema key once loaded (a renamed column keeps filling, a
    // deleted one is skipped); the stored key before.
    const hubFieldKey = schemaFields
      ? schemaFields.find((field) => field.id === entry.hub_field_id)?.key
      : entry.hub_field_key;
    if (!hubFieldKey) return;
    const value = resolveRowDefaultValue(entry, values);
    if (value !== undefined) data[hubFieldKey] = value;
  });
  return data;
}
