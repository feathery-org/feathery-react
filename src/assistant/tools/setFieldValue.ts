import internalState from '../../utils/internalState';
import { initState } from '../../utils/init';
import {
  loadPhoneValidator,
  phoneLib,
  phoneLibPromise
} from '../../utils/validation';
import { stateMap } from '../../elements/components/data/states';
import { getRepeatedContainer } from '../../utils/repeat';
import { getPositionKey } from '../../utils/hideAndRepeats';
import { validateRepeatIndex } from './utils';

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

type FieldErrorType =
  | 'no_form_state'
  | 'not_on_step'
  | 'hidden'
  | 'disabled'
  | 'unwriteable_type'
  | 'shape_mismatch'
  | 'repeated_index_missing'
  | 'repeated_index_out_of_range'
  | 'repeated_index_unexpected'
  | 'dispatch_failed';

type ValidationResult =
  | { ok: true; field: any; servar: any; value: unknown }
  | { ok: false; errorType: FieldErrorType; error: string };

type FieldInput = {
  fieldKey?: unknown;
  value?: unknown;
  repeatIndex?: unknown;
};

type FieldResult =
  | {
      fieldKey: string;
      repeatIndex?: number;
      ok: true;
      value: unknown;
      priorValue: unknown;
    }
  | {
      fieldKey: string;
      repeatIndex?: number;
      ok: false;
      errorType: FieldErrorType;
      error: string;
    };

function validateSetFieldValue(
  state: any,
  fieldKey: string,
  rawValue: unknown,
  repeatIndex: number | undefined
): ValidationResult {
  const currentStep = state?.currentStep;
  const stepFields = currentStep?.servar_fields ?? [];
  const found = stepFields.find((f: any) => f?.servar?.key === fieldKey);
  if (!found) {
    const available =
      stepFields
        .map((f: any) => f?.servar?.key)
        .filter(Boolean)
        .join(', ') || '(none)';
    return {
      ok: false,
      errorType: 'not_on_step',
      error: `Field '${fieldKey}' is not on the current step. Available field keys here: ${available}.`
    };
  }
  const servar = found.servar ?? {};
  const type = servar.type;

  const visiblePositions = state.visiblePositions ?? {};
  const flags = visiblePositions[getPositionKey(found) ?? 'root'];
  if (Array.isArray(flags) && !flags.some(Boolean)) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Field '${fieldKey}' is on the current step but is hidden right now.`
    };
  }

  const formReadOnly = !!(
    state.formSettings?.readOnly || initState.collaboratorReview === 'readOnly'
  );
  if (found.properties?.disabled || formReadOnly) {
    return {
      ok: false,
      errorType: 'disabled',
      error: `Field '${fieldKey}' is disabled and cannot be written.`
    };
  }
  if (UNWRITABLE_TYPES.has(type)) {
    return {
      ok: false,
      errorType: 'unwriteable_type',
      error: `Field '${fieldKey}' (${type}) cannot be filled by the assistant; the user has to provide this themselves.`
    };
  }

  const repeatContainer = servar.repeated
    ? getRepeatedContainer(currentStep, found)
    : undefined;
  const rowCount = repeatContainer
    ? (visiblePositions[getPositionKey(repeatContainer) ?? 'root'] ?? []).length
    : 0;
  const repeatFailure = validateRepeatIndex(
    repeatIndex,
    !!repeatContainer,
    rowCount,
    fieldKey
  );
  if (repeatFailure) return { ok: false, ...repeatFailure };

  // Reject writes to a row hidden by a per-row rule
  if (
    typeof repeatIndex === 'number' &&
    Array.isArray(flags) &&
    !flags[repeatIndex]
  ) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Row ${repeatIndex} of field '${fieldKey}' is hidden right now.`
    };
  }

  // Phone numbers commonly arrive as numbers
  let value = rawValue;
  if (
    type === 'phone_number' &&
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    value = String(Math.trunc(value));
  }

  // Type and bound checks
  const shapeError = checkValueAgainstField(servar, value, repeatIndex);
  if (shapeError)
    return { ok: false, errorType: 'shape_mismatch', error: shapeError };

  return { ok: true, field: found, servar, value };
}

function resolveOptions(
  servar: any,
  repeatIndex: number | undefined
): Array<{ value: string; label: string }> {
  const meta = servar.metadata ?? {};
  const rawRowOptions = Array.isArray(meta.repeat_options)
    ? meta.repeat_options
    : null;
  if (
    typeof repeatIndex === 'number' &&
    rawRowOptions &&
    Array.isArray(rawRowOptions[repeatIndex])
  ) {
    return rawRowOptions[repeatIndex].map((o: any) => ({
      value: String(o?.value ?? o ?? ''),
      label: String(o?.label ?? o?.value ?? o ?? '')
    }));
  }
  const rawOptions = Array.isArray(meta.options) ? meta.options : null;
  if (!rawOptions) return [];
  const rawLabels = Array.isArray(meta.labels) ? meta.labels : [];
  return rawOptions.map((value: any, i: number) => ({
    value: String(value ?? ''),
    label: String(rawLabels[i] ?? value ?? '')
  }));
}

function checkValueAgainstField(
  servar: any,
  value: unknown,
  repeatIndex: number | undefined
): string | null {
  const type = servar.type;
  const key = servar.key;
  const meta = servar.metadata ?? {};
  const minLength =
    typeof servar.min_length === 'number' ? servar.min_length : undefined;
  const maxLength =
    typeof servar.max_length === 'number' ? servar.max_length : undefined;

  // Boolean field
  if (type === 'checkbox') {
    return typeof value === 'boolean'
      ? null
      : `Field '${key}' (checkbox) expects a boolean.`;
  }

  // Numeric fields with min/max bounds
  if (NUMERIC_TYPES.has(type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `Field '${key}' (${type}) expects a number.`;
    }
    if (typeof minLength === 'number' && value < minLength) {
      return `Value below minimum (${minLength}).`;
    }
    if (typeof maxLength === 'number' && value > maxLength) {
      return `Value above maximum (${maxLength}).`;
    }
    return null;
  }

  // ISO date string
  if (type === 'date_selector') {
    if (typeof value !== 'string') {
      return `Field '${key}' (date_selector) expects a string.`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return `Field '${key}' expects ISO date 'YYYY-MM-DD'.`;
    }
    return null;
  }

  // Single-choice picker
  if (SINGLE_CHOICE_TYPES.has(type)) {
    if (typeof value !== 'string') {
      return `Field '${key}' (${type}) expects a single option value (string).`;
    }
    const opts = resolveOptions(servar, repeatIndex).map((o) => o.value);
    if (opts.length > 0 && !opts.includes(value)) {
      return `Value not in allowed options. Allowed: ${opts.join(', ')}.`;
    }
    return null;
  }

  if (MULTI_CHOICE_TYPES.has(type)) {
    if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
      return `Field '${key}' (${type}) expects an array of option-value strings.`;
    }
    if (type === 'button_group' && !meta.multiple && value.length > 1) {
      return `Field '${key}' (button_group) is single-select; pass at most one option.`;
    }
    const opts = new Set(
      resolveOptions(servar, repeatIndex).map((o) => o.value)
    );
    if (opts.size > 0) {
      const bad = (value as string[]).filter((v) => !opts.has(v));
      if (bad.length > 0) {
        return `Values not in allowed options: ${bad.join(', ')}.`;
      }
    }
    return null;
  }

  // Text fields with optional length bounds
  if (TEXT_TYPES.has(type)) {
    if (typeof value !== 'string') {
      return `Field '${key}' (${type}) expects a string.`;
    }
    if (typeof minLength === 'number' && value.length < minLength) {
      return `Value shorter than minimum length (${minLength}).`;
    }
    if (typeof maxLength === 'number' && value.length > maxLength) {
      return `Value exceeds maximum length (${maxLength}).`;
    }
    return null;
  }
  return null;
}

function normalizeGmapState(value: unknown, servar: any): unknown {
  if (typeof value !== 'string' || !value) return value;

  const wantShort = !!servar.metadata?.store_abbreviation;
  const dc = servar.metadata?.default_country;
  const country = ((dc && dc !== 'auto' ? dc : 'us') as string).toLowerCase();
  const states = stateMap[country];
  if (!states || states.length === 0) return value;

  const lower = value.toLowerCase();
  const match = states.find(
    (s) => s.code.toLowerCase() === lower || s.name.toLowerCase() === lower
  );
  if (!match) return value;
  return wantShort ? match.code : match.name;
}

async function normalizePhone(
  value: unknown,
  servar: any,
  state: any,
  fieldKey: string
): Promise<unknown> {
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

export async function dispatchSetFieldValue(
  formUuid: string | undefined,
  fields: FieldInput[]
): Promise<{ results: FieldResult[] }> {
  const state = formUuid ? internalState[formUuid] : undefined;
  const client = state?.assistantClient;

  if (!state || !client) {
    return {
      results: fields.map((item) => {
        const fieldKey =
          typeof item?.fieldKey === 'string' ? item.fieldKey : '';
        const repeatIndex = Number.isInteger(item?.repeatIndex)
          ? (item.repeatIndex as number)
          : undefined;
        if (!fieldKey) {
          return {
            fieldKey,
            repeatIndex,
            ok: false,
            errorType: 'shape_mismatch',
            error: 'fieldKey is required.'
          };
        }
        return {
          fieldKey,
          repeatIndex,
          ok: false,
          errorType: 'no_form_state',
          error: 'Form has not loaded yet.'
        };
      })
    };
  }

  const requestedKeys = new Set(
    fields
      .map((f) => (typeof f?.fieldKey === 'string' ? f.fieldKey : ''))
      .filter(Boolean)
  );
  const priorValues = new Map<string, unknown>(
    ((state.currentStep?.servar_fields ?? []) as any[])
      .filter((f: any) => requestedKeys.has(f?.servar?.key))
      .map((f: any) => {
        const key = f.servar.key;
        const v = state.fields?.[key]?.value;
        return [key, v == null ? null : JSON.parse(JSON.stringify(v))];
      })
  );

  type ValidatedEntry = {
    fieldKey: string;
    repeatIndex: number | undefined;
    field: any;
    normalized: unknown;
  };

  // Pre-resolve everything so the writes below land in a single render
  const prepared: Array<ValidatedEntry | FieldResult> = await Promise.all(
    fields.map(async (item): Promise<ValidatedEntry | FieldResult> => {
      const fieldKey = typeof item?.fieldKey === 'string' ? item.fieldKey : '';
      const repeatIndex = Number.isInteger(item?.repeatIndex)
        ? (item.repeatIndex as number)
        : undefined;

      // Validate shape, value, and field presence on current step
      if (!fieldKey) {
        return {
          fieldKey,
          repeatIndex,
          ok: false,
          errorType: 'shape_mismatch',
          error: 'fieldKey is required.'
        };
      }
      const validation = validateSetFieldValue(
        state,
        fieldKey,
        item.value,
        repeatIndex
      );
      if (!validation.ok) {
        return {
          fieldKey,
          repeatIndex,
          ok: false,
          errorType: validation.errorType,
          error: validation.error
        };
      }

      // Normalize value for the servar type
      const { field, servar } = validation;
      let normalized = validation.value;
      if (servar.type === 'gmap_state') {
        normalized = normalizeGmapState(normalized, servar);
      } else if (servar.type === 'phone_number') {
        normalized = await normalizePhone(normalized, servar, state, fieldKey);
      }
      return { fieldKey, repeatIndex, field, normalized };
    })
  );

  const results: FieldResult[] = prepared.map((p) => {
    if ('ok' in p) return p;
    const fieldForChange =
      typeof p.repeatIndex === 'number'
        ? { ...p.field, repeat: p.repeatIndex }
        : p.field;
    try {
      client.changeValue(p.normalized, fieldForChange, p.repeatIndex ?? null);
    } catch (err) {
      return {
        fieldKey: p.fieldKey,
        repeatIndex: p.repeatIndex,
        ok: false,
        errorType: 'dispatch_failed',
        error: err instanceof Error ? err.message : String(err)
      };
    }
    const prior = priorValues.get(p.fieldKey);
    const priorValue =
      p.repeatIndex !== undefined
        ? Array.isArray(prior)
          ? prior[p.repeatIndex] ?? null
          : null
        : prior ?? null;
    return {
      fieldKey: p.fieldKey,
      repeatIndex: p.repeatIndex,
      ok: true,
      value: p.normalized,
      priorValue
    };
  });

  return { results };
}
