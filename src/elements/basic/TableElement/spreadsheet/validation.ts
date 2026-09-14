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

/**
 * Decimal places in a number, read off its shortest round-trip text. That
 * text turns exponential below 1e-6 and from 1e21 up — `String(1e-7)` has no
 * `.` at all — so the exponent is folded back in rather than read as 0 places
 * and waved through to a hub that then rejects it.
 */
function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const decimal = mantissa.indexOf('.');
  const mantissaPlaces = decimal === -1 ? 0 : mantissa.length - decimal - 1;
  return Math.max(0, mantissaPlaces - Number(exponent));
}

function parseDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The message for one cell, or `null` when it satisfies its column's rule.
 */
/** "A", "A or B", "A, B, or C" — a choice list a cell can show at a glance. */
function listChoices(options: string[]): string {
  if (options.length <= 1) return options[0] ?? '';
  if (options.length === 2) return `${options[0]} or ${options[1]}`;
  return `${options.slice(0, -1).join(', ')}, or ${
    options[options.length - 1]
  }`;
}

export function validateCellValue(
  value: CellValue,
  rule: CellRule
): string | null {
  if (isEmpty(value)) {
    // The hub never holds a file field to `required` — every server-side
    // required check skips FIELD_TYPE_FILE — so flagging one here would block
    // a save the hub accepts.
    return rule.required && rule.type !== 'file' ? 'Required' : null;
  }

  if (rule.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(String(value));
    if (typeof value === 'boolean' || Number.isNaN(numeric)) {
      return 'Must be a number';
    }
    if (
      rule.decimalDigits != null &&
      decimalPlaces(numeric) > rule.decimalDigits
    ) {
      return `Up to ${rule.decimalDigits} decimal ${
        rule.decimalDigits === 1 ? 'place' : 'places'
      }`;
    }
    if (rule.minValue != null && numeric < rule.minValue) {
      return `Must be at least ${rule.minValue}`;
    }
    if (rule.maxValue != null && numeric > rule.maxValue) {
      return `Must be at most ${rule.maxValue}`;
    }
    return null;
  }

  if (rule.type === 'boolean') {
    const text = String(value).trim().toLowerCase();
    if (typeof value !== 'boolean' && text !== 'true' && text !== 'false') {
      return 'Must be true or false';
    }
    return null;
  }

  const text = String(value);

  switch (rule.type) {
    case 'text':
      if (rule.options?.length && !rule.options.includes(text)) {
        return `Must be ${listChoices(rule.options)}`;
      }
      if (rule.minLength != null && text.length < rule.minLength) {
        return `At least ${rule.minLength} characters`;
      }
      if (rule.maxLength != null && text.length > rule.maxLength) {
        return `At most ${rule.maxLength} characters`;
      }
      return null;
    case 'email':
      return validators.email(text) ? null : 'Invalid email';
    case 'url':
      return validators.url(text) ? null : 'Invalid URL';
    case 'phone_number':
      // Checked as stored, not normalized: the hub matches the raw string, so
      // `(415) 555-1234` fails there and has to fail here too.
      return PHONE_PATTERN.test(text) ? null : 'Must be 7–15 digits';
    case 'tax_id':
      return TAX_ID_PATTERN.test(text) ? null : 'Must be 9 digits, no dashes';
    case 'uuid':
      return UUID_PATTERN.test(text) ? null : 'Invalid UUID';
    case 'date':
    case 'datetime': {
      const parsed = parseDate(text);
      if (parsed === null) {
        return 'Invalid date';
      }
      const now = Date.now();
      if (rule.dateRange === 'past_only' && parsed >= now) {
        return 'Must be in the past';
      }
      if (rule.dateRange === 'future_only' && parsed <= now) {
        return 'Must be in the future';
      }
      if (rule.minDate != null) {
        const min = parseDate(rule.minDate);
        if (min !== null && parsed < min) {
          return `Must be on or after ${rule.minDate}`;
        }
      }
      if (rule.maxDate != null) {
        const max = parseDate(rule.maxDate);
        if (max !== null && parsed > max) {
          return `Must be on or before ${rule.maxDate}`;
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
  /**
   * Whether the user changed this cell (or added its row) in this session.
   * Decides which of two rows sharing a unique value is the copy: the one
   * that was just touched, not the one with the higher index — new rows are
   * inserted at the TOP, so by index alone a pasted duplicate would read as
   * the original and the pre-existing row would be blamed.
   */
  isCellChanged?: (rowIndex: number, fieldKey: string) => boolean;
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
  isRowStaged,
  isCellChanged
}: ValidateGridOptions): CellErrors {
  const errors: CellErrors = {};
  const uniqueKeys = fieldKeys.filter((key) => rules[key]?.unique);
  // Field key -> normalized value -> every row holding it, in display order.
  const holders = new Map<string, Map<string, number[]>>(
    uniqueKeys.map((key) => [key, new Map<string, number[]>()])
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
      const values = holders.get(fieldKey) as Map<string, number[]>;
      const normalized = String(value);
      values.set(normalized, [...(values.get(normalized) ?? []), rowIndex]);
    });
  });

  // A shared value flags every row but its original, so the user fixes the
  // copy. The original is the first row the user did NOT touch; only when
  // every holder was touched (two pasted duplicates) does the first by index
  // get to keep the value.
  holders.forEach((values, fieldKey) => {
    values.forEach((rows) => {
      if (rows.length < 2) return;
      const original =
        rows.find((rowIndex) => !isCellChanged?.(rowIndex, fieldKey)) ??
        rows[0];
      rows.forEach((rowIndex) => {
        if (rowIndex !== original) {
          errors[cellErrorKey(rowIndex, fieldKey)] = 'Must be unique';
        }
      });
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
