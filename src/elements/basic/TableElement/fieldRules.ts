import { CellRule, CellRules } from './spreadsheet/validation';
import { Column } from './types';

/**
 * The form field behind a field-backed column, reduced to what a cell rule
 * needs. A column only records *which* field it shows (`field_key`, plus a
 * `field_type` of `servar` or `hidden`); the field's own type and metadata
 * live on the step, so the table has to look them up.
 */
export type ColumnField =
  | { kind: 'servar'; type: string; metadata?: Record<string, any> | null }
  | { kind: 'hidden'; type: string };

export type ResolveColumnField = (column: Column) => ColumnField | undefined;

// Stored as numbers (see `castServarVal`), so a cell parses as one too.
const NUMBER_TYPES = new Set(['integer_field', 'currency', 'rating', 'slider']);
// Upload references the grid can show but never type.
const FILE_TYPES = new Set(['file_upload', 'signature', 'audio_recording']);
// Fields whose value is ONE of a configured list. The multi-value kinds
// (multiselect, dropdown_multi, button_group, checkbox_group) are left out: a
// repeated one holds a list per row, which no single pick can stand in for.
const CHOICE_TYPES = new Set(['dropdown', 'select']);

/**
 * The option list a choice field fixes its value to, with the labels it shows
 * for them. None when the field also takes free text (an "Other" entry or
 * creatable options), or when its options differ per repeat row
 * (`repeat_options`), since then no single list is the whole story.
 */
function choiceOptions(
  metadata: Record<string, any>
): Pick<CellRule, 'options' | 'optionLabels'> | null {
  const options = Array.isArray(metadata.options)
    ? metadata.options.filter(
        (option: unknown): option is string => typeof option === 'string'
      )
    : [];
  const perRow =
    Array.isArray(metadata.repeat_options) &&
    metadata.repeat_options.some(Boolean);
  if (
    !options.length ||
    metadata.other ||
    metadata.creatable_options ||
    perRow
  ) {
    return null;
  }
  const labels = Array.isArray(metadata.option_labels)
    ? options.map((option: string, index: number) => {
        const label = metadata.option_labels[index];
        return typeof label === 'string' && label ? label : option;
      })
    : undefined;
  return labels?.some((label, index) => label !== options[index])
    ? { options, optionLabels: labels }
    : { options };
}

/**
 * The rule for a column showing a form field, or none when the field accepts
 * whatever is typed. The element stores only the field reference, so these are
 * the field's *shape* — type, options, date-vs-datetime — not its required or
 * length settings, which the step enforces on submit.
 */
export function servarCellRule(
  label: string,
  servar: { type: string; metadata?: Record<string, any> | null }
): CellRule | undefined {
  const metadata = servar.metadata ?? {};
  const type = servar.type;

  if (NUMBER_TYPES.has(type)) return { label, type: 'number' };
  if (FILE_TYPES.has(type)) return { label, type: 'file' };
  if (CHOICE_TYPES.has(type)) {
    const choices = choiceOptions(metadata);
    return choices ? { label, type: 'text', ...choices } : undefined;
  }
  switch (type) {
    case 'checkbox':
      return { label, type: 'boolean' };
    case 'email':
      return { label, type: 'email' };
    case 'url':
      return { label, type: 'url' };
    case 'date_selector':
      // `formatDateString`: a date is `yyyy-MM-dd`, a date with a time is a
      // UTC instant — exactly the two shapes the date editors read and write.
      // The field's own day limits come along; its time-of-day limits
      // (`min_time`/`max_time`) and weekday rules do not, since the cell has
      // no way to clamp the way the picker does.
      return {
        label,
        type: metadata.choose_time ? 'datetime' : 'date',
        ...(metadata.min_date ? { minDate: metadata.min_date } : {}),
        ...(metadata.max_date ? { maxDate: metadata.max_date } : {})
      };
    case 'ssn':
      // Only when stored as bare digits. With `save_mask` the value keeps its
      // separators, which the nine-digit rule (and its masking) would mangle.
      return metadata.save_mask ? undefined : { label, type: 'tax_id' };
    default:
      return undefined;
  }
}

/** The rule for a column showing a hidden field: typed by its stored value. */
export function hiddenFieldCellRule(
  label: string,
  hiddenFieldType: string
): CellRule | undefined {
  switch (hiddenFieldType) {
    case 'number_value':
      return { label, type: 'number' };
    case 'boolean_value':
      return { label, type: 'boolean' };
    default:
      return undefined;
  }
}

/**
 * Rules for a field-backed table, keyed by column storage key. A column whose
 * field cannot be resolved (deleted, or not on this form) gets no rule and
 * edits as plain text, the way every column did before.
 */
export function fieldCellRules(
  columns: Column[],
  resolve: ResolveColumnField
): CellRules {
  const rules: CellRules = {};
  columns.forEach((column) => {
    const field = resolve(column);
    if (!field) return;
    const rule =
      field.kind === 'hidden'
        ? hiddenFieldCellRule(column.name, field.type)
        : servarCellRule(column.name, field);
    if (rule) rules[column.field_key] = rule;
  });
  return rules;
}
