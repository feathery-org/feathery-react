import internalState from '../internalState';
import {
  getPanelRuntimeSnapshot,
  PanelRuntimeFieldEntry
} from '../panelRuntime';
import {
  normalizeGmapState,
  normalizePhone
} from '../../assistant/tools/setFieldValue';
import {
  decodeAndValidateFiles,
  isUnsupportedType,
  validateAndNormalizeForFill
} from './validate';
import { maskFieldValue } from './mask';
import { clearFilePathMapEntry } from '../formHelperFunctions';
import { captureRenderTick, waitForNextCommit } from './renderTick';
import { getPositionKey } from '../hideAndRepeats';
import {
  findAddRowButtonAction,
  getContainerById,
  isNestedRepeat
} from '../repeat';
import { getStepTool } from './getStep';
import { FillFieldResult, FillStepResult, RowResult } from './types';

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
  const beforeSnapshot = getPanelRuntimeSnapshot(formUuid)!;
  const visibleBefore = new Set(
    beforeSnapshot.currentStepFields.filter((f) => f.visible).map((f) => f.key)
  );

  // Terminal outcomes decided during a pass, independent of the final
  // snapshot (unsupported type, repeated field, auto-submit/navigation,
  // validation failure, a rejected change rule).
  const resolved: Record<string, FillFieldResult> = {};
  // Fields actually written (changeValue + fieldOnChange + a settled
  // awaitChangeRules), paired with the value we intended so the final pass
  // can tell 'filled' from 'changed'.
  const written = new Set<string>();
  const intendedValues: Record<string, unknown> = {};

  // One pass walks the CURRENT on-screen order and writes every visible,
  // enabled, not-yet-attempted field with a queued value. A field hidden
  // behind another (e.g. a zip that only shows once state is filled) is
  // skipped this pass and picked up once a later field's write reveals it -
  // either later in this same pass (the live re-snapshot below already sees
  // it) or in the next pass. Passes stop once one makes no progress; that's
  // guaranteed to happen since every field is attempted at most once.
  let progressed = true;
  while (progressed) {
    progressed = false;
    const passSnapshot = getPanelRuntimeSnapshot(formUuid)!;
    const onScreenOrder = passSnapshot.currentStepFields.map((f) => f.key);
    const orderedKeys = [
      ...onScreenOrder.filter((k) => inputKeys.includes(k)),
      ...inputKeys.filter((k) => !onScreenOrder.includes(k))
    ];

    for (const fieldKey of orderedKeys) {
      if (resolved[fieldKey] || written.has(fieldKey)) continue;

      // Re-read fresh for every field, not just every pass: an earlier
      // field's write this same pass may have just revealed or disabled
      // this one.
      const snapshot = getPanelRuntimeSnapshot(formUuid)!;
      const entry: PanelRuntimeFieldEntry | undefined =
        snapshot.currentStepFields.find((f) => f.key === fieldKey);

      // Not on the step at all, not yet visible, or currently disabled:
      // leave pending for a later pass (or, if nothing ever changes that,
      // for final classification to report as not_shown/disabled).
      if (!entry || !entry.visible || entry.disabled) continue;

      progressed = true;

      if (isUnsupportedType(entry.type)) {
        resolved[fieldKey] = { status: 'unsupported' };
        continue;
      }

      const rawField = findServarField(state.currentStep, fieldKey);
      const servar = rawField.servar;

      // A field whose position matches more than one repeat container has no
      // single container to add/address rows against - stays unsupported.
      if (servar.repeated && isNestedRepeat(state.currentStep, rawField)) {
        resolved[fieldKey] = {
          status: 'unsupported',
          message: 'Nested repeated sections are not supported.'
        };
        continue;
      }

      if (servar.repeated) {
        resolved[fieldKey] = await fillRepeatedField(
          formUuid,
          state,
          callbacks,
          rawField,
          fieldKey,
          entry,
          values[fieldKey]
        );
        continue;
      }

      // Autosubmit doesn't depend on the value being written, so it can be
      // checked (and short-circuited) before touching the field at all.
      const autosubmit = rawField.properties?.submit_trigger === 'auto';
      if (autosubmit) {
        resolved[fieldKey] = {
          status: 'left_for_user',
          message:
            'Filling this field would submit or navigate the form; left for the user to do themselves.'
        };
        continue;
      }

      if (servar.type === 'file_upload') {
        const decoded = decodeAndValidateFiles(servar, values[fieldKey]);
        if (!decoded.ok) {
          resolved[fieldKey] = { status: 'rejected', message: decoded.error };
          continue;
        }

        clearFilePathMapEntry(servar.key, null);
        callbacks.changeValue(
          decoded.files.map((file) => Promise.resolve(file)),
          rawField,
          null
        );
        callbacks.fieldOnChange({
          fieldID: rawField.id,
          fieldKey,
          servarId: servar.id,
          elementRepeatIndex: 0
        })({ valueRepeatIndex: 0 });

        const tickBefore = captureRenderTick(formUuid);
        try {
          await callbacks.awaitChangeRules();
        } catch (e: any) {
          resolved[fieldKey] = {
            status: 'rejected',
            message: e?.message ?? 'A change rule failed for this field.'
          };
          continue;
        }
        await waitForNextCommit(formUuid, tickBefore);

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

        // The stored value is an in-flight upload (Promise<File>), not
        // JSON-serializable - report what was written instead of re-reading
        // state, so a file field can only ever resolve here, never through
        // the generic 'changed' detection below.
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
      if (servar.type === 'gmap_state')
        normalized = normalizeGmapState(normalized, servar);
      else if (servar.type === 'phone_number')
        normalized = await normalizePhone(normalized, servar, state, fieldKey);

      // Write first, then run the navigation/auto-submit guard against the
      // value that is now live: fieldValues is a shared mutable object, so
      // changeValue has already updated it synchronously by the time
      // getNextStepKey below runs, matching what fieldOnChange's own
      // internal post-write check would see. Checking against the pre-write
      // value here (as a value-dependent "next step" condition requires)
      // would miss a navigation that fieldOnChange then triggers for real
      // once called.
      const beforeValue = internalState[formUuid]?.fields?.[fieldKey]?.value;
      callbacks.changeValue(normalized, rawField, null);

      const resolvedNextStep = callbacks.getNextStepKey({
        elementType: 'field',
        elementIDs: [rawField.id]
      });
      if (resolvedNextStep) {
        // Roll back before fieldOnChange - which would re-run this exact
        // check and actually navigate - is ever invoked.
        callbacks.changeValue(beforeValue, rawField, null);
        resolved[fieldKey] = {
          status: 'left_for_user',
          message:
            'Filling this field would submit or navigate the form; left for the user to do themselves.'
        };
        continue;
      }

      callbacks.fieldOnChange({
        fieldID: rawField.id,
        fieldKey,
        servarId: servar.id,
        elementRepeatIndex: 0
      })({});

      const tickBefore = captureRenderTick(formUuid);
      try {
        await callbacks.awaitChangeRules();
      } catch (e: any) {
        // A rejected change-rule promise stays queued for the rest of the
        // step (CallbackQueue never clears settled entries), so every later
        // awaitChangeRules() call this step would otherwise reject too.
        // Report this field and keep going rather than aborting the loop.
        resolved[fieldKey] = {
          status: 'rejected',
          message: e?.message ?? 'A change rule failed for this field.'
        };
        continue;
      }
      // The change rules have run, but this field's own write (or a rule
      // they triggered) may not be reflected in visiblePositions/inlineErrors
      // until <Form/> actually re-renders - which a debounced rerender can
      // trail by up to several hundred ms. Wait for that commit before any
      // later field in this pass reads a snapshot.
      await waitForNextCommit(formUuid, tickBefore);

      written.add(fieldKey);
      intendedValues[fieldKey] = normalized;
    }
  }

  // Classify every written field from one final snapshot, taken after the
  // last commit above has landed. This is what makes a later field's rule
  // rewriting an earlier field's value show up as 'changed' with the real
  // final value, instead of the 'filled' outcome recorded the moment this
  // field itself was written.
  const finalSnapshot = getPanelRuntimeSnapshot(formUuid)!;
  const fields: Record<string, FillFieldResult> = {};
  for (const fieldKey of inputKeys) {
    if (resolved[fieldKey]) {
      fields[fieldKey] = resolved[fieldKey];
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
      // Became visible+enabled only after passes stopped making progress;
      // nothing attempted it. Shouldn't happen given the loop above always
      // revisits a newly-visible/enabled field, but report rather than throw.
      fields[fieldKey] = { status: 'not_shown' };
      continue;
    }

    const servar = findServarField(state.currentStep, fieldKey).servar;
    const storedValue = internalState[formUuid]?.fields?.[fieldKey]?.value;
    const maskedValue = maskFieldValue(servar.type, storedValue);

    if (entry.error) {
      fields[fieldKey] = { status: 'rejected', message: entry.error };
    } else if (
      valuesEqual(servar.type, storedValue, intendedValues[fieldKey])
    ) {
      // Checked before isEmptyValue: an intentionally empty value (the
      // caller clearing a field) is a real, successful write as long as it's
      // the exact value asked for - not a rejection just because it's empty.
      fields[fieldKey] = { status: 'filled', value: maskedValue };
    } else if (isEmptyValue(storedValue, servar.type)) {
      fields[fieldKey] = { status: 'rejected', message: 'Value was rejected.' };
    } else {
      fields[fieldKey] = {
        status: 'changed',
        value: maskedValue,
        message:
          'A rule changed this field to a different value after it was filled.'
      };
    }
  }

  const newlyShown = finalSnapshot.currentStepFields
    .filter((f) => f.visible && !visibleBefore.has(f.key))
    .map((f) => f.key);
  const errors: Record<string, string> = {};
  finalSnapshot.currentStepFields.forEach((f) => {
    if (f.error) errors[f.key] = f.error;
  });

  return {
    step: finalSnapshot.activeStepKey,
    fields,
    newlyShown,
    errors,
    snapshot: getStepTool(formUuid)
  };
}

const isAbsent = (value: unknown) => value === null || value === undefined;

// values[key] for a repeated field is an array, one entry per row. Rows
// beyond the current row count are added via the container's own
// add_repeated_row path (same as a person clicking "Add another"), then every
// requested row is written row by row - changeValue/fieldOnChange/
// awaitChangeRules/render-tick wait, mirroring the scalar sequence above,
// just once per row. A row's own outcome never affects its siblings.
async function fillRepeatedField(
  formUuid: string,
  state: any,
  callbacks: any,
  rawField: any,
  fieldKey: string,
  entry: PanelRuntimeFieldEntry,
  rawValue: unknown
): Promise<FillFieldResult> {
  if (!Array.isArray(rawValue))
    return {
      status: 'rejected',
      message: `Field '${fieldKey}' (repeated) expects an array, one entry per row.`
    };

  const servar = rawField.servar;
  const containerId = entry.repeatContainerId as string;
  const requested = rawValue as unknown[];
  let rowCount = entry.rowCount ?? 0;
  // A null entry leaves its row as it is, so trailing nulls add no rows
  const neededRows = requested.reduce<number>(
    (needed, value, row) => (isAbsent(value) ? needed : row + 1),
    0
  );

  if (neededRows > rowCount) {
    const container = getContainerById(state.currentStep, containerId);
    const addAction = findAddRowButtonAction(state.currentStep, containerId);
    const maxRepeats = addAction?.max_repeats ?? null;
    // addRepeatedRow writes fieldValues synchronously (changeValue's own
    // store write), so growth is checked by that raw array length - not by
    // waiting for a commit, which never comes once max_repeats stops it (the
    // write becomes a same-reference no-op, so nothing re-renders).
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
    // Added rows only show up in visiblePositions (needed for the per-row
    // hidden check below) once <Form/> actually re-renders with them.
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
        message: `Row ${row} is past this container's row limit.`
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
      // A row is one FileInput by contract, but singleRow still rejects an
      // array here explicitly (metadata.multiple is a per-field flag, not a
      // per-row one) rather than silently keeping just [0].
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

      clearFilePathMapEntry(servar.key, row);
      callbacks.changeValue(
        files.map((file) => Promise.resolve(file)),
        rawField,
        row
      );
      callbacks.fieldOnChange({
        fieldID: rawField.id,
        fieldKey,
        servarId: servar.id,
        elementRepeatIndex: row
      })({ valueRepeatIndex: 0 });

      const tick = captureRenderTick(formUuid);
      try {
        await callbacks.awaitChangeRules();
      } catch (e: any) {
        rows[row] = {
          status: 'rejected',
          message: e?.message ?? 'A change rule failed for this row.'
        };
        continue;
      }
      await waitForNextCommit(formUuid, tick);

      writtenFileRows.push(row);
      rows[row] = {
        status: 'filled',
        value: { name: files[0].name, mimeType: files[0].type }
      };
      continue;
    }

    const validated = validateAndNormalizeForFill(servar, rowValue);
    if (!validated.ok) {
      rows[row] = { status: 'rejected', message: validated.error };
      continue;
    }

    callbacks.changeValue(validated.value, rawField, row);
    callbacks.fieldOnChange({
      fieldID: rawField.id,
      fieldKey,
      servarId: servar.id,
      elementRepeatIndex: row
    })({});

    const tick = captureRenderTick(formUuid);
    try {
      await callbacks.awaitChangeRules();
    } catch (e: any) {
      rows[row] = {
        status: 'rejected',
        message: e?.message ?? 'A change rule failed for this row.'
      };
      continue;
    }
    await waitForNextCommit(formUuid, tick);

    writtenRows.push(row);
    intendedValues[row] = validated.value;
  }

  // One submitFiles call for the whole field, after every row write lands -
  // not one per row. The entry always carries the field's entire current
  // array, so calling it per row would resend every earlier row's bytes
  // again each time (they stay in-memory Promise<File>s, not S3 paths, for
  // the rest of this session).
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

  // Classify every written row from one final snapshot, after the last
  // commit above has landed - a later row's change rule rewriting an
  // earlier row's value shows up as 'changed', mirroring the field-level
  // reclassification fillStepTool does for non-repeated fields.
  if (writtenRows.length > 0) {
    const finalEntry = getPanelRuntimeSnapshot(
      formUuid
    )!.currentStepFields.find((f) => f.key === fieldKey)!;
    const finalValues = Array.isArray(finalEntry.value) ? finalEntry.value : [];
    for (const row of writtenRows) {
      const rowError = finalEntry.errorRows?.[String(row)];
      const storedValue = finalValues[row];
      const maskedValue = maskFieldValue(servar.type, storedValue);
      if (rowError) {
        rows[row] = { status: 'rejected', message: rowError };
      } else if (valuesEqual(servar.type, storedValue, intendedValues[row])) {
        rows[row] = { status: 'filled', value: maskedValue };
      } else if (isEmptyValue(storedValue, servar.type)) {
        rows[row] = { status: 'rejected', message: 'Value was rejected.' };
      } else {
        // Unlike the field-level result, a row carries no message here - the
        // row/col position already tells the caller which row a sibling rule
        // rewrote.
        rows[row] = { status: 'changed', value: maskedValue };
      }
    }
  }

  return { status: 'repeated', rows };
}
