import internalState from '../internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';
import { findAddRowButtonAction } from '../repeat';
import { maskFieldValue } from './mask';
import { GetStepResult, RepeatGroup } from './types';

export const getStepTool = (formUuid: string): GetStepResult => {
  const snapshot = getPanelRuntimeSnapshot(formUuid);
  const currentStep = internalState[formUuid]?.currentStep;
  const rawFields = currentStep?.servar_fields ?? [];
  const labelByKey = new Map<string, string>(
    rawFields.map((f: any) => [f.servar.key, f.servar.name ?? ''])
  );
  const repeatedByKey = new Map<string, boolean>(
    rawFields.map((f: any) => [f.servar.key, !!f.servar.repeated])
  );

  const fields = (snapshot?.currentStepFields ?? []).map((f) => {
    const rawLabel = (labelByKey.get(f.key) ?? '').trim();
    // A field with no designer-set label still needs a real one for an
    // agent reading this step - fall back to the placeholder, then the key.
    const label = rawLabel || f.placeholder?.trim() || f.key;
    const repeated = repeatedByKey.get(f.key) ?? false;
    // A repeated field's value is an array, one entry per row - mask each
    // row independently rather than masking the serialized whole array.
    const value =
      repeated && Array.isArray(f.value)
        ? f.value.map((v) => maskFieldValue(f.type, v))
        : maskFieldValue(f.type, f.value);
    return {
      key: f.key,
      label,
      type: f.type,
      required: f.required,
      visible: f.visible,
      disabled: f.disabled,
      value,
      options: f.options ?? [],
      error: f.error ?? '',
      repeated,
      repeatContainerId: f.repeatContainerId ?? null,
      rowCount: typeof f.rowCount === 'number' ? f.rowCount : null,
      errorRows:
        f.errorRows && Object.keys(f.errorRows).length > 0 ? f.errorRows : null
    };
  });

  const buttons = (snapshot?.currentStepElements ?? [])
    .filter((el) => el.type === 'button')
    .map((el: any) => ({
      id: el.id,
      text: el.text,
      navigatesTo: el.navigatesTo ?? null,
      saves: el.submit
    }));

  // One entry per repeat container present on this step, in first-seen order.
  const repeatGroups: RepeatGroup[] = [];
  const groupByContainer = new Map<string, RepeatGroup>();
  fields.forEach((f) => {
    if (!f.repeatContainerId) return;
    let group = groupByContainer.get(f.repeatContainerId);
    if (!group) {
      const action = findAddRowButtonAction(currentStep, f.repeatContainerId);
      const maxRows = action ? action.max_repeats ?? null : null;
      const rowCount = f.rowCount ?? 0;
      group = {
        containerId: f.repeatContainerId,
        fieldKeys: [],
        rowCount,
        canAddRow: !!action && (maxRows === null || rowCount < maxRows),
        maxRows
      };
      groupByContainer.set(f.repeatContainerId, group);
      repeatGroups.push(group);
    }
    group.fieldKeys.push(f.key);
  });

  return {
    step: {
      id: snapshot?.currentStep.id ?? '',
      key: snapshot?.currentStep.key ?? ''
    },
    fields,
    buttons,
    repeatGroups
  };
};
