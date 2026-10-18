import internalState from '../internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';
import { getPositionKey } from '../hideAndRepeats';
import { ACTION_NEXT } from '../elementActions';
import { GetStepResult } from './types';

// Mirrors clickElement's own hidden check (formActions/clickElement.ts):
// a button hidden by a show_if rule must never be pressed on its behalf.
export const isButtonVisible = (state: any, button: any): boolean => {
  const flags = (state.visiblePositions ?? {})[
    getPositionKey(button) ?? 'root'
  ];
  return Array.isArray(flags) ? flags.some(Boolean) : true;
};

// A person can press any visible Next button; one that also submits the step
// is preferred, since only that press saves the step (and uploads its files)
export const qualifyingButton = (state: any, buttonId?: string): any | null => {
  const candidates = (state.currentStep?.buttons ?? []).filter(
    (b: any) =>
      (b.properties?.actions ?? []).some((a: any) => a?.type === ACTION_NEXT) &&
      isButtonVisible(state, b)
  );
  if (buttonId) return candidates.find((b: any) => b.id === buttonId) ?? null;
  return (
    candidates.find((b: any) => b.properties?.submit === true) ??
    candidates[0] ??
    null
  );
};

export const getStepTool = (formUuid: string): GetStepResult => {
  const snapshot = getPanelRuntimeSnapshot(formUuid, { masked: true });
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
      value: f.value,
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
    buttons,
    nextButton: qualifyingButton(internalState[formUuid] ?? {})?.id ?? null
  };
};
