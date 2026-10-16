import internalState from '../internalState';
import {
  getPanelRuntimeSnapshot,
  PanelRuntimeFieldEntry,
  PanelRuntimeSnapshot
} from '../panelRuntime';
import { normalizePhone } from '../formActions/fillFields';
import { loadPhoneValidator, phoneLib, phoneLibPromise } from '../validation';
import {
  decodeAndValidateFiles,
  isUnsupportedType,
  validateAndNormalizeForFill
} from './validate';
import { maskFieldValue } from './mask';
import { clearFilePathMapEntry } from '../formHelperFunctions';
import {
  captureRenderTick,
  waitForNextCommit,
  settleWrite
} from './renderTick';
import { getPositionKey } from '../hideAndRepeats';
import {
  findAddRowButtonAction,
  getContainerById,
  getRepeatedContainer,
  isNestedRepeat
} from '../repeat';
import { getStepTool, isButtonVisible } from './getStep';
import { awaitClientQueues } from './clientQueues';
import {
  FillFieldResult,
  FillStepResult,
  FormToolsStepWrites,
  RepeatedWrite,
  RowResult
} from './types';

// fillStepTool checks the form is mounted on entry, and it stays mounted for the call
const currentSnapshot = (formUuid: string): PanelRuntimeSnapshot => {
  const snapshot = getPanelRuntimeSnapshot(formUuid);
  if (!snapshot)
    throw new Error('feathery_fill_step: the form is no longer mounted.');
  return snapshot;
};

const MULTI_VALUE_TYPES = new Set([
  'dropdown_multi',
  'multiselect',
  'checkbox_group',
  'button_group'
]);

const findServarField = (step: any, fieldKey: string): any =>
  (step?.servar_fields ?? []).find((f: any) => f?.servar?.key === fieldKey);

const isEmptyValue = (value: unknown, type: string): boolean => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (type === 'matrix')
    return (
      typeof value === 'object' && Object.keys(value as object).length === 0
    );
  return false;
};

const valuesEqual = (type: string, a: unknown, b: unknown): boolean => {
  if (MULTI_VALUE_TYPES.has(type)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    const as = [...a].sort();
    const bs = [...b].sort();
    return as.length === bs.length && as.every((v, i) => v === bs[i]);
  }
  return JSON.stringify(a) === JSON.stringify(b);
};

// A write of the current value renders nothing (the commit wait would never
// end) and fires no change rule for a person either, so it is skipped.
const sameValue = (type: string, a: unknown, b: unknown) => {
  if (MULTI_VALUE_TYPES.has(type) && Array.isArray(a) && Array.isArray(b))
    return valuesEqual(type, a, b);
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
};

const LEFT_FOR_USER_MESSAGE =
  'Filling this field would submit or navigate the form; left for the user to do themselves.';

type WriteOutcome =
  | { status: 'left_for_user' }
  | { status: 'unchanged' }
  | { status: 'rejected'; message: string }
  | { status: 'written' };

// Writes through the form's own changeValue/fieldOnChange, then settles the
// change rules. The navigation guard runs against the live post-write value
// (what fieldOnChange's own check would see) and rolls back before
// fieldOnChange could actually navigate.
async function writeField(
  formUuid: string,
  callbacks: any,
  rawField: any,
  opts: {
    value: unknown;
    row: number | null;
    rollbackValue: unknown;
    onChangeOptions: Record<string, any>;
    rejectedFallback: string;
    skipUnchanged?: boolean;
    beforeChange?: () => void;
  }
): Promise<WriteOutcome> {
  const tickBefore = captureRenderTick(formUuid);
  const changed = callbacks.changeValue(opts.value, rawField, opts.row);
  if (opts.skipUnchanged && !changed) return { status: 'unchanged' };

  if (
    callbacks.getNextStepKey({
      elementType: 'field',
      elementIDs: [rawField.id]
    })
  ) {
    callbacks.changeValue(opts.rollbackValue, rawField, null);
    return { status: 'left_for_user' };
  }

  opts.beforeChange?.();
  callbacks.fieldOnChange({
    fieldID: rawField.id,
    fieldKey: rawField.servar.key,
    servarId: rawField.servar.id,
    elementRepeatIndex: opts.row ?? 0
  })(opts.onChangeOptions);

  const ruleFailure = await settleWrite(
    formUuid,
    callbacks,
    tickBefore,
    changed
  );
  if (ruleFailure !== undefined)
    return {
      status: 'rejected',
      message: ruleFailure || opts.rejectedFallback
    };
  return { status: 'written' };
}

export async function fillStepTool(
  formUuid: string,
  input: { values?: Record<string, unknown> }
): Promise<FillStepResult> {
  const state = internalState[formUuid];
  const callbacks = state?.formToolsCallbacks;
  if (!state?.currentStep || !callbacks)
    throw new Error('feathery_fill_step: the form is not mounted yet.');

  const values = input?.values ?? {};
  const inputKeys = Object.keys(values);
  const fileFieldKeys = inputKeys.filter(
    (k) => findServarField(state.currentStep, k)?.servar?.type === 'file_upload'
  );
  if (fileFieldKeys.length > 1) {
    throw new Error(
      `feathery_fill_step: at most one file field per call (got ${fileFieldKeys.join(
        ', '
      )}).`
    );
  }
  // Load the phone library once up front so phone values normalize synchronously, as fillFields does
  const requestsPhone = inputKeys.some(
    (k) =>
      findServarField(state.currentStep, k)?.servar?.type === 'phone_number'
  );
  if (requestsPhone) {
    if (!phoneLib) loadPhoneValidator();
    await phoneLibPromise;
  }

  const beforeSnapshot = currentSnapshot(formUuid);
  const visibleBefore = new Set(
    beforeSnapshot.currentStepFields.filter((f) => f.visible).map((f) => f.key)
  );

  // Outcomes decided during a pass, independent of the final snapshot
  const resolved: Record<string, FillFieldResult> = {};
  // Written fields and the value intended, so the final pass can tell
  // 'filled' from 'changed'
  const written = new Set<string>();
  const intendedValues: Record<string, unknown> = {};
  // Repeated rows written, classified in the final pass with the scalar fields
  const repeatedWrites: Record<string, RepeatedWrite> = {};

  // Each pass writes every visible, enabled, not-yet-attempted field in
  // on-screen order; a field revealed by a later write is picked up in this
  // or the next pass. Every field is attempted at most once, so passes end.
  let progressed = true;
  while (progressed) {
    progressed = false;
    const passSnapshot = currentSnapshot(formUuid);
    const onScreenOrder = passSnapshot.currentStepFields.map((f) => f.key);
    const orderedKeys = [
      ...onScreenOrder.filter((k) => inputKeys.includes(k)),
      ...inputKeys.filter((k) => !onScreenOrder.includes(k))
    ];

    for (const fieldKey of orderedKeys) {
      if (resolved[fieldKey] || written.has(fieldKey)) continue;

      // An earlier write this pass may have revealed or disabled this field
      const snapshot = currentSnapshot(formUuid);
      const entry: PanelRuntimeFieldEntry | undefined =
        snapshot.currentStepFields.find((f) => f.key === fieldKey);

      // Left pending; final classification reports not_shown/disabled
      if (!entry || !entry.visible || entry.disabled) continue;

      progressed = true;

      if (isUnsupportedType(entry.type)) {
        resolved[fieldKey] = { status: 'unsupported' };
        continue;
      }

      const rawField = findServarField(state.currentStep, fieldKey);
      const servar = rawField.servar;

      // No single container to add/address rows against
      if (servar.repeated && isNestedRepeat(state.currentStep, rawField)) {
        resolved[fieldKey] = {
          status: 'unsupported',
          message: 'Nested repeated sections are not supported.'
        };
        continue;
      }

      const autosubmit = rawField.properties?.submit_trigger === 'auto';
      if (autosubmit) {
        resolved[fieldKey] = {
          status: 'left_for_user',
          message: LEFT_FOR_USER_MESSAGE
        };
        continue;
      }

      if (servar.repeated) {
        const repeated = await fillRepeatedField(
          formUuid,
          state,
          callbacks,
          rawField,
          fieldKey,
          entry,
          values[fieldKey]
        );
        resolved[fieldKey] = repeated.result;
        if (repeated.written) repeatedWrites[fieldKey] = repeated.written;
        continue;
      }

      if (servar.type === 'file_upload') {
        const decoded = decodeAndValidateFiles(servar, values[fieldKey]);
        if (!decoded.ok) {
          resolved[fieldKey] = { status: 'rejected', message: decoded.error };
          continue;
        }

        const outcome = await writeField(formUuid, callbacks, rawField, {
          value: decoded.files.map((file) => Promise.resolve(file)),
          row: null,
          rollbackValue: internalState[formUuid]?.fields?.[fieldKey]?.value,
          onChangeOptions: { valueRepeatIndex: 0 },
          rejectedFallback: 'A change rule failed for this field.',
          beforeChange: () => clearFilePathMapEntry(servar.key, null)
        });
        if (outcome.status === 'left_for_user') {
          resolved[fieldKey] = {
            status: 'left_for_user',
            message: LEFT_FOR_USER_MESSAGE
          };
          continue;
        }
        if (outcome.status === 'rejected') {
          resolved[fieldKey] = outcome;
          continue;
        }

        try {
          await callbacks.submitFiles([
            {
              servar: {
                key: servar.key,
                [servar.type]:
                  internalState[formUuid]?.fields?.[fieldKey]?.value,
                repeated: Boolean(servar.repeated)
              },
              stepKey: state.currentStep.key
            }
          ]);
        } catch (e: any) {
          resolved[fieldKey] = {
            status: 'rejected',
            message: e?.message ?? 'Failed to save the uploaded file.'
          };
          continue;
        }

        // The stored value is an in-flight Promise<File>, so report what was
        // written rather than re-reading state
        resolved[fieldKey] = {
          status: 'filled',
          value: decoded.files.map((file) => ({
            name: file.name,
            mimeType: file.type
          }))
        };
        continue;
      }

      const validated = validateAndNormalizeForFill(servar, values[fieldKey]);
      if (!validated.ok) {
        resolved[fieldKey] = { status: 'rejected', message: validated.error };
        continue;
      }
      let normalized = validated.value;
      if (servar.type === 'phone_number')
        normalized = normalizePhone(normalized, servar, state, fieldKey);

      const beforeValue = internalState[formUuid]?.fields?.[fieldKey]?.value;
      if (sameValue(servar.type, beforeValue, normalized)) {
        written.add(fieldKey);
        intendedValues[fieldKey] = normalized;
        continue;
      }
      const outcome = await writeField(formUuid, callbacks, rawField, {
        value: normalized,
        row: null,
        rollbackValue: beforeValue,
        onChangeOptions: {},
        rejectedFallback: 'A change rule failed for this field.',
        skipUnchanged: true
      });
      if (outcome.status === 'unchanged') {
        // The form's own handling (ascii-only, always-checked) can turn the
        // write into the stored value
        written.add(fieldKey);
        intendedValues[fieldKey] = beforeValue;
        continue;
      }
      if (outcome.status === 'left_for_user') {
        resolved[fieldKey] = {
          status: 'left_for_user',
          message: LEFT_FOR_USER_MESSAGE
        };
        continue;
      }
      if (outcome.status === 'rejected') {
        resolved[fieldKey] = outcome;
        continue;
      }

      written.add(fieldKey);
      intendedValues[fieldKey] = normalized;
    }
  }

  // Classify from one final snapshot so a later field's rule rewriting an
  // earlier field's value shows up as 'changed'
  const finalSnapshot = currentSnapshot(formUuid);
  const fields: Record<string, FillFieldResult> = {};
  for (const fieldKey of inputKeys) {
    if (resolved[fieldKey]) {
      const repeated = repeatedWrites[fieldKey];
      fields[fieldKey] = repeated
        ? classifyRepeatedRows(finalSnapshot, fieldKey, repeated)
        : resolved[fieldKey];
      continue;
    }
    const entry = finalSnapshot.currentStepFields.find(
      (f) => f.key === fieldKey
    );
    if (!entry || !entry.visible) {
      fields[fieldKey] = { status: 'not_shown' };
      continue;
    }
    if (entry.disabled) {
      fields[fieldKey] = {
        status: 'disabled',
        message: 'Field is disabled and was left unfilled.'
      };
      continue;
    }
    if (!written.has(fieldKey)) {
      fields[fieldKey] = { status: 'not_shown' };
      continue;
    }
    fields[fieldKey] = classifyWrittenValue(
      formUuid,
      finalSnapshot,
      fieldKey,
      intendedValues[fieldKey]
    );
  }

  // Earlier calls on this step wrote these, and this call's rules may have
  // rewritten them since
  const stepWrites = currentStepWrites(formUuid);
  for (const [fieldKey, intended] of Object.entries(stepWrites.intended)) {
    if (!inputKeys.includes(fieldKey))
      fields[fieldKey] = classifyWrittenValue(
        formUuid,
        finalSnapshot,
        fieldKey,
        intended
      );
  }
  for (const [fieldKey, repeated] of Object.entries(stepWrites.repeated)) {
    if (!inputKeys.includes(fieldKey))
      fields[fieldKey] = classifyRepeatedRows(
        finalSnapshot,
        fieldKey,
        repeated
      );
  }
  for (const fieldKey of inputKeys) {
    delete stepWrites.intended[fieldKey];
    delete stepWrites.repeated[fieldKey];
  }
  written.forEach((fieldKey) => {
    stepWrites.intended[fieldKey] = intendedValues[fieldKey];
  });
  Object.assign(stepWrites.repeated, repeatedWrites);

  const newlyShown = finalSnapshot.currentStepFields
    .filter((f) => f.visible && !visibleBefore.has(f.key))
    .map((f) => f.key);
  const errors: Record<string, string> = {};
  finalSnapshot.currentStepFields.forEach((f) => {
    if (f.error) errors[f.key] = f.error;
  });

  // Acknowledge requests the writes queued, same as feathery_next_step
  await awaitClientQueues(state.client);

  return {
    step: finalSnapshot.activeStepKey,
    fields,
    newlyShown,
    errors,
    snapshot: getStepTool(formUuid)
  };
}

const isAbsent = (value: unknown) => value === null || value === undefined;

// values[key] is an array, one entry per row. Missing rows are added like a
// click on "Add another", then each row is written on its own; a row's outcome
// never affects its siblings.
async function fillRepeatedField(
  formUuid: string,
  state: any,
  callbacks: any,
  rawField: any,
  fieldKey: string,
  entry: PanelRuntimeFieldEntry,
  rawValue: unknown
): Promise<{ result: FillFieldResult; written?: RepeatedWrite }> {
  if (!Array.isArray(rawValue))
    return {
      result: {
        status: 'rejected',
        message: `Field '${fieldKey}' (repeated) expects an array, one entry per row.`
      }
    };

  const servar = rawField.servar;
  const containerId = entry.repeatContainerId as string;
  const requested = rawValue as unknown[];
  let rowCount = entry.rowCount ?? 0;
  // Trailing nulls add no rows
  const neededRows = requested.reduce<number>(
    (needed, value, row) => (isAbsent(value) ? needed : row + 1),
    0
  );

  // A person adds rows with the container's visible add-row button, or by
  // filling the last row of a field that adds one when set
  const addAction = findAddRowButtonAction(
    {
      buttons: (state.currentStep.buttons ?? []).filter((b: any) =>
        isButtonVisible(state, b)
      )
    },
    containerId
  );
  const canAddRows =
    !!addAction ||
    (state.currentStep.servar_fields ?? []).some(
      (f: any) =>
        f.servar?.repeat_trigger === 'set_value' &&
        getRepeatedContainer(state.currentStep, f)?.id === containerId
    );
  if (canAddRows && neededRows > rowCount) {
    const container = getContainerById(state.currentStep, containerId);
    const maxRepeats = addAction?.max_repeats ?? null;
    // Growth is checked on the raw array, not a commit: max_repeats makes
    // the write a no-op that never re-renders
    const rawRowLength = () => {
      const v = internalState[formUuid]?.fields?.[fieldKey]?.value;
      return Array.isArray(v) ? v.length : 0;
    };
    const tick = captureRenderTick(formUuid);
    let addedAny = false;
    while (rowCount < neededRows) {
      const before = rawRowLength();
      callbacks.addRepeatedRow(container, maxRepeats);
      if (rawRowLength() <= before) break; // max_repeats reached
      rowCount++;
      addedAny = true;
    }
    // visiblePositions only covers added rows after a re-render
    if (addedAny) await waitForNextCommit(formUuid, tick);
  }

  const positionKey = getPositionKey(rawField);
  const rows: RowResult[] = [];
  const writtenRows: number[] = [];
  const writtenFileRows: number[] = [];
  const intendedValues: Record<number, unknown> = {};

  for (let row = 0; row < requested.length; row++) {
    if (isAbsent(requested[row])) {
      rows[row] = { status: 'skipped' };
      continue;
    }
    if (row >= rowCount) {
      rows[row] = {
        status: 'max_repeats_exceeded',
        message: canAddRows
          ? `Row ${row} is past this container's row limit.`
          : `Row ${row} needs a new row, and this container has no way to add one.`
      };
      continue;
    }

    const flags = state.visiblePositions?.[positionKey];
    if (Array.isArray(flags) && !flags[row]) {
      rows[row] = { status: 'hidden' };
      continue;
    }

    const rowValue = requested[row];

    if (servar.type === 'file_upload') {
      // singleRow rejects an array rather than silently keeping just [0]
      const decoded = decodeAndValidateFiles(
        servar,
        Array.isArray(rowValue) ? rowValue : [rowValue],
        true
      );
      if (!decoded.ok) {
        rows[row] = { status: 'rejected', message: decoded.error };
        continue;
      }
      const files = decoded.files;

      // Rollback uses the whole pre-write array (index null skips the
      // per-row dereference); a guard hit stops the remaining rows
      const outcome = await writeField(formUuid, callbacks, rawField, {
        value: files.map((file) => Promise.resolve(file)),
        row,
        rollbackValue: internalState[formUuid]?.fields?.[fieldKey]?.value,
        onChangeOptions: { valueRepeatIndex: 0 },
        rejectedFallback: 'A change rule failed for this row.',
        beforeChange: () => clearFilePathMapEntry(servar.key, row)
      });
      if (outcome.status === 'left_for_user') {
        rows[row] = {
          status: 'left_for_user',
          message: LEFT_FOR_USER_MESSAGE
        };
        break;
      }
      if (outcome.status === 'rejected') {
        rows[row] = outcome;
        continue;
      }

      writtenFileRows.push(row);
      rows[row] = {
        status: 'filled',
        value: { name: files[0].name, mimeType: files[0].type }
      };
      continue;
    }

    const validated = validateAndNormalizeForFill(
      servar,
      rowValue,
      row,
      internalState[formUuid]?.fields?.[fieldKey]?.value
    );
    if (!validated.ok) {
      rows[row] = { status: 'rejected', message: validated.error };
      continue;
    }
    const normalized =
      servar.type === 'phone_number'
        ? normalizePhone(validated.value, servar, state, fieldKey)
        : validated.value;

    const beforeFieldValue = internalState[formUuid]?.fields?.[fieldKey]?.value;
    if (
      Array.isArray(beforeFieldValue) &&
      sameValue(servar.type, beforeFieldValue[row], normalized)
    ) {
      writtenRows.push(row);
      intendedValues[row] = normalized;
      continue;
    }
    const outcome = await writeField(formUuid, callbacks, rawField, {
      value: normalized,
      row,
      rollbackValue: beforeFieldValue,
      onChangeOptions: {},
      rejectedFallback: 'A change rule failed for this row.',
      skipUnchanged: true
    });
    if (outcome.status === 'unchanged') {
      writtenRows.push(row);
      intendedValues[row] = (
        internalState[formUuid].fields[fieldKey].value as any[]
      )[row];
      continue;
    }
    if (outcome.status === 'left_for_user') {
      rows[row] = {
        status: 'left_for_user',
        message: LEFT_FOR_USER_MESSAGE
      };
      break;
    }
    if (outcome.status === 'rejected') {
      rows[row] = outcome;
      continue;
    }

    writtenRows.push(row);
    intendedValues[row] = normalized;
  }

  // Once per field: the entry carries the whole array, so per-row calls
  // would resend earlier rows' bytes
  if (writtenFileRows.length > 0) {
    try {
      await callbacks.submitFiles([
        {
          servar: {
            key: servar.key,
            [servar.type]: internalState[formUuid]?.fields?.[fieldKey]?.value,
            repeated: true
          },
          stepKey: state.currentStep.key
        }
      ]);
    } catch (e: any) {
      const message = e?.message ?? 'Failed to save the uploaded file.';
      for (const row of writtenFileRows)
        rows[row] = { status: 'rejected', message };
    }
  }

  const result: FillFieldResult = { status: 'repeated', rows };
  return writtenRows.length > 0
    ? { result, written: { servar, rows, writtenRows, intendedValues } }
    : { result };
}

// A step can take several fill_step calls; this call's record starts over once
// the form moves to another step
function currentStepWrites(formUuid: string): FormToolsStepWrites {
  const state = internalState[formUuid];
  const stepKey = state.currentStep.key;
  const existing = state.formToolsStepWrites;
  if (existing && existing.stepKey === stepKey) return existing;
  const writes: FormToolsStepWrites = { stepKey, intended: {}, repeated: {} };
  state.formToolsStepWrites = writes;
  return writes;
}

function classifyWrittenValue(
  formUuid: string,
  finalSnapshot: ReturnType<typeof currentSnapshot>,
  fieldKey: string,
  intended: unknown
): FillFieldResult {
  const entry = finalSnapshot.currentStepFields.find((f) => f.key === fieldKey);
  const servar = findServarField(
    internalState[formUuid].currentStep,
    fieldKey
  ).servar;
  const storedValue = internalState[formUuid]?.fields?.[fieldKey]?.value;
  const maskedValue = maskFieldValue(servar.type, storedValue);
  if (entry?.error) return { status: 'rejected', message: entry.error };
  // Before isEmptyValue: clearing a field is a successful write
  if (valuesEqual(servar.type, storedValue, intended))
    return { status: 'filled', value: maskedValue };
  if (isEmptyValue(storedValue, servar.type))
    return { status: 'rejected', message: 'Value was rejected.' };
  return {
    status: 'changed',
    value: maskedValue,
    message:
      'A rule changed this field to a different value after it was filled.'
  };
}

// Classify written rows from the step's final snapshot, as fillStepTool does
// for scalar fields, so a later field's rule rewriting a row shows as 'changed'
function classifyRepeatedRows(
  finalSnapshot: ReturnType<typeof currentSnapshot>,
  fieldKey: string,
  { servar, rows, writtenRows, intendedValues }: RepeatedWrite
): FillFieldResult {
  const finalEntry = finalSnapshot.currentStepFields.find(
    (f) => f.key === fieldKey
  );
  const finalValues = Array.isArray(finalEntry?.value) ? finalEntry.value : [];
  const classified = [...rows];
  for (const row of writtenRows) {
    const rowError = finalEntry?.errorRows?.[String(row)];
    const storedValue = finalValues[row];
    const maskedValue = maskFieldValue(servar.type, storedValue);
    if (rowError) {
      classified[row] = { status: 'rejected', message: rowError };
    } else if (valuesEqual(servar.type, storedValue, intendedValues[row])) {
      classified[row] = { status: 'filled', value: maskedValue };
    } else if (isEmptyValue(storedValue, servar.type)) {
      classified[row] = { status: 'rejected', message: 'Value was rejected.' };
    } else {
      classified[row] = { status: 'changed', value: maskedValue };
    }
  }
  return { status: 'repeated', rows: classified };
}
