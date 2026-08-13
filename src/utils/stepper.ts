import { getFieldValues } from './init';

function isStepperFieldTruthy(fieldKey: string): boolean {
  const val = getFieldValues()[fieldKey];
  if (Array.isArray(val)) return val.length > 0;
  return !!val;
}

export function isStepperStepVisible(stepConfig: any): boolean {
  const cond = stepConfig?.visibility_condition;
  if (!cond || !stepConfig?.visibility_field_key) return true;
  const truthy = isStepperFieldTruthy(stepConfig.visibility_field_key);
  return cond === 'show' ? truthy : !truthy;
}

// Whether a step shows a checkmark. Only submitted steps count. When
// resetCompletionOnBack is on, steps ahead of the current one don't, so looping
// back doesn't leave stale checkmarks.
export function isStepperStepCompleted(
  isSubmitted: boolean,
  index: number,
  activeStep: number,
  resetCompletionOnBack: boolean
): boolean {
  return isSubmitted && !(resetCompletionOnBack && index > activeStep);
}

// A stepper step is reachable when it isn't the current step and either all-step navigation is on or it was already completed
export function isStepperStepReachable(
  isActive: boolean,
  allowAllNavigation: boolean,
  isCompleted: boolean
): boolean {
  return !isActive && (allowAllNavigation || isCompleted);
}
