import getRandomBoolean from './random';
import libphonenumber from 'google-libphonenumber';
import { initInfo } from './init';
import { toBase64 } from './image';

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
    try {
      const number = phoneValidator.parseAndKeepRawInput(a, 'US');
      return phoneValidator.isValidNumberForRegion(number, 'US');
    } catch (e) {
      // Invalid phone number
      return false;
    }
  }
};

/**
 *
 * @param {*} step
 * @param {*} fieldValues
 * @param {boolean} forUser indicate whether the result of this function is
 * meant for the user, or Feathery's BE. Presently the only difference is
 * whether signature field values are base64 or a JS File obj
 * @returns Formatted fields for the step
 */
const formatStepFields = (step, fieldValues, forUser) => {
  const formattedFields = {};
  step.servar_fields.forEach(async (field) => {
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
    // Only use base64 for signature if these values will be presented to the user
    if (servar.type === 'signature' && forUser) {
      value =
        fieldValues[servar.key] !== ''
          ? Promise.resolve(fieldValues[servar.key]).then((file) =>
              toBase64(file)
            )
          : Promise.resolve('');
    } else value = fieldValues[servar.key];
    formattedFields[servar.key] = {
      value,
      type: servar.type,
      displayText: servar.name
    };
  });
  return formattedFields;
};

const formatAllStepFields = (steps, fieldValues, forUser) => {
  let formattedFields = {};
  Object.values(steps).forEach((step) => {
    const stepFields = formatStepFields(step, fieldValues, forUser);
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

const getAllElements = (step) => {
  return [
    ...step.progress_bars.map((e) => [e, 'progress_bar']),
    ...step.images.map((e) => [e, 'image']),
    ...step.texts.map((e) => [e, 'text']),
    ...step.buttons.map((e) => [e, 'button']),
    ...step.servar_fields.map((e) => [e, 'field'])
  ];
};

const lookUpTrigger = (step, elementID, elementType) => {
  if (elementType === 'button') {
    const element = step.buttons.find((button) => button.id === elementID);
    return { id: elementID, text: element.properties.text };
  } else if (elementType === 'text') {
    const element = step.texts.find((text) => text.id === elementID);
    return { id: elementID, text: element.properties.text };
  } else if (elementType === 'field') {
    const element = step.servar_fields.find((field) => field.id === elementID);
    return { id: element.servar.key, text: element.servar.name };
  } else return {};
};

const nextStepKey = (nextConditions, metadata, fieldValues) => {
  let newKey = null;
  nextConditions
    .filter(
      (cond) =>
        cond.element_type === metadata.elementType &&
        metadata.elementIDs.includes(cond.element_id) &&
        cond.trigger === metadata.trigger &&
        cond.metadata.start === metadata.start &&
        cond.metadata.end === metadata.end
    )
    .sort((cond1, cond2) => {
      return cond1.rules.length < cond2.rules.length ? 1 : -1;
    })
    .forEach((cond) => {
      if (newKey) return;
      let rulesMet = true;
      cond.rules.forEach((rule) => {
        const userVal = fieldValues[rule.field_key] || '';
        const ruleVal = rule.value || '';
        let ruleMet;
        if (Array.isArray(userVal)) {
          const equal =
            userVal.includes(ruleVal) && rule.comparison === 'equal';
          const notEqual =
            !userVal.includes(ruleVal) && rule.comparison === 'not_equal';
          ruleMet = equal || notEqual;
        } else {
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
        }
        rulesMet &= ruleMet;
      });
      if (rulesMet) newKey = cond.next_step_key;
    });
  return newKey;
};

const getOrigin = (steps) => Object.values(steps).find((step) => step.origin);

const getStepDepthMap = (steps, hasProgressBar = false) => {
  const depthMap = {};
  const stepQueue = [[getOrigin(steps), 0]];
  while (stepQueue.length > 0) {
    const [step, depth] = stepQueue.shift();
    if (
      step.key in depthMap ||
      // Optionally filter only for steps with progress bar
      (hasProgressBar && step.progress_bars.length === 0)
    )
      continue;
    depthMap[step.key] = depth;
    step.next_conditions.forEach((condition) => {
      stepQueue.push([steps[condition.next_step_key], depth + 1]);
    });
  }
  return depthMap;
};

const recurseProgressDepth = (steps, curKey) => {
  const depthMap = getStepDepthMap(steps, true);
  return [depthMap[curKey], Math.max(...Object.values(depthMap))];
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
function getFieldError(value, servar) {
  let noVal;
  switch (servar.type) {
    case 'file_upload':
    case 'select':
      noVal = !value;
      break;
    case 'checkbox':
      // eslint-disable-next-line camelcase
      noVal = !value && servar.metadata?.must_check;
      break;
    case 'signature':
      noVal = value.isEmpty();
      break;
    default:
      noVal = value === '';
      break;
  }
  if (noVal) {
    // If no value, error if field is required
    return servar.required ? 'This is a required field' : '';
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
async function setFormElementError({
  formRef,
  errorType,
  errorCallback = () => {},
  fieldKey = '',
  // Empty message means no error / clearing the error
  message = '',
  index = null,
  servarType = '',
  inlineErrors = {},
  setInlineErrors = () => {},
  triggerErrors = false
}) {
  let invalid = false;
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
    invalid = !formRef.current.checkValidity();
  } else if (errorType === 'inline') {
    if (fieldKey) inlineErrors[fieldKey] = { message };
    if (triggerErrors)
      setInlineErrors(JSON.parse(JSON.stringify(inlineErrors)));
    invalid = Object.values(inlineErrors).some((data) => data.message);
  }
  if (message) {
    await errorCallback({
      errorFieldId: fieldKey,
      errorFieldType: servarType,
      errorMessage: message,
      elementRepeatIndex: index || 0
    });
  }
  return invalid;
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
 * Determines if the provided element should be hidden based on its "hide-if" rules.
 */
function shouldElementHide({ fields, values, element }) {
  // eslint-disable-next-line camelcase
  const hideIfMap = {};
  element.hide_ifs.forEach((hideIf) => {
    const index = hideIf.index;
    if (!(index in hideIfMap)) hideIfMap[index] = [hideIf];
    else hideIfMap[index].push(hideIf);
  });

  let shouldHide = false;
  Object.values(hideIfMap).forEach((hideIfs) => {
    if (shouldHide) return;
    shouldHide = hideIfs.every((hideIf) =>
      calculateHide(hideIf, fields, values, element.repeat ?? 0)
    );
  });
  return shouldHide;
}

function calculateHide(hideIf, fields, values, repeat) {
  // Get the target value (taking repeated elements into account)
  let value = values[hideIf.field_key];
  if (Array.isArray(value)) value = value[repeat];

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

function getNewStepUrl(stepKey) {
  return location.pathname + location.search + `#${stepKey}`;
}

export {
  changeStep,
  formatAllStepFields,
  formatStepFields,
  getABVariant,
  getAllElements,
  getDefaultFieldValue,
  getNewStepUrl,
  lookUpTrigger,
  nextStepKey,
  getOrigin,
  getStepDepthMap,
  recurseProgressDepth,
  reactFriendlyKey,
  getFieldValue,
  getFieldError,
  getInlineError,
  shouldElementHide,
  setFormElementError,
  objectMap,
  fetchS3File,
  textFieldShouldSubmit,
  isFieldActuallyRequired,
  phonePattern,
  emailPattern,
  emailPatternStr
};
