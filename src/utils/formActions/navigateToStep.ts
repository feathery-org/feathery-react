import internalState from '../internalState';
import { ACTION_NEXT } from '../elementActions';
import { collectNavigableSteps } from '../panelRuntime';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  getLiveStepKey,
  InlineErrorReport,
  NOT_LOADED_MESSAGE,
  snapshotInlineErrors
} from './utils';

export type NavigateToStepResult =
  | {
      ok: true;
      navigated: { fromStepKey: string; toStepKey: string } | null;
      fieldErrors?: InlineErrorReport[];
    }
  | {
      ok: false;
      reason:
        | 'not_loaded'
        | 'invalid_input'
        | 'step_not_reachable'
        | 'action_failed';
      message: string;
    };

export async function navigateToStep(
  formUuid: string,
  stepKey: string
): Promise<NavigateToStepResult> {
  const state = internalState[formUuid];
  const handlers = state?.formActions;
  if (!state?.currentStep || !handlers) {
    return { ok: false, reason: 'not_loaded', message: NOT_LOADED_MESSAGE };
  }
  if (typeof stepKey !== 'string' || stepKey.length === 0) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: 'stepKey is required.'
    };
  }

  const target = collectNavigableSteps(state).find(
    (n) => n.stepKey === stepKey
  );
  if (!target) {
    return {
      ok: false,
      reason: 'step_not_reachable',
      message: `Step '${stepKey}' is not reachable through a navigation surface right now.`
    };
  }

  const fromStepKey = getLiveStepKey(state) ?? '';
  const errorsBefore = snapshotInlineErrors(state);
  try {
    await handlers.runElementActions({
      actions: [{ type: ACTION_NEXT, next_step_key: stepKey }],
      element: target.element,
      elementType: target.elementType,
      // A tab carries its own submit behavior, mirror the live tab click
      ...(target.elementType === 'tab'
        ? { submit: !!target.element.properties?.submit }
        : {})
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'action_failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const toStepKey = getLiveStepKey(state) ?? fromStepKey;
  await awaitPendingInlineErrors(state);
  const fieldErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(state)
  );
  return {
    ok: true,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(fieldErrors.length > 0 ? { fieldErrors } : {})
  };
}
