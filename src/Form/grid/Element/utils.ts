import {
  ACTIONS_TO_VALIDATE,
  SUBMITTABLE_ACTIONS
} from '../../../utils/elementActions';

/**
 * Return inline error object
 * @param field
 * @param inlineErrors
 */
export function getInlineError(field: any, inlineErrors: any) {
  const data = inlineErrors[field.servar ? field.servar.key : field.id];
  if (!data) return;
  if (Number.isInteger(data.index) && data.index !== field.repeat) return;
  return data.message;
}

export function textFieldShouldSubmit(servar: any, value: any) {
  switch (servar.type) {
    case 'ssn':
      return value.length === 9;
    default:
      return false;
  }
}

// To determine if a field should actually be required, we need to consider the repeat_trigger config
// If this is the trailing element in a set of repeat_trigger elements, then it shouldn't be required
// Because we render the trailing element as a way to create a new row, NOT as a required field for the user
export function isFieldActuallyRequired(field: any, step: any) {
  const repeatTriggerExists = step.servar_fields.some(
    (field: any) => field.servar.repeat_trigger
  );
  const isTrailingRepeatField = repeatTriggerExists && field.lastRepeat;
  return field.servar.required && !isTrailingRepeatField;
}

export const findEnterButton = (step: any) => {
  const buttons = step.buttons;
  // Enter should first trigger a submittable button
  const target = buttons.find((b: any) =>
    b.properties.actions.some(
      (action: any) =>
        SUBMITTABLE_ACTIONS.includes(action.type) && action.submit
    )
  );
  if (target) return target;

  // Otherwise it should trigger actions that use a step field
  return buttons.find((b: any) =>
    b.properties.actions.some((action: any) =>
      ACTIONS_TO_VALIDATE.includes(action.type)
    )
  );
};
