import internalState from '../internalState';
import { initState } from '../init';
import { isStepTerminal } from '../stepHelperFunctions';
import { hasUnsavedWork } from '../unsavedWork';
import { ACTION_NEXT } from '../elementActions';
import { getPositionKey } from '../hideAndRepeats';
import { isButtonDisabled } from '../button';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  getLiveStepKey,
  snapshotInlineErrors
} from '../../assistant/tools/utils';
import { NextStepResult } from './types';

// Grouped by the categories the contract names (identity / bank / payment /
// auth-OTP / collaboration / document-envelope-extraction-data-mapping /
// url), not by any one action's own judgment call.
const OUTSIDE_FLOW_ACTIONS = new Set([
  'trigger_persona',
  'alloy_verify_id', // identity
  'connect_account',
  'trigger_plaid',
  'trigger_flinks',
  'trigger_argyle',
  'schwab_create_contact', // bank
  'purchase_products',
  'select_product_to_purchase',
  'remove_product_from_purchase', // payment
  'trigger_oauth_login',
  'send_magic_link',
  'send_sms_code',
  'send_email_code',
  'verify_email',
  'verify_sms',
  'telesign_silent_verification',
  'telesign_phone_type',
  'telesign_voice_otp',
  'telesign_sms_otp',
  'telesign_verify_otp',
  'logout', // auth / magic link / OTP
  'verify_collaborator',
  'invite_collaborator',
  'rewind_collaboration', // collaboration
  'open_fuser_envelopes',
  'generate_quik_documents',
  'ai_document_extract',
  'start_data_mapping', // document / envelope / extraction / data-mapping
  'url'
]);

// Mirrors dispatchClickElement's own hidden check (assistant/tools/clickElement.ts):
// a button hidden by a show_if rule must never be pressed on its behalf.
const isButtonVisible = (state: any, button: any): boolean => {
  const flags = (state.visiblePositions ?? {})[
    getPositionKey(button) ?? 'root'
  ];
  return Array.isArray(flags) ? flags.some(Boolean) : true;
};

// A person can press any visible Next button; one that also submits the step
// is preferred, since only that press saves the step (and uploads its files)
const qualifyingButton = (state: any, buttonId?: string): any | null => {
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

const outsideFlowAction = (actions: any[]): any =>
  actions.find((a: any) => OUTSIDE_FLOW_ACTIONS.has(a?.type));

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

  if (button.properties?.captcha_verification)
    return {
      status: 'refused',
      fromStep,
      reason:
        'This step requires CAPTCHA verification, which is left for the person.'
    };

  const outsideAction = outsideFlowAction(button.properties?.actions ?? []);
  if (outsideAction)
    return {
      status: 'refused',
      fromStep,
      reason: `This step triggers '${outsideAction.type}', which is left for the person.`
    };

  if (hasUnsavedWork(formUuid))
    return {
      status: 'refused',
      fromStep,
      reason: "This step has unsaved work that needs the person's attention."
    };

  const resolvedKey = callbacks.getNextStepKey({
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
  await callbacks.buttonOnClick(button);
  await awaitPendingInlineErrors(internalState[formUuid]);

  const afterState = internalState[formUuid];
  const toStep = getLiveStepKey(afterState) ?? afterState?.currentStep?.key;
  if (toStep && toStep !== fromStep)
    return {
      status: 'advanced',
      fromStep,
      toStep,
      saved: button.properties?.submit === true
    };

  const newErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(afterState)
  );
  if (newErrors.length > 0) {
    const errors: Record<string, string> = {};
    newErrors.forEach((e) => (errors[e.key] = e.message));
    return { status: 'errors', fromStep, errors };
  }

  return {
    status: 'no_change',
    fromStep,
    reason: 'The button click produced no navigation and no validation errors.'
  };
}
