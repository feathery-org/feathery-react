import { fieldValues } from '../../../utils/init';
import { getFieldValue } from '../../../utils/formHelperFunctions';
import { justInsert } from '../../../utils/array';

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

export function pickCloserElement(target: any, option1: any, option2: any) {
  if (!option1) return option2;
  if (!option2) return option1;

  for (let i = 0; i < target.position.length; i++) {
    const position = target.position[i];
    const opt1Position = option1.position[i];
    const opt1Delta = opt1Position - position;

    const opt2Position = option2.position[i];
    const opt2Delta = opt2Position - position;

    if (opt1Delta !== opt2Delta) {
      if (opt1Delta < 0) return opt2Delta > opt1Delta ? option2 : option1;
      if (opt2Delta < 0) return opt1Delta > opt2Delta ? option1 : option2;
      return opt2Delta > opt1Delta ? option1 : option2;
    }
    // Otherwise evaluate the next position entry
  }

  return option1;
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

export function handleOtherStateChange(
  oldOtherVal: any,
  e: any,
  updateFieldValues: any
) {
  const target = e.target;
  const curOtherVal = target.value;
  let curFieldVal = fieldValues[target.id];
  if (Array.isArray(curFieldVal)) {
    // @ts-expect-error TS(2349): This expression is not callable.
    curFieldVal = curFieldVal.filter(
      (val: any) => val !== oldOtherVal || (!val && !oldOtherVal)
    );
    if (curOtherVal) {
      (curFieldVal as any).push(curOtherVal);
    }
  } else {
    if (curFieldVal === oldOtherVal) curFieldVal = curOtherVal;
  }
  updateFieldValues({ [target.id]: curFieldVal });
}

export function handleCheckboxGroupChange(
  e: any,
  field: any,
  updateFieldValues: any
) {
  const target = e.target;
  const opt = target.name;
  const servar = field.servar;

  const fieldValue = getFieldValue(field);
  const { value } = fieldValue;
  const newValue = target.checked
    ? [...value, opt]
    : value.filter((v: any) => v !== opt);
  if (fieldValue.repeated) {
    const { valueList, index } = fieldValue;
    updateFieldValues({
      [servar.key]: justInsert(valueList, newValue, index)
    });
  } else {
    updateFieldValues({ [servar.key]: newValue });
  }
}

export function fieldAllowedFromList(allowLists: any[], fieldKey: string) {
  const [whitelist, blacklist] = allowLists;
  if (whitelist && !(fieldKey in whitelist)) return false;
  if (blacklist && fieldKey in blacklist) return false;
  return true;
}
