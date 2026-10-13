import internalState from '../internalState';
import { initState } from '../init';
import { isStepTerminal } from '../stepHelperFunctions';
import { ACTION_NEXT } from '../elementActions';
import { isButtonDisabled } from '../button';
import { validateElements } from '../validation';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  getLiveStepKey,
  snapshotInlineErrors
} from '../formActions/utils';
import {
  captureRenderTick,
  isFormMounted,
  waitForNextCommit
} from './renderTick';
import { awaitClientQueues } from './clientQueues';
import { getStepTool, qualifyingButton } from './getStep';
import { NextStepResult } from './types';

// html5 forms report a blocked submit via DOM constraint validation, not
// inlineErrors, so ask the form's own validation without displaying anything
const currentStepErrors = (state: any): Record<string, string> => {
  const { errors } = validateElements({
    step: state.currentStep,
    visiblePositions: state.visiblePositions,
    triggerErrors: false,
    errorType: 'inline',
    formRef: { current: null },
    setInlineErrors: () => {}
  });
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const first = (Array.isArray(message) ? message : [message]).find(Boolean);
    if (first) out[key] = first;
  }
  return out;
};

export async function nextStepTool(
  formUuid: string,
  input: { buttonId?: string }
): Promise<NextStepResult> {
  const state = internalState[formUuid];
  const callbacks = state?.formToolsCallbacks;
  if (!state?.currentStep || !callbacks)
    throw new Error('feathery_next_step: the form is not mounted yet.');

  const fromStep = getLiveStepKey(state) ?? state.currentStep.key;
  const button = qualifyingButton(state, input?.buttonId);
  if (!button) {
    return {
      status: 'refused',
      fromStep,
      reason: input?.buttonId
        ? `Button '${input.buttonId}' is not a visible Next button on this step.`
        : 'No visible button on this step advances the form.'
    };
  }

  const formReadOnly = !!(
    state.formSettings?.readOnly || initState.collaboratorReview === 'readOnly'
  );
  if (formReadOnly)
    return { status: 'refused', fromStep, reason: 'This form is read-only.' };

  if (
    isButtonDisabled(button, state.currentStep, state.visiblePositions, false)
  )
    return {
      status: 'refused',
      fromStep,
      reason: 'The button is disabled, so a person could not press it yet.'
    };

  // The destination the click itself takes (Form's ACTION_NEXT handling)
  const nextAction = button.properties.actions.find(
    (a: any) => a?.type === ACTION_NEXT
  );
  const resolvedKey =
    nextAction.next_step_key ??
    callbacks.getNextStepKey({
      elementType: 'button',
      elementIDs: [button.id]
    });
  // A click with no destination completes the form (goToNewStep), as does
  // reaching a terminal step
  const resolvedStep = resolvedKey ? state.steps?.[resolvedKey] : undefined;
  if (!resolvedStep || isStepTerminal(resolvedStep))
    return {
      status: 'refused',
      fromStep,
      reason: 'Advancing would complete the form.'
    };

  const errorsBefore = snapshotInlineErrors(state);
  const saveBeforeClick = state.formToolsLastSave;
  await callbacks.buttonOnClick(button);
  await awaitPendingInlineErrors(internalState[formUuid]);
  // Acknowledge the click's own save/event requests before returning
  await awaitClientQueues(state.client);

  const afterState = internalState[formUuid];
  let toStep = getLiveStepKey(afterState);
  if (toStep && toStep !== fromStep) {
    // Wait for the new step to commit, following a load rule that moves on
    let snapshot = getStepTool(formUuid);
    const leftForm = () =>
      !isFormMounted(formUuid) ||
      !toStep ||
      !internalState[formUuid]?.steps?.[toStep];
    while (snapshot.step.key !== toStep) {
      // A press that leaves this form (unmount, form switch) never commits toStep
      if (leftForm())
        return {
          status: 'refused',
          fromStep,
          reason: 'The press left this form, so the fill stopped here.'
        };
      await waitForNextCommit(formUuid, captureRenderTick(formUuid), leftForm);
      snapshot = getStepTool(formUuid);
      toStep = getLiveStepKey(afterState);
    }
    // A changed formToolsLastSave reference is required, not just a resolved
    // one, so a stale earlier save doesn't count
    const saveAfterClick = afterState?.formToolsLastSave;
    const saved =
      button.properties?.submit === true &&
      saveAfterClick !== undefined &&
      saveAfterClick !== saveBeforeClick &&
      (await saveAfterClick.then(
        () => true,
        () => false
      ));
    return { status: 'advanced', fromStep, toStep, saved, snapshot };
  }

  const newErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(afterState)
  );
  if (newErrors.length > 0) {
    const errors: Record<string, string> = {};
    newErrors.forEach((e) => (errors[e.key] = e.message));
    return { status: 'errors', fromStep, errors };
  }
  const stepErrors = currentStepErrors(afterState);
  if (Object.keys(stepErrors).length > 0)
    return { status: 'errors', fromStep, errors: stepErrors };

  return {
    status: 'no_change',
    fromStep,
    reason: 'The button click produced no navigation and no validation errors.'
  };
}
