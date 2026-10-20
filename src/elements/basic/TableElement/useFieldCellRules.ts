import { useMemo } from 'react';
import internalState from '../../../utils/internalState';
import { CellRules } from './spreadsheet/validation';
import { Column } from './types';
import { ColumnField, fieldCellRules } from './fieldRules';

/** Every servar on the form, by key — the lookup a column's `field_key` needs. */
function servarsByKey(steps: Record<string, any> | undefined) {
  const byKey = new Map<string, any>();
  Object.values(steps ?? {}).forEach((step: any) => {
    (step?.servar_fields ?? []).forEach(({ servar }: any) => {
      if (servar?.key) byKey.set(servar.key, servar);
    });
  });
  return byKey;
}

// The metadata a rule is read from; the rest of a servar's metadata is noise.
const RULE_METADATA = [
  'options',
  'option_labels',
  'other',
  'creatable_options',
  'repeat_options',
  'choose_time',
  'save_mask'
];

/** The fields behind each column, with only what shapes a rule. */
function resolveColumnFields(
  columns: Column[],
  steps: Record<string, any> | undefined,
  hiddenFields: Record<string, string> | undefined
): Array<ColumnField | undefined> {
  const servars = servarsByKey(steps);
  return columns.map((column) => {
    const servar = servars.get(column.field_key);
    if (servar) {
      const metadata = servar.metadata ?? {};
      return {
        kind: 'servar',
        type: servar.type,
        metadata: Object.fromEntries(
          RULE_METADATA.filter((key) => key in metadata).map((key) => [
            key,
            metadata[key]
          ])
        )
      };
    }
    const hiddenType = hiddenFields?.[column.field_key];
    return hiddenType ? { kind: 'hidden', type: hiddenType } : undefined;
  });
}

/**
 * Column rules for a field-backed table, read off the form's own fields: the
 * step servars (type and metadata) and the hidden fields (stored value type).
 * Nothing resolves in the builder, which has no live form state and shows
 * example data anyway, so every column there edits as text.
 *
 * The form state is mutated in place — `fields[key].options = ...` rewrites a
 * servar's metadata without replacing the steps object — so the rules are
 * keyed on what was resolved, not on object identity: new options mean new
 * rules on the next render, and unchanged ones keep the same rules object.
 */
export function useFieldCellRules(
  columns: Column[],
  formId: string | undefined,
  enabled: boolean
): CellRules {
  const state = enabled && formId ? internalState[formId] : undefined;
  const fields = state
    ? resolveColumnFields(columns, state.steps, state.hiddenFields)
    : [];
  const signature = JSON.stringify(fields);

  return useMemo(
    () => {
      if (!state) return {};
      const byColumn = new Map(
        columns.map((column, index) => [column, fields[index]])
      );
      return fieldCellRules(columns, (column) => byColumn.get(column));
    },
    // `fields` is fully described by `signature`; a new array with the same
    // content must not produce new rules.
    [state, columns, signature]
  );
}
