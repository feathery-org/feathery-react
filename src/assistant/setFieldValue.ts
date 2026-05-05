import { setFieldValues } from '../utils/init';
import internalState from '../utils/internalState';
import {
  loadPhoneValidator,
  phoneLib,
  phoneLibPromise
} from '../utils/validation';

type RuntimeFieldEntry = {
  key: string;
  type: string;
  visible: boolean;
  disabled: boolean;
  options?: Array<{ value: string; label: string }>;
  minLength?: number;
  maxLength?: number;
  multiple?: boolean;
};

type RuntimeSnapshot = {
  currentStepFields?: RuntimeFieldEntry[];
};

const UNWRITABLE_TYPES = new Set(['file_upload', 'signature']);
const TEXT_TYPES = new Set([
  'text_field',
  'text_area',
  'email',
  'phone_number',
  'url',
  'password',
  'ssn',
  'ein',
  'gmap_line_1',
  'gmap_line_2',
  'gmap_city',
  'gmap_state',
  'gmap_country',
  'gmap_zip'
]);
const NUMERIC_TYPES = new Set(['integer_field', 'slider', 'rating']);
const SINGLE_CHOICE_TYPES = new Set(['dropdown', 'radio']);
const MULTI_CHOICE_TYPES = new Set([
  'dropdown_multi',
  'multiselect',
  'checkbox_group',
  'button_group'
]);

export type ErrorType =
  | 'not_on_step'
  | 'hidden'
  | 'disabled'
  | 'unwriteable_type'
  | 'shape_mismatch';

export type ValidationResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; errorType: ErrorType };

export function validateSetFieldValue(
  fieldKey: string,
  rawValue: unknown,
  snapshot: RuntimeSnapshot | null | undefined
): ValidationResult {
  const fields = snapshot?.currentStepFields ?? [];
  const field = fields.find((f) => f.key === fieldKey);
  if (!field) {
    const available = fields.map((f) => f.key).join(', ') || '(none)';
    return {
      ok: false,
      errorType: 'not_on_step',
      error: `Field '${fieldKey}' is not on the current step. Available field keys here: ${available}.`
    };
  }
  if (!field.visible) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Field '${fieldKey}' is on the current step but is hidden right now.`
    };
  }
  if (field.disabled) {
    return {
      ok: false,
      errorType: 'disabled',
      error: `Field '${fieldKey}' is disabled and cannot be written.`
    };
  }
  if (UNWRITABLE_TYPES.has(field.type)) {
    return {
      ok: false,
      errorType: 'unwriteable_type',
      error: `Field '${fieldKey}' (${field.type}) cannot be filled by the assistant; the user has to provide this themselves.`
    };
  }

  // Phone numbers commonly arrive as numbers
  let value = rawValue;
  if (
    field.type === 'phone_number' &&
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    value = String(Math.trunc(value));
  }

  // Type and bound checks
  const shapeError = checkValueAgainstField(field, value);
  if (shapeError)
    return { ok: false, errorType: 'shape_mismatch', error: shapeError };

  return { ok: true, value };
}

function checkValueAgainstField(
  field: RuntimeFieldEntry,
  value: unknown
): string | null {
  // Boolean field
  if (field.type === 'checkbox') {
    return typeof value === 'boolean'
      ? null
      : `Field '${field.key}' (checkbox) expects a boolean.`;
  }

  // Numeric fields with min/max bounds
  if (NUMERIC_TYPES.has(field.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `Field '${field.key}' (${field.type}) expects a number.`;
    }
    if (typeof field.minLength === 'number' && value < field.minLength) {
      return `Value below minimum (${field.minLength}).`;
    }
    if (typeof field.maxLength === 'number' && value > field.maxLength) {
      return `Value above maximum (${field.maxLength}).`;
    }
    return null;
  }

  // ISO date string
  if (field.type === 'date_selector') {
    if (typeof value !== 'string') {
      return `Field '${field.key}' (date_selector) expects a string.`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `Field '${field.key}' expects ISO date 'YYYY-MM-DD'.`;
    }
    return null;
  }

  // Single-choice picker
  if (SINGLE_CHOICE_TYPES.has(field.type)) {
    if (typeof value !== 'string') {
      return `Field '${field.key}' (${field.type}) expects a single option value (string).`;
    }
    const opts = (field.options ?? []).map((o) => o.value);
    if (opts.length > 0 && !opts.includes(value)) {
      return `Value not in allowed options. Allowed: ${opts.join(', ')}.`;
    }
    return null;
  }

  if (MULTI_CHOICE_TYPES.has(field.type)) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      return `Field '${field.key}' (${field.type}) expects an array of option-value strings.`;
    }
    if (field.type === 'button_group' && !field.multiple && value.length > 1) {
      return `Field '${field.key}' (button_group) is single-select; pass at most one option.`;
    }
    const opts = new Set((field.options ?? []).map((o) => o.value));
    if (opts.size > 0) {
      const bad = (value as string[]).filter((v) => !opts.has(v));
      if (bad.length > 0) {
        return `Values not in allowed options: ${bad.join(', ')}.`;
      }
    }
    return null;
  }

  // Text fields with optional length bounds
  if (TEXT_TYPES.has(field.type)) {
    if (typeof value !== 'string') {
      return `Field '${field.key}' (${field.type}) expects a string.`;
    }
    if (typeof field.minLength === 'number' && value.length < field.minLength) {
      return `Value shorter than minimum length (${field.minLength}).`;
    }
    if (typeof field.maxLength === 'number' && value.length > field.maxLength) {
      return `Value exceeds maximum length (${field.maxLength}).`;
    }
    return null;
  }
  return null;
}

export async function applyServarValues(
  formUuid: string | undefined,
  entries: Array<{ fieldKey: string; value: unknown }>
): Promise<void> {
  if (!formUuid || entries.length === 0) return;
  const state = internalState[formUuid];
  if (!state) return;

  const payload: Record<string, never> = {};
  for (const { fieldKey, value } of entries) {
    payload[fieldKey] = (await normalizeIfPhone(
      value,
      fieldKey,
      state
    )) as never;
  }
  setFieldValues(payload, true, true);
}

async function normalizeIfPhone(
  value: unknown,
  fieldKey: string,
  state: any
): Promise<unknown> {
  // Skip non-phone fields
  const servar = findServar(state, fieldKey);
  if (!servar || servar.type !== 'phone_number') return value;

  // Coerce to string; let libphonenumber-js handle formatting and a leading '+'.
  const incoming =
    typeof value === 'number'
      ? String(Math.trunc(value))
      : typeof value === 'string'
      ? value
      : '';
  if (!incoming.replace(/\D/g, '')) return value;

  // Load the phone library lazily
  if (!phoneLib) loadPhoneValidator();
  await phoneLibPromise;
  if (!phoneLib) return value;

  // Parse against the resolved country
  const country = resolveCountry(state, fieldKey, servar);
  const parsed = (() => {
    try {
      return phoneLib.parsePhoneNumber(incoming, country as any);
    } catch {
      return undefined;
    }
  })();
  if (parsed?.isValid()) return parsed.number.replace(/^\+/, '');
  return value;
}

function resolveCountry(state: any, fieldKey: string, servar: any): string {
  const existing = state.fields?.[fieldKey]?.value;
  if (existing && typeof existing === 'string' && phoneLib) {
    try {
      const parsed = phoneLib.parsePhoneNumber(`+${existing}`);
      if (parsed?.country) return parsed.country;
    } catch {
      // Ignore
    }
  }
  const dc = servar.metadata?.default_country;
  return dc && dc !== 'auto' ? dc : 'US';
}

function findServar(state: any, fieldKey: string): any {
  const steps = state.steps ?? {};
  for (const stepKey of Object.keys(steps)) {
    const fields = steps[stepKey]?.servar_fields ?? [];
    const found = fields.find((f: any) => f?.servar?.key === fieldKey);
    if (found) return found.servar;
  }
  return null;
}
