import internalState from '../internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';
import { getPositionKey } from '../hideAndRepeats';
import { maskFieldValue } from './mask';
import { GetStepResult } from './types';

export const getStepTool = (formUuid: string): GetStepResult => {
  const snapshot = getPanelRuntimeSnapshot(formUuid);
  const currentStep = internalState[formUuid]?.currentStep;
  const visiblePositions = internalState[formUuid]?.visiblePositions ?? {};
  const rawFields = currentStep?.servar_fields ?? [];
  const labelByKey = new Map<string, string>(
    rawFields.map((f: any) => [f.servar.key, f.servar.name ?? ''])
  );
  const repeatedByKey = new Map<string, boolean>(
    rawFields.map((f: any) => [f.servar.key, !!f.servar.repeated])
  );
  const positionKeyByKey = new Map<string, string | null>(
    rawFields.map((f: any) => [f.servar.key, getPositionKey(f)])
  );

  const fields = (snapshot?.currentStepFields ?? []).map((f) => {
    const rawLabel = (labelByKey.get(f.key) ?? '').trim();
    // Fall back to the placeholder, then the key
    const label = rawLabel || f.placeholder?.trim() || f.key;
    const repeated = repeatedByKey.get(f.key) ?? false;
    // Mask each row independently
    const value =
      repeated && Array.isArray(f.value)
        ? f.value.map((v) => maskFieldValue(f.type, v))
        : maskFieldValue(f.type, f.value);
    let hiddenRows: number[] | null = null;
    if (repeated) {
      const positionKey = positionKeyByKey.get(f.key);
      const flags = positionKey ? visiblePositions[positionKey] : undefined;
      hiddenRows = Array.isArray(flags)
        ? flags.flatMap((visible: boolean, row: number) =>
            visible ? [] : [row]
          )
        : [];
    }
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
        f.errorRows && Object.keys(f.errorRows).length > 0 ? f.errorRows : null,
      hiddenRows
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
