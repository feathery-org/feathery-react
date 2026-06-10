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
