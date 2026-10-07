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
import { getStepTool } from './getStep';
import { FillFieldResult, FillStepResult } from './types';

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

      // Repeated/array-backed fields have no row to target in this contract;
      // writing through changeValue's index===null path would stomp the
      // whole stored array with a single scalar, so refuse rather than
      // corrupt data.
      if (servar.repeated) {
        resolved[fieldKey] = {
          status: 'unsupported',
          message:
            'Repeated fields are not supported by feathery_fill_step yet.'
        };
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
