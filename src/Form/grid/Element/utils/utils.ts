import { fieldValues } from '../../../../utils/init';
import { getFieldValue } from '../../../../utils/fieldHelperFunctions';
import { justInsert } from '../../../../utils/array';
import { resolveInlineErrorMessage } from '../../../../utils/inlineErrors';

/**
 * Return inline error object
 * @param field
 * @param inlineErrors
 */
export function getInlineError(field: any, inlineErrors: any) {
  const baseKey = field.servar ? field.servar.key : field.id;
  // Errors are keyed only by the real field key; per-row errors live in the
  // entry's `byIndex` map, with a field-wide `message` as fallback.
  return resolveInlineErrorMessage(inlineErrors[baseKey], field.repeat);
}

export function textFieldShouldSubmit(servar: any, value: any) {
  switch (servar.type) {
    case 'ssn': {
      const ssnLength = servar.metadata.last_four_digits ? 4 : 9;
      return value.length === ssnLength;
    }
    default:
      return false;
  }
}

/**
 * A file upload field autosubmits only once it is actually filled.
 *
 * Multi-file fields are exempt entirely — the user isn't done after the first
 * file, and submitting there strands the rest. The flag lives on the servar
 * metadata, not on element properties. Removing a file reaches the same
 * onChange handler as adding one, signalled by a -1 index, and is not a fill.
 */
export function fileFieldShouldSubmit(
  servar: any,
  files: any[],
  fieldIndex: any
) {
  if (servar.metadata.multiple) return false;
  if (fieldIndex === -1) return false;
  return files.length > 0;
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

export function otherChangeCheckboxGroup(
  oldOtherVal: any,
  e: any,
  updateFieldValues: any,
  repeatIndex: number | null
) {
  const target = e.target;
  const curOtherVal = target.value;
  let curFieldVal: any = fieldValues[target.id];
  // Handle repeatable fields
  if (repeatIndex !== null) {
    const updatedFieldVal = curFieldVal.map((val: any, i: number) => {
      if (i === repeatIndex) {
        return val.map((item: any) =>
          item === oldOtherVal ? curOtherVal : item
        );
      }
      return val;
    });
    updateFieldValues({ [target.id]: updatedFieldVal });
    return updatedFieldVal[repeatIndex].length - 1;
  } else {
    curFieldVal = curFieldVal.filter((val: any) => val !== oldOtherVal);
    (curFieldVal as string[]).push(curOtherVal);
    updateFieldValues({ [target.id]: curFieldVal });
    return Array.isArray(curFieldVal) ? curFieldVal.length - 1 : undefined;
  }
}

export function otherChangeRadioButtonGroup(
  e: any,
  updateFieldValues: any,
  repeatIndex: number | null
) {
  const target = e.target;
  const curOtherVal = target.value;
  let curFieldVal: any = fieldValues[target.id];
  // Handle repeatable fields
  if (repeatIndex !== null) {
    const updatedFieldVal = curFieldVal.map((val: any, i: number) =>
      i === repeatIndex ? curOtherVal : val
    );
    updateFieldValues({ [target.id]: updatedFieldVal });
  } else {
    curFieldVal = curOtherVal;
    updateFieldValues({ [target.id]: curFieldVal });
  }
  return Array.isArray(curFieldVal) ? curFieldVal.length - 1 : undefined;
}

export function handleCheckboxGroupChange(
  e: any,
  field: any,
  updateFieldValues: any
) {
  const target = e.target;
  // The option lives on `value`; `name` identifies the field itself so that
  // the group certifies under its field key rather than the option label
  const opt = target.value;
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
  return target.checked ? newValue.length - 1 : -1;
}

export function handleCheckboxGroupSelectAllChange(
  optionValues: any[],
  shouldSelectAll: boolean,
  field: any,
  updateFieldValues: any
) {
  const servar = field.servar;
  const fieldValue = getFieldValue(field);
  const { value } = fieldValue;
  const optionValueSet = new Set(optionValues);
  const otherValues = value.filter((v: any) => !optionValueSet.has(v));
  const newValue = shouldSelectAll
    ? [...otherValues, ...optionValues]
    : otherValues;

  if (fieldValue.repeated) {
    const { valueList, index } = fieldValue;
    updateFieldValues({
      [servar.key]: justInsert(valueList, newValue, index)
    });
  } else {
    updateFieldValues({ [servar.key]: newValue });
  }
  return shouldSelectAll ? newValue.length - 1 : -1;
}

export function fieldAllowedFromList(allowLists: any[], fieldKey: string) {
  const [whitelist, blacklist] = allowLists;
  if (whitelist && !whitelist.includes(fieldKey)) return false;
  if (blacklist && blacklist.includes(fieldKey)) return false;
  return true;
}
