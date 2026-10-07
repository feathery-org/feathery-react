import internalState from '../internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';
import { maskFieldValue } from './mask';
import { GetStepResult } from './types';

export const getStepTool = (formUuid: string): GetStepResult => {
  const snapshot = getPanelRuntimeSnapshot(formUuid);
  const rawFields = internalState[formUuid]?.currentStep?.servar_fields ?? [];
  const labelByKey = new Map<string, string>(
    rawFields.map((f: any) => [f.servar.key, f.servar.name ?? ''])
  );

  const fields = (snapshot?.currentStepFields ?? []).map((f) => {
    const rawLabel = (labelByKey.get(f.key) ?? '').trim();
    // A field with no designer-set label still needs a real one for an
    // agent reading this step - fall back to the placeholder, then the key.
    const label = rawLabel || f.placeholder?.trim() || f.key;
    return {
      key: f.key,
      label,
      type: f.type,
      required: f.required,
      visible: f.visible,
      disabled: f.disabled,
      value: maskFieldValue(f.type, f.value),
      options: f.options ?? [],
      error: f.error ?? ''
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

  return {
    step: {
      id: snapshot?.currentStep.id ?? '',
      key: snapshot?.currentStep.key ?? ''
    },
    fields,
    buttons
  };
};
