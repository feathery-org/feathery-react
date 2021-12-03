import getRandomBoolean from './random';
import libphonenumber from 'google-libphonenumber';
import { initInfo } from './init';

const phoneValidator = libphonenumber.PhoneNumberUtil.getInstance();

const emailPatternStr =
  "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:.[a-zA-Z0-9-]+)+$";
const emailPattern = new RegExp(
  "^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:.[a-zA-Z0-9-]+)+$"
);
const phonePattern = /^\d{10}$/;

const validators = {
  email: (a) => emailPattern.test(a),
  phone: (a) => {
    const number = phoneValidator.parseAndKeepRawInput(a, 'US');
    return phoneValidator.isValidNumberForRegion(number, 'US');
  }
};

const dataURLToFile = (dataURL, name) => {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], name, { type: mime });
};

const formatStepFields = (step, fieldValues, signatureRef) => {
  const formattedFields = {};
  step.servar_fields.forEach((field) => {
    if (
      shouldElementHide({
        fields: step.servar_fields,
        values: fieldValues,
        element: field
      })
    )
      return;

    const servar = field.servar;
    let value;
    if (servar.type === 'signature') {
      value = signatureRef
        ? dataURLToFile(
            signatureRef[servar.key].toDataURL('image/png'),
            `${servar.key}.png`
          )
        : '';
    } else value = fieldValues[servar.key];
    formattedFields[servar.key] = {
      value,
      type: servar.type,
      displayText: servar.name
    };
  });
  return formattedFields;
};

const formatAllStepFields = (steps, fieldValues) => {
  let formattedFields = {};
  Object.values(steps).forEach((step) => {
    const stepFields = formatStepFields(step, fieldValues);
    formattedFields = { ...formattedFields, ...stepFields };
  });
  return formattedFields;
};

const getABVariant = (stepRes) => {
  if (!stepRes.variant) return stepRes.data;
  const { apiKey, userKey } = initInfo();
  // If userKey was not passed in, apiKey is assumed to be a user admin key
  // and thus a unique user ID
  return getRandomBoolean(userKey || apiKey, stepRes.form_name)
    ? stepRes.data
    : stepRes.variant;
};

function getDefaultFieldValue(field) {
  switch (field.servar.type) {
    case 'checkbox':
      // eslint-disable-next-line camelcase
      return !!field.servar.metadata?.always_checked;
    case 'multiselect':
      return [];
    case 'hex_color':
      return 'FFFFFFFF';
    case 'select':
      return null;
    case 'file_upload':
      return null;
    case 'rich_multi_file_upload':
      return [];
    case 'rich_file_upload':
      return null;
    default:
      return '';
  }
}

const getDefaultFieldValues = (steps) => {
  const fieldValues = {};
  Object.values(steps).forEach((step) => {
    step.servar_fields.forEach((field) => {
      const val = getDefaultFieldValue(field);
      fieldValues[field.servar.key] = field.servar.repeated ? [val] : val;
    });
  });
  return fieldValues;
};

const lookupElementKey = (step, elementID, elementType) => {
  if (elementType === 'button') {
    return step.buttons.filter((button) => button.id === elementID)[0]
      .properties.text;
  } else if (elementType === 'text') {
    return step.texts.filter((text) => text.id === elementID)[0].properties
      .text;
  } else if (elementType === 'field') {
    return step.servar_fields.filter((field) => field.id === elementID)[0]
      .servar.key;
  } else return '';
};

const nextStepKey = (
  nextConditions,
  metadata,
  steps,
  fieldValues,
  stepSequence,
  sequenceIndex
) => {
  let newKey;
  let defaultKey = null;
  let sequenceValues = [];
  const inSequence = {};
  const notInSequence = [];
  nextConditions
    .filter(
      (cond) =>
        cond.element_type === metadata.elementType &&
        metadata.elementIDs.includes(cond.element_id)
    )
    .forEach((cond) => {
      if (
        cond.trigger !== metadata.trigger ||
        cond.metadata.start !== metadata.start ||
        cond.metadata.end !== metadata.end
      )
        return;

      if (cond.rules.length === 0) defaultKey = cond.next_step_key;
      else {
        let rulesMet = true;
        cond.rules.forEach((rule) => {
          const userVal = fieldValues[rule.key] || '';
          const ruleVal = rule.value || '';
          if (Array.isArray(userVal)) {
            rulesMet = false;
            const equal =
              userVal.includes(ruleVal) && rule.comparison === 'equal';
            const notEqual =
              !userVal.includes(ruleVal) && rule.comparison === 'not_equal';
            if (equal || notEqual) {
              if (equal) inSequence[ruleVal] = cond.next_step_key;
              else if (notEqual) notInSequence.push(cond.next_step_key);

              if (sequenceValues.length === 0) sequenceValues = userVal;
            }
          } else {
            let ruleMet;
            if (rule.comparison === 'is_type') {
              ruleMet =
                (ruleVal === 'email' && emailPattern.test(userVal)) ||
                (ruleVal === 'phone' && phonePattern.test(userVal));
            } else {
              const equal = userVal === ruleVal;
              ruleMet =
                (equal && rule.comparison === 'equal') ||
                (!equal && rule.comparison === 'not_equal');
            }
            rulesMet &= ruleMet;
          }
        });
        if (rulesMet) newKey = cond.next_step_key;
      }
    });

  // TODO: remove advanced navigation logic once Upfront migrates off
  // order and compose new sequence
  let newSequence = sequenceValues
    .map((val) => inSequence[val])
    .filter(Boolean);
  newSequence = [...newSequence, ...notInSequence];

  let newStepKey = newKey || defaultKey || '';
  if (newSequence.length === 1 && stepSequence.length > 0 && !newStepKey) {
    // Go back in dynamic sequence
    if (sequenceIndex <= 1) newStepKey = newSequence[0];
    else {
      sequenceIndex--;
      newStepKey = stepSequence[sequenceIndex - 1];
    }
  } else {
    // Go forward in dynamic sequence
    if (newSequence.length > 0 && !newStepKey) {
      // Propagate new array rules since they exist
      stepSequence = newSequence;
      sequenceIndex = 0;
    }

    if (stepSequence.includes(newStepKey)) {
      sequenceIndex = stepSequence.indexOf(newStepKey) + 1;
    } else if (
      !newStepKey &&
      stepSequence.length > sequenceIndex &&
      ['button', 'text'].includes(metadata.elementType)
    ) {
      newStepKey = stepSequence[sequenceIndex];
      sequenceIndex++;
    }
  }
  return {
    newStepKey,
    newSequence: stepSequence,
    newSequenceIndex: sequenceIndex
  };
};

const getOrigin = (steps) => {
  let originKey;
  Object.values(steps).forEach((step) => {
    if (step.origin) originKey = step.key;
  });
  return originKey;
};

const recurseDepth = (steps, originKey, curKey, stepSequence) => {
  let curDepth = 0;
  let maxDepth = 0;
  if (stepSequence.includes(curKey)) {
    // If the user is in a custom sequence, figure out:
    // * how many steps to the end from the last step of the sequence
    // * how many steps from the origin to the beginning of the sequence
    // * length of the sequence itself
    const [endSequenceDepth] = recurseDepth(
      steps,
      stepSequence.at(-1),
      stepSequence.at(-1),
      []
    );
    const [beginningSequenceDepth] = recurseDepth(
      steps,
      originKey,
      stepSequence[0],
      []
    );
    curDepth = beginningSequenceDepth + stepSequence.indexOf(curKey);
    maxDepth =
      beginningSequenceDepth + stepSequence.length - 1 + endSequenceDepth;
  } else {
    const seenStepKeys = new Set();
    const stepQueue = [[steps[originKey], 0]];
    while (stepQueue.length > 0) {
      const [step, depth] = stepQueue.shift();
      if (seenStepKeys.has(step.key)) continue;
      seenStepKeys.add(step.key);

      if (step.key === curKey) curDepth = depth;
      maxDepth = depth;

      step.next_conditions.forEach((condition) => {
        stepQueue.push([steps[condition.next_step_key], depth + 1]);
      });
    }
  }
  return [curDepth, maxDepth];
};

/**
 * Creates a unique key value for an element (taking repeated instances into account).
 */
function reactFriendlyKey(field) {
  return field.id + (field.repeat ? `-${field.repeat}` : '');
}

/**
 * Retrieves the value of the servar from the provided values.
 * If the servar field is repeated, gets the indexed value.
 */
function getFieldValue(field, values) {
  const { servar, repeat } = field;
  return repeat !== undefined
    ? {
        repeated: true,
        index: repeat,
        value: values[servar.key][repeat] ?? getDefaultFieldValue(field),
        valueList: values[servar.key]
      }
    : {
        repeated: false,
        value: values[servar.key]
      };
}

/**
 * Returns the error message for a field value if it's invalid.
 * Returns an empty string if it's valid.
 */
function getFieldError(value, servar, signatureRef) {
  // Check if value is missing when it's required
  if (servar.required) {
    let missingVal;
    switch (servar.type) {
      case 'select':
        missingVal = !value;
        break;
      case 'file_upload':
        missingVal = !value;
        break;
      case 'checkbox':
        // eslint-disable-next-line camelcase
        missingVal = !value && servar.metadata?.must_check;
        break;
      case 'signature':
        missingVal = signatureRef[servar.key].isEmpty();
        break;
      default:
        missingVal = value === '';
        break;
    }
    if (missingVal) return 'This is a required field';
  }

  // Check if value is badly formatted
  if (servar.type === 'phone_number' && !validators.phone(value)) {
    return 'Invalid phone number';
  } else if (servar.type === 'email' && !emailPattern.test(value)) {
    return 'Invalid email format';
  } else if (servar.type === 'ssn' && value.length !== 9) {
    return 'Invalid social security number';
  } else if (
    servar.type === 'pin_input' &&
    value.length !== servar.max_length
  ) {
    return 'Please enter a full code';
  } else if (servar.type === 'login') {
    let validFormat = true;
    let invalidType = '';
    servar.metadata.login_methods.forEach((method) => {
      if (!validators[method](value)) {
        validFormat = false;
        invalidType = method;
      }
    });
    if (!validFormat) return `Please enter a valid ${invalidType}`;
  }

  // No error
  return '';
}

/**
 * Set an error on a particular form DOM node(s).
 */
function setFormElementError({
  formRef,
  errorType,
  fieldKey = '',
  message = '',
  index = null,
  servarType = '',
  inlineErrors = {},
  setInlineErrors = () => {},
  triggerErrors = false
}) {
  if (errorType === 'html5') {
    if (fieldKey) {
      if (['pin_input', 'select', 'multiselect'].includes(servarType))
        fieldKey = `${fieldKey}-0`;
      const singleOrList = formRef.current.elements[fieldKey];
      let elements =
        singleOrList instanceof RadioNodeList
          ? Array.from(singleOrList)
          : [singleOrList];
      elements = elements.filter((e) => e);

      if (index !== null) elements = [elements[index]];
      elements.forEach((e) => e.setCustomValidity(message));
    }
    if (triggerErrors) formRef.current.reportValidity();
    return !formRef.current.checkValidity();
  } else if (errorType === 'inline') {
    if (fieldKey) inlineErrors[fieldKey] = { message };
    if (triggerErrors)
      setInlineErrors(JSON.parse(JSON.stringify(inlineErrors)));
    return Object.values(inlineErrors).find((data) => data.message);
  }
}

/**
 * Return inline error object
 * @param field
 * @param inlineErrors
 */
function getInlineError(field, inlineErrors) {
  const data = inlineErrors[field.servar.key];
  if (!data) return;
  if (Number.isInteger(data.index) && data.index !== field.repeat) return;
  return data.message;
}

/**
 * Determines if the provided element should be hidden based on its "hide-if" rule.
 */
function shouldElementHide({ fields, values, element }) {
  // eslint-disable-next-line camelcase
  const hideIf = element.hide_if;
  if (!hideIf) return false;

  // Get the target value (taking repeated elements into account)
  let value = '';
  if (hideIf.field_type === 'servar') {
    const targets = fields.filter((field) => field.servar.id === hideIf.servar);
    const target = targets[element.repeat ?? 0];

    // If the field we're based on isn't there, don't hide
    if (!target) return false;

    value = getFieldValue(target, values).value;
  } else if (hideIf.field_type === 'custom') {
    value = values[hideIf.custom];
  }

  // If the hideIf value is an empty string, we want to match on the "empty" value of a field
  // This could be null, undefined, an empty array, or an empty string
  // Otherwise, just match the hideIf value
  const matchValues =
    hideIf.value === '' ? [null, undefined, [], ''] : [hideIf.value];

  return hideIf.comparison === 'equal'
    ? matchValues.includes(value)
    : !matchValues.includes(value);
}

function objectMap(obj, transform) {
  return Object.entries(obj).reduce((newObj, [key, val]) => {
    return { ...newObj, [key]: transform(val) };
  }, {});
}

/**
 * If a user's file is already uploaded, Feathery backend returns S3 details: { path, url }
 * We convert this information into Promises that resolve to the file
 */
async function fetchS3File(url) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], decodeURI(url.split('?')[0].split('/').slice(-1)), {
    type: blob.type
  });
}

/**
 * If customers provide files through context.setValues
 * we need to explicitly convert any files to file Promises
 * since they may not have done so
 */
function convertFilesToFilePromises(values, fileKeys) {
  const result = {};

  Object.entries(values).forEach(([key, value]) => {
    // If the servar is a file type, convert the file or files (if repeated) to Promises
    if (fileKeys[key]) {
      result[key] = Array.isArray(value)
        ? value.map((v) => Promise.resolve(v))
        : Promise.resolve(value);
    } else {
      result[key] = value;
    }
  });

  return result;
}

function findServars(steps, matcher) {
  return Object.values(steps || {}).flatMap((step) => {
    return step.servar_fields.map((field) => field.servar).filter(matcher);
  });
}

function textFieldShouldSubmit(servar, value) {
  let methods, onlyPhone;
  switch (servar.type) {
    case 'login':
      methods = servar.metadata.login_methods;
      onlyPhone = methods.length === 1 && methods[0] === 'phone';
      return onlyPhone && value.length === 10;
    case 'phone_number':
      return value.length === 10;
    case 'ssn':
      return value.length === 9;
    default:
      return false;
  }
}

// To determine if a field should actually be required, we need to consider the repeat_trigger config
// If this is the trailing element in a set of repeat_trigger elements, then it shouldn't be required
// Because we render the trailing element as a way to create a new row, NOT as a required field for the user
function isFieldActuallyRequired(field, repeatTriggerExists, repeatedRowCount) {
  const isTrailingRepeatField =
    repeatTriggerExists &&
    repeatedRowCount > 1 &&
    field.repeat === repeatedRowCount - 1;
  return field.servar.required && !isTrailingRepeatField;
}

function changeStep(newKey, oldKey, steps, history) {
  const sameKey = oldKey === newKey;
  if (!sameKey && newKey in steps) {
    history.replace(location.pathname + location.search + `#${newKey}`);
    return true;
  }
  return false;
}

export {
  changeStep,
  formatAllStepFields,
  formatStepFields,
  getABVariant,
  getDefaultFieldValue,
  getDefaultFieldValues,
  lookupElementKey,
  nextStepKey,
  getOrigin,
  recurseDepth,
  reactFriendlyKey,
  getFieldValue,
  getFieldError,
  getInlineError,
  shouldElementHide,
  setFormElementError,
  objectMap,
  fetchS3File,
  convertFilesToFilePromises,
  findServars,
  textFieldShouldSubmit,
  isFieldActuallyRequired,
  phonePattern,
  emailPattern,
  emailPatternStr
};
