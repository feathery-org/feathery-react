import internalState from '../internalState';
import { initState } from '../init';
import { loadPhoneValidator, phoneLib, phoneLibPromise } from '../validation';
import { stateMap } from '../../elements/components/data/states';
import {
  availableRowOptions,
  getRepeatedContainer,
  isTakenByOtherRow
} from '../repeat';
import { getPositionKey } from '../hideAndRepeats';
import { formatDateString } from '../../elements/fields/DateSelectorField/utils';
import { isMaskedValue, maskFieldValue } from '../sensitiveFieldValues';
import { getDefaultFieldValue } from '../fieldHelperFunctions';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  InlineErrorReport,
  markInteraction,
  NOT_LOADED_MESSAGE,
  snapshotInlineErrors,
  validateRepeatIndex
} from './utils';

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
  'gmap_zip',
  'pin_input'
]);
const NUMERIC_TYPES = new Set(['integer_field', 'slider', 'rating']);
const SINGLE_CHOICE_TYPES = new Set(['dropdown', 'select']);
const MULTI_CHOICE_TYPES = new Set([
  'dropdown_multi',
  'multiselect',
  'button_group'
]);
const WRITABLE_TYPES = new Set([
  ...TEXT_TYPES,
  ...NUMERIC_TYPES,
  ...SINGLE_CHOICE_TYPES,
  ...MULTI_CHOICE_TYPES,
  'checkbox',
  'date_selector',
  'matrix'
]);

export const isEmptyValue = (value: unknown) =>
  value === null || value === '' || (Array.isArray(value) && !value.length);

// What each field holds when nothing is entered, so a clear never stores a value the field can't render
export function emptyValueFor(
  servar: any,
  repeatIndex?: number,
  fieldValue?: unknown
): unknown {
  if (MULTI_CHOICE_TYPES.has(servar.type)) return [];
  if (servar.type === 'select') return null;
  if (servar.type === 'checkbox') return !!servar.metadata?.always_checked;
  if (servar.type === 'rating') return 0;
  if (servar.type === 'slider') return servar.min_length ?? 0;
  if (servar.type === 'matrix')
    return readOnlyMatrixAnswers(servar, repeatIndex, fieldValue);
  return '';
}

// Read-only matrix questions keep the answers the form shows, or their defaults before it shows any
export function readOnlyMatrixAnswers(
  servar: any,
  repeatIndex: number | undefined,
  fieldValue: unknown
): Record<string, string[]> {
  const readOnlyQuestions = (servar.metadata?.questions ?? []).filter(
    (q: any) => q?.read_only
  );
  if (!readOnlyQuestions.length) return {};
  const shown =
    typeof repeatIndex === 'number' && Array.isArray(fieldValue)
      ? fieldValue[repeatIndex]
      : fieldValue;
  const answers =
    shown && typeof shown === 'object' && !Array.isArray(shown)
      ? (shown as Record<string, unknown>)
      : getDefaultFieldValue({ servar });
  return Object.fromEntries(
    readOnlyQuestions.map((q: any) => [
      q.id,
      Array.isArray(answers[q.id]) ? answers[q.id] : []
    ])
  );
}

function checkMatrixValue(
  servar: any,
  value: unknown,
  repeatIndex: number | undefined
): string | null {
  const key = servar.key;
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return `Field '${key}' (matrix) expects an object of questionId -> string[].`;
  const answersByQuestion = value as Record<string, unknown>;

  const questions = servar.metadata?.questions ?? [];
  const questionIds = new Set(questions.map((q: any) => q?.id));
  const readOnlyIds = new Set(
    questions.filter((q: any) => q?.read_only).map((q: any) => q.id)
  );
  const options = resolveOptions(servar, repeatIndex);
  const optionValues = new Set(options.map((o) => o.value));
  for (const [questionId, answers] of Object.entries(answersByQuestion)) {
    if (!questionIds.has(questionId))
      return `Field '${key}' (matrix) has no question '${questionId}'. Questions: ${[
        ...questionIds
      ].join(', ')}.`;
    // Read-only answers are overwritten with the shown ones
    if (readOnlyIds.has(questionId)) continue;
    if (!Array.isArray(answers) || !answers.every((a) => typeof a === 'string'))
      return `Field '${key}' (matrix) question '${questionId}' expects a string[].`;
    if (!servar.metadata?.multiple && answers.length > 1)
      return `Field '${key}' (matrix) allows one answer per question, question '${questionId}' got ${answers.length}.`;
    const bad = answers.filter((a) => !optionValues.has(a));
    if (bad.length > 0)
      return `Values not in allowed options for question '${questionId}': ${bad.join(
        ', '
      )}. Allowed: ${describeOptions(options)}.`;
  }

  return null;
}

type FillRejectReason =
  | 'not_on_step'
  | 'hidden'
  | 'disabled'
  | 'unwritable_type'
  | 'invalid_value'
  | 'invalid_row'
  | 'write_failed';

type FillValidation =
  | { ok: true; field: any; servar: any; value: unknown }
  | { ok: false; reason: FillRejectReason; message: string };

export type FillFieldInput = {
  key: string;
  value: unknown;
  repeatIndex?: number;
};

type AppliedField = {
  key: string;
  repeatIndex?: number;
  value: unknown;
  priorValue: unknown;
};

type RejectedField = {
  key: string;
  repeatIndex?: number;
  reason: FillRejectReason;
  message: string;
};

export type FillFieldsResult =
  | {
      ok: true;
      applied: AppliedField[];
      rejected: RejectedField[];
      fieldErrors?: InlineErrorReport[];
    }
  | { ok: false; reason: 'not_loaded'; message: string };

function validateFill(
  state: any,
  fieldKey: string,
  rawValue: unknown,
  repeatIndex: number | undefined,
  fieldValue: unknown
): FillValidation {
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
      reason: 'not_on_step',
      message: `Field '${fieldKey}' is not on the current step. Available field keys here: ${available}.`
    };
  }
  const servar = found.servar ?? {};
  const type = servar.type;

  const visiblePositions = state.visiblePositions ?? {};
  const flags = visiblePositions[getPositionKey(found) ?? 'root'];
  if (Array.isArray(flags) && !flags.some(Boolean)) {
    return {
      ok: false,
      reason: 'hidden',
      message: `Field '${fieldKey}' is on the current step but is hidden right now.`
    };
  }

  const formReadOnly = !!(
    state.formSettings?.readOnly || initState.collaboratorReview === 'readOnly'
  );
  if (found.properties?.disabled || formReadOnly) {
    return {
      ok: false,
      reason: 'disabled',
      message: `Field '${fieldKey}' is disabled and cannot be written.`
    };
  }
  if (!WRITABLE_TYPES.has(type)) {
    return {
      ok: false,
      reason: 'unwritable_type',
      message: `Field '${fieldKey}' (${type}) cannot be filled for the person, they have to provide it themselves.`
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
  if (repeatFailure)
    return { ok: false, reason: 'invalid_row', message: repeatFailure };

  // Reject writes to a row hidden by a per-row rule
  if (
    typeof repeatIndex === 'number' &&
    Array.isArray(flags) &&
    !flags[repeatIndex]
  ) {
    return {
      ok: false,
      reason: 'hidden',
      message: `Row ${repeatIndex} of field '${fieldKey}' is hidden right now.`
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
  const shapeError = checkValueAgainstField(
    servar,
    value,
    repeatIndex,
    fieldValue
  );
  if (shapeError)
    return { ok: false, reason: 'invalid_value', message: shapeError };

  return { ok: true, field: found, servar, value };
}

export function resolveOptions(
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
  const rawLabels = Array.isArray(meta.option_labels) ? meta.option_labels : [];
  return rawOptions.map((value: any, i: number) => ({
    value: String(value ?? ''),
    label: String(rawLabels[i] || value || '')
  }));
}

// Values with their labels where they differ, so a caller can both refill and ask the person
export function describeOptions(
  options: Array<{ value: string; label: string }>
): string {
  return options
    .map((o) => (o.label === o.value ? o.value : `${o.value} ("${o.label}")`))
    .join(', ');
}

export function checkValueAgainstField(
  servar: any,
  value: unknown,
  repeatIndex: number | undefined,
  fieldValue?: unknown
): string | null {
  const type = servar.type;
  const key = servar.key;
  const meta = servar.metadata ?? {};
  if (isMaskedValue(value)) {
    return `Field '${key}' was given a masked value, ask the person for the real one.`;
  }
  const minLength =
    typeof servar.min_length === 'number' ? servar.min_length : undefined;
  const maxLength =
    typeof servar.max_length === 'number' ? servar.max_length : undefined;

  // An empty value clears the field, which is how an earlier entry is undone
  if (isEmptyValue(value)) return null;

  if (type === 'matrix') return checkMatrixValue(servar, value, repeatIndex);

  // Boolean field
  if (type === 'checkbox') {
    if (typeof value !== 'boolean')
      return `Field '${key}' (checkbox) expects a boolean.`;
    return meta.always_checked && !value
      ? `Field '${key}' is always checked and cannot be unchecked.`
      : null;
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
    if (meta.choose_time) {
      return !/T\d{2}:\d{2}/.test(value) || Number.isNaN(Date.parse(value))
        ? `Field '${key}' expects an ISO date-time like '2026-10-06T14:30:00Z'.`
        : null;
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
    const options = resolveOptions(servar, repeatIndex);
    if (options.length > 0 && !options.some((o) => o.value === value)) {
      return `Value not in allowed options. Allowed: ${describeOptions(
        options
      )}.`;
    }
    // A row with its own options ignores other rows' picks, as the dropdown does
    if (
      typeof repeatIndex === 'number' &&
      !Array.isArray(meta.repeat_options?.[repeatIndex]) &&
      Array.isArray(fieldValue) &&
      isTakenByOtherRow(servar, value, fieldValue, fieldValue[repeatIndex])
    ) {
      const open = availableRowOptions(
        servar,
        options,
        fieldValue,
        repeatIndex
      );
      return `'${value}' is already chosen in another row. Still open: ${
        open.length > 0 ? describeOptions(open) : 'none'
      }.`;
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

export function normalizePhone(
  value: unknown,
  servar: any,
  state: any,
  fieldKey: string
): unknown {
  // Coerce to string, libphonenumber-js handles formatting and a leading '+'
  const incoming =
    typeof value === 'number'
      ? String(Math.trunc(value))
      : typeof value === 'string'
      ? value
      : '';
  if (!incoming.replace(/\D/g, '') || !phoneLib) return value;

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

export async function fillFields(
  formUuid: string,
  fields: FillFieldInput[]
): Promise<FillFieldsResult> {
  const requestedKeys = new Set(fields.map((f) => f.key));
  const requestsPhone = (
    internalState[formUuid]?.currentStep?.servar_fields ?? []
  ).some(
    (f: any) =>
      f?.servar?.type === 'phone_number' && requestedKeys.has(f.servar.key)
  );
  // Load the phone library first so the checks and writes below run with nothing in between
  if (requestsPhone) {
    if (!phoneLib) loadPhoneValidator();
    await phoneLibPromise;
  }

  const state = internalState[formUuid];
  const handlers = state?.formActions;
  if (!state?.currentStep || !handlers) {
    return { ok: false, reason: 'not_loaded', message: NOT_LOADED_MESSAGE };
  }

  const priorValues = new Map<string, unknown>(
    ((state.currentStep.servar_fields ?? []) as any[])
      .filter((f: any) => requestedKeys.has(f?.servar?.key))
      .map((f: any) => {
        const key = f.servar.key;
        const v = state.fields?.[key]?.value;
        return [key, v == null ? null : JSON.parse(JSON.stringify(v))];
      })
  );

  type PreparedWrite = {
    key: string;
    repeatIndex?: number;
    field: any;
    normalized: unknown;
  };

  // Resolve every value first so the writes below land in a single render
  const pendingValues = new Map(priorValues);
  const prepared: Array<PreparedWrite | RejectedField> = fields.map(
    ({ key, value, repeatIndex }) => {
      const validation = validateFill(
        state,
        key,
        value,
        repeatIndex,
        pendingValues.get(key)
      );
      if (!validation.ok) {
        return {
          key,
          repeatIndex,
          reason: validation.reason,
          message: validation.message
        };
      }
      const { field, servar } = validation;
      let normalized = isEmptyValue(validation.value)
        ? emptyValueFor(servar, repeatIndex, pendingValues.get(key))
        : validation.value;
      if (servar.type === 'matrix') {
        normalized = {
          ...(normalized as Record<string, string[]>),
          ...readOnlyMatrixAnswers(servar, repeatIndex, pendingValues.get(key))
        };
      } else if (servar.type === 'gmap_state') {
        normalized = normalizeGmapState(normalized, servar);
      } else if (servar.type === 'phone_number') {
        normalized = normalizePhone(normalized, servar, state, key);
      } else if (
        servar.type === 'date_selector' &&
        servar.metadata?.choose_time &&
        typeof normalized === 'string' &&
        normalized
      ) {
        normalized = formatDateString(new Date(normalized), servar.metadata);
      }
      // Later rows in this call see the options earlier rows took
      if (typeof repeatIndex === 'number') {
        const prior = pendingValues.get(key);
        const rows = Array.isArray(prior) ? [...prior] : [];
        rows[repeatIndex] = normalized;
        pendingValues.set(key, rows);
      }
      return { key, repeatIndex, field, normalized };
    }
  );

  const applied: AppliedField[] = [];
  const rejected: RejectedField[] = [];
  markInteraction();
  const errorsBefore = snapshotInlineErrors(state);
  const changeLogicRuns: Promise<unknown>[] = [];
  for (const write of prepared) {
    if ('reason' in write) {
      rejected.push(write);
      continue;
    }
    const index = write.repeatIndex ?? null;
    const fieldForChange =
      index === null ? write.field : { ...write.field, repeat: index };
    try {
      const changed = handlers.changeValue(
        write.normalized,
        fieldForChange,
        index
      );
      const changeLogic =
        changed && handlers.runFieldChangeLogic(fieldForChange, index);
      if (changeLogic) changeLogicRuns.push(changeLogic);
    } catch (err) {
      rejected.push({
        key: write.key,
        repeatIndex: write.repeatIndex,
        reason: 'write_failed',
        message: err instanceof Error ? err.message : String(err)
      });
      continue;
    }
    const prior = priorValues.get(write.key);
    const priorValue =
      index === null
        ? prior ?? null
        : Array.isArray(prior)
        ? prior[index] ?? null
        : null;
    const type = write.field.servar.type;
    applied.push({
      key: write.key,
      repeatIndex: write.repeatIndex,
      value: maskFieldValue(type, write.normalized),
      priorValue: maskFieldValue(type, priorValue)
    });
  }

  // Let change rules settle so the caller reads the form they produce
  await Promise.allSettled(changeLogicRuns);
  await awaitPendingInlineErrors(state);
  const fieldErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(state)
  );
  return {
    ok: true,
    applied,
    rejected,
    ...(fieldErrors.length > 0 ? { fieldErrors } : {})
  };
}
