import { initState } from './init';
import internalState from './internalState';
import { markInteraction } from './formActions/utils';
import { getStandardFieldError } from './validation';
import { AnswersPendingError } from './offlineRequestHandler';

export type IntakeNameFieldIds = { first?: string; last?: string };
type NameField = {
  key: string;
  value: string;
  required: boolean;
  maxLength?: number;
};

function resolveFields(formId: string, ids: IntakeNameFieldIds) {
  const state = internalState[formId];
  if (
    !state?.currentStep ||
    !ids.first ||
    !ids.last ||
    ids.first === ids.last ||
    state.formSettings?.readOnly ||
    initState.collaboratorReview === 'readOnly' ||
    state.client?.draft ||
    state.client?.getNoSave() ||
    (initState.formSessions[state.client?.formKey]?.form_completed &&
      !state.formSettings?.allowEdits)
  )
    return null;

  const locate = (id: string) => {
    const matches = (Object.values(state.steps ?? {}) as any[]).flatMap(
      (step) =>
        (step.servar_fields ?? [])
          .filter((field: any) => field.id === id)
          .map((field: any) => ({ step, field }))
    );
    if (matches.length !== 1) return null;
    const { step, field } = matches[0];
    const servar = field.servar;
    const position = field.position ?? [];
    const ancestors = (step.subgrids ?? []).filter((grid: any) =>
      (grid.position ?? []).every(
        (entry: number, index: number) => position[index] === entry
      )
    );
    const conditionalOrHidden = (element: any) =>
      element.hide_ifs?.length ||
      element.styles?.visibility === 'hidden' ||
      element.mobile_styles?.visibility === 'hidden';
    if (
      servar?.type !== 'text_field' ||
      servar.repeated ||
      field.properties?.disabled ||
      field.validations?.length ||
      conditionalOrHidden(field) ||
      ancestors.some(
        (grid: any) => grid.repeated || conditionalOrHidden(grid)
      ) ||
      state.logicRules?.some(
        (rule: any) =>
          rule.trigger_event === 'change' && rule.elements?.includes(servar.id)
      )
    )
      return null;
    return field;
  };
  const first = locate(ids.first);
  const last = locate(ids.last);
  if (!first || !last || first.servar.id === last.servar.id) return null;
  return { state, first, last };
}

export function getIntakeNameFields(formId: string, ids: IntakeNameFieldIds) {
  const resolved = resolveFields(formId, ids);
  if (!resolved) return null;
  const describe = (field: any): NameField => ({
    key: field.servar.key,
    value: String(resolved.state.fields[field.servar.key]?.value ?? ''),
    required: !!field.servar.required,
    ...(field.servar.max_length ? { maxLength: field.servar.max_length } : {})
  });
  return { first: describe(resolved.first), last: describe(resolved.last) };
}

export async function saveIntakeNames(
  formId: string,
  ids: IntakeNameFieldIds,
  names: { first: string; last: string }
) {
  const resolved = resolveFields(formId, ids);
  if (!resolved) throw new Error('These name fields are no longer available.');
  const { state, first, last } = resolved;
  const actions = state.formActions;
  if (!actions) throw new Error('These name fields are no longer available.');
  const entries = [
    [first, names.first],
    [last, names.last]
  ] as const;
  for (const [field, value] of entries) {
    const error = getStandardFieldError(value, field.servar, null);
    if (error) throw new Error(error);
    if (field.servar.max_length && value.length > field.servar.max_length)
      throw new Error(
        `Please use at most ${field.servar.max_length} characters.`
      );
  }
  await state.formToolsCallbacks?.awaitChangeRules();
  markInteraction();
  for (const [field, value] of entries) {
    if (actions.changeValue(value, field, null))
      await actions.runFieldChangeLogic(field, null);
  }
  await state.formToolsCallbacks?.awaitChangeRules();
  const values = Object.fromEntries(
    entries.map(([field]) => [
      field.servar.key,
      state.fields[field.servar.key].value
    ])
  );
  await state.client.submitCustom(values, {
    override: true,
    shouldFlush: true
  });
  if (await state.client.offlineRequestHandler.hasQueuedAnswerWrite())
    throw new AnswersPendingError();
  return getIntakeNameFields(formId, ids);
}
