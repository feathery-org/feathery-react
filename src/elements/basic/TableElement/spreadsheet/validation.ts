import { validators } from '../../../../utils/validation';
import { CellValue } from './model';

/**
 * Client-side mirror of the Data Hub's field rules
 * (`apps/hub/entry_validation.py`), so a spreadsheet can count and highlight
 * bad cells as they are typed instead of only after a rejected write.
 *
 * It deliberately covers the cheap, stable rules only. Cross-field constraint
 * rules and hub-wide uniqueness stay server-side; those still come back as
 * cell errors from a save. Messages are worded like the backend's so a cell
 * does not change its wording once the server has seen it.
 */
export type CellValueType =
  | 'any'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'email'
  // Upload references (`[{url, path}]`), so the grid shows them but cannot
  // edit them — there is no typing your way to an uploaded file.
  | 'file'
  | 'number'
  | 'phone_number'
  | 'tax_id'
  | 'text'
  | 'url'
  | 'uuid';

export type CellRule = {
  /** Column name, used in messages. */
  label: string;
  type: CellValueType;
  required?: boolean;
  /** Checked against the other loaded rows only; the hub owns the real check. */
  unique?: boolean;
  options?: string[];
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  decimalDigits?: number;
  dateRange?: 'past_only' | 'future_only';
  minDate?: string;
  maxDate?: string;
};

/** Field key -> rule. A column with no entry is never flagged. */
export type CellRules = Record<string, CellRule>;

/** `${rowIndex}:${fieldKey}` -> message. */
export type CellErrors = Record<string, string>;

export const cellErrorKey = (rowIndex: number, fieldKey: string) =>
  `${rowIndex}:${fieldKey}`;

const TAX_ID_PATTERN = /^\d{9}$/;
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
// Exactly the hub's `_PHONE_RE`: digits only, no punctuation and no leading
// `+`. Anything looser here shows a cell as clean that the hub then rejects.
const PHONE_PATTERN = /^\d{7,15}$/;

function isEmpty(value: CellValue): boolean {
  return value === null || value === undefined || value === '';
}

function decimalPlaces(value: number): number {
  const text = String(value);
  const decimal = text.indexOf('.');
  if (decimal === -1) return 0;
  return text.length - decimal - 1;
}

function parseDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The message for one cell, or `null` when it satisfies its column's rule.
 */
export function validateCellValue(
  value: CellValue,
  rule: CellRule
): string | null {
  const { label } = rule;

  if (isEmpty(value)) {
    // The hub never holds a file field to `required` — every server-side
    // required check skips FIELD_TYPE_FILE — so flagging one here would block
    // a save the hub accepts.
    return rule.required && rule.type !== 'file'
      ? `Field \`${label}\` is required`
      : null;
  }

  if (rule.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value));
    if (typeof value === 'boolean' || Number.isNaN(numeric)) {
      return `Field \`${label}\` has value \`${value}\` but must be a number`;
    }
    if (
      rule.decimalDigits != null &&
      decimalPlaces(numeric) > rule.decimalDigits
    ) {
      return `Field \`${label}\` must have at most ${rule.decimalDigits} decimal digit(s)`;
    }
    if (rule.minValue != null && numeric < rule.minValue) {
      return `Field \`${label}\` must be at least ${rule.minValue}`;
    }
    if (rule.maxValue != null && numeric > rule.maxValue) {
      return `Field \`${label}\` must be at most ${rule.maxValue}`;
    }
    return null;
  }

  if (rule.type === 'boolean') {
    const text = String(value).trim().toLowerCase();
    if (typeof value !== 'boolean' && text !== 'true' && text !== 'false') {
      return `Field \`${label}\` has value \`${value}\` but must be a boolean`;
    }
    return null;
  }

  const text = String(value);

  switch (rule.type) {
    case 'text':
      if (rule.options?.length && !rule.options.includes(text)) {
        return `Field \`${label}\` must be one of: ${rule.options.join(', ')}`;
      }
      if (rule.minLength != null && text.length < rule.minLength) {
        return `Field \`${label}\` must be at least ${rule.minLength} characters`;
      }
      if (rule.maxLength != null && text.length > rule.maxLength) {
        return `Field \`${label}\` must be at most ${rule.maxLength} characters`;
      }
      return null;
    case 'email':
      return validators.email(text)
        ? null
        : `Field \`${label}\` has invalid email address \`${text}\``;
    case 'url':
      return validators.url(text)
        ? null
        : `Field \`${label}\` must be a valid URL`;
    case 'phone_number':
      // Checked as stored, not normalized: the hub matches the raw string, so
      // `(415) 555-1234` fails there and has to fail here too.
      return PHONE_PATTERN.test(text)
        ? null
        : `Field \`${label}\` phone number must be 7–15 digits`;
    case 'tax_id':
      return TAX_ID_PATTERN.test(text)
        ? null
        : `Field \`${label}\` must be exactly 9 digits with no dashes`;
    case 'uuid':
      return UUID_PATTERN.test(text)
        ? null
        : `Field \`${label}\` must be a valid UUID`;
    case 'date':
    case 'datetime': {
      const parsed = parseDate(text);
      if (parsed === null) {
        return `Field \`${label}\` must be a valid ISO datetime string`;
      }
      const now = Date.now();
      if (rule.dateRange === 'past_only' && parsed >= now) {
        return `Field \`${label}\` must be a past date`;
      }
      if (rule.dateRange === 'future_only' && parsed <= now) {
        return `Field \`${label}\` must be a future date`;
      }
      if (rule.minDate != null) {
        const min = parseDate(rule.minDate);
        if (min !== null && parsed < min) {
          return `Field \`${label}\` must be on or after ${rule.minDate}`;
        }
      }
      if (rule.maxDate != null) {
        const max = parseDate(rule.maxDate);
        if (max !== null && parsed > max) {
          return `Field \`${label}\` must be on or before ${rule.maxDate}`;
        }
      }
      return null;
    }
    case 'file':
      // The hub owns the `[{url, path}]` shape; the grid never authors it.
      return null;
    default:
      return null;
  }
}

type ValidateGridOptions = {
  /** Feathery row indices currently rendered, in display order. */
  rowIndices: number[];
  /** Storage keys of the rendered columns. */
  fieldKeys: string[];
  getValue: (rowIndex: number, fieldKey: string) => CellValue;
  rules: CellRules;
  /**
   * Whether a row is staged (unverified) Hub data. The hub checks uniqueness
   * against verified rows only, and never for a staged write, so a staged row
   * neither claims a value nor is flagged for sharing one.
   */
  isRowStaged?: (rowIndex: number) => boolean;
};

/**
 * Every failing cell in the grid. Returns a stable empty object when the table
 * has no rules, so callers can skip work without a null check.
 */
export function validateGrid({
  rowIndices,
  fieldKeys,
  getValue,
  rules,
  isRowStaged
}: ValidateGridOptions): CellErrors {
  const errors: CellErrors = {};
  const uniqueKeys = fieldKeys.filter((key) => rules[key]?.unique);
  // Field key -> normalized value -> first row index that used it.
  const seen = new Map<string, Map<string, number>>(
    uniqueKeys.map((key) => [key, new Map<string, number>()])
  );

  rowIndices.forEach((rowIndex) => {
    const staged = isRowStaged?.(rowIndex) ?? false;
    fieldKeys.forEach((fieldKey) => {
      const rule = rules[fieldKey];
      if (!rule) return;
      const value = getValue(rowIndex, fieldKey);
      const message = validateCellValue(value, rule);
      if (message) {
        errors[cellErrorKey(rowIndex, fieldKey)] = message;
        return;
      }
      if (!rule.unique || isEmpty(value) || staged) return;
      // A duplicate flags the LATER row, so the first occurrence stays clean
      // and the user fixes the copy rather than the original.
      const values = seen.get(fieldKey) as Map<string, number>;
      const normalized = String(value);
      if (values.has(normalized)) {
        errors[
          cellErrorKey(rowIndex, fieldKey)
        ] = `Field \`${rule.label}\` must be unique; value \`${normalized}\` already exists`;
      } else {
        values.set(normalized, rowIndex);
      }
    });
  });

  return errors;
}

/** Hub field schema shape this module needs. */
type HubFieldLike = {
  key: string;
  type: string;
  required?: boolean;
  unique?: boolean;
  metadata?: Record<string, any> | null;
};

const HUB_TYPES: Record<string, CellValueType> = {
  boolean: 'boolean',
  date: 'date',
  datetime: 'datetime',
  email: 'email',
  file: 'file',
  number: 'number',
  phone_number: 'phone_number',
  tax_id: 'tax_id',
  text: 'text',
  uuid: 'uuid'
};

/**
 * Rules for Hub-backed columns, keyed by the synthetic storage key the grid
 * renders. `any` fields carry no client-checkable rule beyond required; `file`
 * fields carry none at all, since the hub exempts them from required too.
 */
export function hubCellRules(
  columns: Array<{ field_key: string; name: string; hub_field_key?: string }>,
  fields: HubFieldLike[] | null
): CellRules {
  if (!fields?.length) return {};
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const rules: CellRules = {};

  columns.forEach((column) => {
    const field = column.hub_field_key
      ? byKey.get(column.hub_field_key)
      : undefined;
    if (!field) return;
    const metadata = field.metadata ?? {};
    rules[column.field_key] = {
      label: column.name,
      type: HUB_TYPES[field.type] ?? 'any',
      required: field.required,
      unique: field.unique,
      options: metadata.options,
      minLength: metadata.min_length,
      maxLength: metadata.max_length,
      minValue: metadata.min_value,
      maxValue: metadata.max_value,
      decimalDigits: metadata.decimal_digits,
      dateRange: metadata.date_range,
      minDate: metadata.min_date,
      maxDate: metadata.max_date
    };
  });

  return rules;
}

// Form field types whose value has a format a spreadsheet cell can get wrong,
// or a storage type other than text. Anything absent (text, select, …) accepts
// whatever is typed and stores it as text. Upload fields hold file references,
// which the grid can show but never edit.
const FIELD_TYPES: Record<string, CellValueType> = {
  email: 'email',
  phone_number: 'phone_number',
  url: 'url',
  integer_field: 'number',
  rating: 'number',
  slider: 'number',
  checkbox: 'boolean',
  ssn: 'tax_id',
  file_upload: 'file',
  signature: 'file',
  audio_recording: 'file'
};

/**
 * Rules for a field-backed table. The element stores only each column's form
 * field type, so these are format checks — the field's own required/length
 * settings live on the servar and are enforced when the step is submitted.
 */
export function fieldCellRules(
  columns: Array<{ field_key: string; name: string; field_type?: string }>
): CellRules {
  const rules: CellRules = {};
  columns.forEach((column) => {
    const type = FIELD_TYPES[column.field_type ?? ''];
    if (type) rules[column.field_key] = { label: column.name, type };
  });
  return rules;
}
