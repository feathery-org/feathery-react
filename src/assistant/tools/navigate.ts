import internalState from '../../utils/internalState';
import { ACTION_NEXT } from '../../utils/elementActions';
import { collectStepperNavigation } from './panelRuntime';
import { getLiveStepKey, snapshotInlineErrors } from './utils';

type NavigateErrorType =
  | 'step_not_allowed'
  | 'no_form_state'
  | 'shape_mismatch'
  | 'dispatch_failed';

type NavigateResult =
  | {
      ok: true;
      navigated: { fromStepKey: string; toStepKey: string } | null;
      fieldErrors?: Record<string, string>;
    }
  | {
      ok: false;
      errorType: NavigateErrorType;
      error: string;
    };

export async function dispatchNavigate(
  formUuid: string | undefined,
  stepKey: string
): Promise<NavigateResult> {
  if (!formUuid) {
    return {
      ok: false,
      errorType: 'no_form_state',
      error: 'Form has not loaded yet.'
    };
  }
  const state = internalState[formUuid];
  if (!state || !state.currentStep || !state.assistantClient) {
    return {
      ok: false,
      errorType: 'no_form_state',
      error: 'Form has not loaded yet.'
    };
  }
  if (typeof stepKey !== 'string' || stepKey.length === 0) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'stepKey is required.'
    };
  }

  const target = collectStepperNavigation(state).find(
    (n) => n.stepKey === stepKey
  );
  if (!target) {
    return {
      ok: false,
      errorType: 'step_not_allowed',
      error: `Step '${stepKey}' is not reachable through a navigation surface right now.`
    };
  }

  const client = state.assistantClient;
  const fromStepKey = getLiveStepKey(state);
  const errorsBefore = snapshotInlineErrors(state);

  try {
    await client.runActions({
      actions: [{ type: ACTION_NEXT, next_step_key: stepKey }],
      element: target.element,
      elementType: 'progress_bar'
    });
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }

  const toStepKey = getLiveStepKey(state) ?? fromStepKey;
  const errorsAfter = snapshotInlineErrors(state);

  const fieldErrors: Record<string, string> = {};
  for (const key of Object.keys(errorsAfter)) {
    if (errorsAfter[key] !== errorsBefore[key])
      fieldErrors[key] = errorsAfter[key];
  }

  return {
    ok: true,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {})
  };
}
