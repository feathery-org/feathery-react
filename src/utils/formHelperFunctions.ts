import getRandomBoolean from './random';
import { fieldValues, filePathMap, initInfo } from './init';
import { toBase64 } from './image';
import { evalComparisonRule, ResolvedComparisonRule } from './logic';

/**
 *
 * @param {*} step
 * @param {boolean} forUser indicate whether the result of this function is
 * meant for the user, or Feathery's BE. Presently the only difference is
 * whether signature field values are base64 or a JS File obj
 * @returns Formatted fields for the step
 */
const formatStepFields = (step: any, forUser = false) => {
  const formattedFields = {};
  step.servar_fields.forEach((field: any) => {
    const servar = field.servar;
    let value;
    // Only use base64 for signature if these values will be presented to the user
    const val = fieldValues[servar.key];
    if (forUser && servar.type === 'signature') {
      value =
        val !== null
          ? // @ts-expect-error TS(2345): Argument of type 'string | number | boolean | stri... Remove this comment to see the full error message
            Promise.resolve(val).then((file) => toBase64(file))
          : Promise.resolve('');
    } else value = val;
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    formattedFields[servar.key] = {
      value,
      type: servar.type,
      displayText: servar.name
    };
  });
  return formattedFields;
};

const formatAllFormFields = (steps: any, forUser = false) => {
  let formattedFields = {};
  Object.values(steps).forEach((step) => {
    const stepFields = formatStepFields(step, forUser);
    formattedFields = { ...formattedFields, ...stepFields };
  });
  return formattedFields;
};

const getABVariant = (stepRes: any) => {
  if (!stepRes.variant) return stepRes.data;
  const { sdkKey, userId } = initInfo();
  // If userId was not passed in, sdkKey is assumed to be a user admin key
  // and thus a unique user ID
  return getRandomBoolean(userId || sdkKey, stepRes.form_name)
    ? stepRes.data
    : stepRes.variant;
};

function getDefaultFieldValue(field: any) {
  switch (field.servar.type) {
    case 'checkbox':
      // eslint-disable-next-line camelcase
      return !!field.servar.metadata?.always_checked;
    case 'hex_color':
      return 'FFFFFFFF';
    case 'select':
    case 'signature':
    case 'file_upload':
      return null;
    case 'button_group':
    case 'multiselect':
      return [];
    default:
      return '';
  }
}

const getAllElements = (step: any) => {
  return [
    ...step.progress_bars.map((e: any) => [e, 'progress_bar']),
    ...step.images.map((e: any) => [e, 'image']),
    ...step.videos.map((e: any) => [e, 'video']),
    ...step.texts.map((e: any) => [e, 'text']),
    ...step.buttons.map((e: any) => [e, 'button']),
    ...step.servar_fields.map((e: any) => [e, 'field'])
  ];
};

const lookUpTrigger = (step: any, elementID: any, elementType: any) => {
  if (elementType === 'button') {
    const element = step.buttons.find((button: any) => button.id === elementID);
    return { id: elementID, text: element.properties.text };
  } else if (elementType === 'text') {
    const element = step.texts.find((text: any) => text.id === elementID);
    return { id: elementID, text: element.properties.text };
  } else if (elementType === 'field') {
    const element = step.servar_fields.find(
      (field: any) => field.id === elementID
    );
    return { id: element.servar.key, text: element.servar.name };
  } else return {};
};

const nextStepKey = (nextConditions: any, metadata: any) => {
  let newKey: any = null;
  nextConditions
    .filter(
      (cond: any) =>
        cond.element_type === metadata.elementType &&
        metadata.elementIDs.includes(cond.element_id) &&
        cond.metadata.start === metadata.start &&
        cond.metadata.end === metadata.end
    )
    .sort((cond1: any, cond2: any) => {
      return cond1.rules.length < cond2.rules.length ? 1 : -1;
    })
    .forEach((cond: any) => {
      if (newKey) return;
      let rulesMet = true;
      cond.rules.forEach((rule: ResolvedComparisonRule) => {
        rulesMet &&= evalComparisonRule(rule, fieldValues);
      });
      if (rulesMet) newKey = cond.next_step_key;
    });
  return newKey;
};

// No origin is possible if there are no steps, e.g. form is disabled
const NO_ORIGIN_DEFAULT = { key: '' };
const getOrigin = (steps: any) =>
  Object.values(steps).find((step) => (step as any).origin) ??
  NO_ORIGIN_DEFAULT;

const getStepDepthMap = (steps: any, hasProgressBar = false) => {
  const depthMap = {};
  const stepQueue = [[getOrigin(steps), 0]];
  while (stepQueue.length > 0) {
    // @ts-expect-error TS(2461): Type 'unknown[] | undefined' is not an array type.
    const [step, depth] = stepQueue.shift();
    if (
      step.key in depthMap ||
      // Optionally filter only for steps with progress bar
      (hasProgressBar && step.progress_bars.length === 0)
    )
      continue;
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    depthMap[step.key] = depth;
    step.next_conditions.forEach((condition: any) => {
      stepQueue.push([steps[condition.next_step_key], depth + 1]);
    });
    step.previous_conditions.forEach((condition: any) => {
      stepQueue.push([steps[condition.previous_step_key], depth + 1]);
    });
  }
  return depthMap;
};

const recurseProgressDepth = (steps: any, curKey: any) => {
  const depthMap = getStepDepthMap(steps, true);
  // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  return [depthMap[curKey], Math.max(...Object.values(depthMap))];
};

/**
 * Creates a unique key value for an element (taking repeated instances into account).
 */
function reactFriendlyKey(field: any) {
  return field.id + (field.repeat ? `-${field.repeat}` : '');
}

/**
 * Retrieves the value of the servar from the provided values.
 * If the servar field is repeated, gets the indexed value.
 */
function getFieldValue(field: any) {
  const { servar, repeat } = field;

  // Need to check if undefined, rather than !values[servar.key], because null can be a set value
  if (fieldValues[servar?.key] === undefined)
    return { value: getDefaultFieldValue(field) };

  const fieldValue = fieldValues[servar.key] as any;
  return repeat !== undefined
    ? {
        repeated: true,
        index: repeat,
        value: fieldValue[repeat] ?? getDefaultFieldValue(field),
        valueList: fieldValues[servar.key] as any[]
      }
    : {
        repeated: false,
        value: fieldValue
      };
}

/** Update the fieldValues cache with a backend session */
function updateSessionValues(session: any) {
  // Convert files of the format { url, path } to Promise<File>
  const filePromises = objectMap(session.file_values, (fileOrFiles: any) =>
    Array.isArray(fileOrFiles)
      ? fileOrFiles.map((f) => fetchS3File(f.url))
      : fetchS3File(fileOrFiles.url)
  );

  // Create a map of servar keys to S3 paths so we know which files have been uploaded already
  const newFilePathMap = objectMap(session.file_values, (fileOrFiles: any) =>
    Array.isArray(fileOrFiles)
      ? fileOrFiles.map((f) => f.path)
      : fileOrFiles.path
  );

  Object.assign(fieldValues, { ...session.field_values, ...filePromises });
  Object.assign(filePathMap, newFilePathMap);
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
}: any) {
  let invalid = false;
  if (errorType === 'html5') {
    if (!formRef.current) return false;

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
    invalid = Object.values(inlineErrors).some((data) => (data as any).message);
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
function getInlineError(field: any, inlineErrors: any) {
  const data = inlineErrors[field.servar ? field.servar.key : field.id];
  if (!data) return;
  if (Number.isInteger(data.index) && data.index !== field.repeat) return;
  return data.message;
}

function objectMap(obj: any, transform: any) {
  return Object.entries(obj).reduce((newObj, [key, val]) => {
    return { ...newObj, [key]: transform(val) };
  }, {});
}

/**
 * If a user's file is already uploaded, Feathery backend returns S3 details: { path, url }
 * We convert this information into Promises that resolve to the file
 */
async function fetchS3File(url: any) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], decodeURI(url.split('?')[0].split('/').slice(-1)), {
    type: blob.type
  });
}

function textFieldShouldSubmit(servar: any, value: any) {
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
function isFieldActuallyRequired(field: any, repeatTriggerExists: any) {
  const isTrailingRepeatField = repeatTriggerExists && field.lastRepeat;
  return field.servar.required && !isTrailingRepeatField;
}

function changeStep(newKey: any, oldKey: any, steps: any, history: any) {
  const sameKey = oldKey === newKey;
  if (!sameKey && newKey in steps) {
    history.replace(location.pathname + location.search + `#${newKey}`);
    return true;
  }
  return false;
}

function getNewStepUrl(stepKey: any) {
  return location.pathname + location.search + `#${stepKey}`;
}

function getPrevStepUrl(curStep: any, stepMap: Record<string, string>) {
  let newStepKey = stepMap[curStep.key];
  if (!newStepKey) {
    const prevCondition = curStep.previous_conditions[0];
    if (prevCondition) newStepKey = prevCondition.previous_step_key;
  }
  return newStepKey ? getNewStepUrl(newStepKey) : '';
}

// Update the map we maintain to track files that have already been uploaded to S3
// This means nulling the existing mapping because the user uploaded a new file
function clearFilePathMapEntry(key: any, index = null) {
  if (index !== null) {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (!filePathMap[key]) filePathMap[key] = [];
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    filePathMap[key][index] = null;
  } else {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    filePathMap[key] = null;
  }
}

export {
  changeStep,
  formatAllFormFields,
  formatStepFields,
  getABVariant,
  getAllElements,
  getDefaultFieldValue,
  getNewStepUrl,
  getPrevStepUrl,
  lookUpTrigger,
  nextStepKey,
  getOrigin,
  getStepDepthMap,
  recurseProgressDepth,
  reactFriendlyKey,
  getFieldValue,
  updateSessionValues,
  getInlineError,
  setFormElementError,
  objectMap,
  fetchS3File,
  textFieldShouldSubmit,
  isFieldActuallyRequired,
  clearFilePathMapEntry
};
