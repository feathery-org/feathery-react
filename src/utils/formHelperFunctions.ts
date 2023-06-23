import getRandomBoolean from './random';
import { fieldValues, filePathMap, initInfo, initState } from './init';
import { toBase64 } from './image';
import { evalComparisonRule, ResolvedComparisonRule } from './logic';
import { getVisibleElements } from './hideAndRepeats';
import throttle from 'lodash.throttle';
import { ACTION_NEXT, ACTION_URL } from './elementActions';
import { featheryWindow } from '../utils/browser';
import Client from '../utils/client';
import { isObjectEmpty } from './primitives';

function _transformSignatureVal(value: any) {
  return value !== null && (value instanceof File || value instanceof Promise)
    ? Promise.resolve(value).then((file) => toBase64(file))
    : Promise.resolve('');
}

/**
 *
 * @param {*} step
 * @param {*} visiblePositions
 * @param {boolean} forUser indicate whether the result of this function is
 * meant for the user, or Feathery's BE. Presently the only difference is
 * whether signature field values are base64 or a JS File obj
 * visible to user as determined by the hide if rules
 * @returns Formatted fields for the step
 */
export const formatStepFields = (
  step: any,
  visiblePositions: any,
  forUser: boolean
) => {
  const fields = visiblePositions
    ? getVisibleElements(step, visiblePositions, ['servar_fields']).map(
        ({ element }) => element
      )
    : step.servar_fields;

  const formattedFields: Record<
    string,
    { value: any; type: string; displayText: string }
  > = {};
  fields.forEach((field: any) => {
    const servar = field.servar;
    // Only use base64 for signature if these values will be presented to the user
    let value: any = fieldValues[servar.key];
    if (forUser && servar.type === 'signature') {
      value = servar.repeated
        ? value.map(_transformSignatureVal)
        : _transformSignatureVal(value);
    } else if (!forUser && servar.type === 'url') {
      value = value.replaceAll(' ', '%20');
    }
    formattedFields[servar.key] = {
      value,
      type: servar.type,
      displayText: servar.name
    };
  });
  return formattedFields;
};

export const formatAllFormFields = (steps: any, forUser = false) => {
  let formattedFields = {};
  Object.values(steps).forEach((step) => {
    const stepFields = formatStepFields(step, null, forUser);
    formattedFields = { ...formattedFields, ...stepFields };
  });
  return formattedFields;
};

export const getABVariant = (stepRes: any) => {
  if (!stepRes.variant) return stepRes.data;
  const { sdkKey, userId } = initInfo();
  // If userId was not passed in, sdkKey is assumed to be a user admin key
  // and thus a unique user ID
  return getRandomBoolean(userId || sdkKey, stepRes.form_name)
    ? stepRes.data
    : stepRes.variant;
};

export function getDefaultFieldValue(field: any) {
  const servar = field.servar;
  const meta = servar.metadata;
  switch (servar.type) {
    case 'checkbox':
      // eslint-disable-next-line camelcase
      return !!meta.always_checked || !!meta.default_checked;
    case 'hex_color':
      return 'FFFFFFFF';
    case 'rating':
      return 0;
    case 'slider':
      return servar.min_length ?? 0;
    case 'select':
    case 'signature':
    case 'file_upload':
      return null;
    case 'button_group':
    case 'multiselect':
      return [];
    case 'gmap_state':
      return meta.default_state ?? '';
    case 'gmap_country':
      return meta.default_country ?? '';
    default:
      return '';
  }
}

// TODO: remove string[] for backcompat
export type FieldOptions = Record<
  string,
  (string | { value: string; label?: string; image?: string })[]
>;

export function updateStepFieldOptions(step: any, newOptions: FieldOptions) {
  step.servar_fields.forEach((field: any) => {
    const servar = field.servar;
    if (servar.key in newOptions) {
      const options = newOptions[servar.key];
      servar.metadata.options = options.map((option) =>
        typeof option === 'string' ? option : option.value
      );
      servar.metadata.option_labels = options.map((option) =>
        typeof option === 'string' ? option : option.label ?? option.value
      );
      servar.metadata.option_images = options.map((option) =>
        typeof option === 'string' ? '' : option.image ?? ''
      );
    }
  });
}

export const getAllElements = (step: any) => {
  return [
    ...step.progress_bars.map((e: any) => [e, 'progress_bar']),
    ...step.images.map((e: any) => [e, 'image']),
    ...step.videos.map((e: any) => [e, 'video']),
    ...step.texts.map((e: any) => [e, 'text']),
    ...step.buttons.map((e: any) => [e, 'button']),
    ...step.servar_fields.map((e: any) => [e, 'field']),
    ...step.subgrids.map((e: any) => [e, 'subgrid'])
  ];
};

export const lookUpTrigger = (step: any, elementID: any, elementType: any) => {
  let payload = {};
  if (elementType === 'button') {
    const element = step.buttons.find((button: any) => button.id === elementID);
    payload = { text: element?.properties?.text ?? '' };
  } else if (elementType === 'text') {
    const element = step.texts.find((text: any) => text.id === elementID);
    payload = { text: element.properties.text };
  } else if (elementType === 'field') {
    const element = step.servar_fields.find(
      (field: any) => field.id === elementID
    );
    payload = { id: element.servar.key, text: element.servar.name };
  }
  return { id: elementID, elementType, ...payload };
};

export const nextStepKey = (nextConditions: any, metadata: any) => {
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
        rulesMet &&= evalComparisonRule(rule);
      });
      if (rulesMet) newKey = cond.next_step_key;
    });
  return newKey;
};

// No origin is possible if there are no steps, e.g. form is disabled
const NO_ORIGIN_DEFAULT = { key: '' };
export const getOrigin = (steps: any) =>
  Object.values(steps).find((step) => (step as any).origin) ??
  NO_ORIGIN_DEFAULT;

export const getStepDepthMap = (steps: any, hasProgressBar = false) => {
  const depthMap: Record<string, any> = {};
  const stepQueue = [[getOrigin(steps), 0]];

  while (stepQueue.length > 0) {
    // @ts-expect-error TS(2461): Type 'unknown[] | undefined' is not an array type.
    const [step, depth] = stepQueue.shift();
    if (step.key in depthMap) continue;

    // Optionally filter only for steps with progress bar
    const missingBar = hasProgressBar && step.progress_bars.length === 0;
    depthMap[step.key] = missingBar ? 0 : depth;

    const incr = missingBar ? 0 : 1;
    step.next_conditions.forEach((condition: any) => {
      stepQueue.push([steps[condition.next_step_key], depth + incr]);
    });
    step.previous_conditions.forEach((condition: any) => {
      stepQueue.push([steps[condition.previous_step_key], depth + incr]);
    });
  }

  return depthMap;
};

export const recurseProgressDepth = (steps: any, curKey: any) => {
  const depthMap = getStepDepthMap(steps, true);
  return [depthMap[curKey], Math.max(...Object.values(depthMap))];
};

/**
 * Retrieves the value of the servar from the provided values.
 * If the servar field is repeated, gets the indexed value.
 */
export function getFieldValue(field: any) {
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
export function updateSessionValues(session: any) {
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
export async function setFormElementError({
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
      // form.elements has reserved props so must use namedItem to get by id
      const singleOrList = formRef.current.elements.namedItem(fieldKey);
      let elements =
        singleOrList instanceof RadioNodeList
          ? Array.from(singleOrList)
          : [singleOrList];
      elements = elements.filter((e) => e);

      if (index !== null && elements.length) elements = [elements[index]];
      elements.forEach((e) => e && e.setCustomValidity(message));
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

const clearBrowserErrorsDebounced = throttle(
  (formRef: React.MutableRefObject<any>) => {
    if (!formRef.current) return;
    Array.from(formRef.current.elements).forEach((element: any) => {
      element.setCustomValidity('');
    });
  },
  1000
);

export function clearBrowserErrors(formRef: React.MutableRefObject<any>) {
  clearBrowserErrorsDebounced(formRef);
}

export function objectMap(obj: any, transform: any) {
  return Object.entries(obj).reduce((newObj, [key, val]) => {
    return { ...newObj, [key]: transform(val) };
  }, {});
}

/**
 * If a user's file is already uploaded, Feathery backend returns S3 details: { path, url }
 * We convert this information into Promises that resolve to the file
 */
export async function fetchS3File(url: any) {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], decodeURI(url.split('?')[0].split('/').slice(-1)), {
    type: blob.type
  });
}

export function changeStep(newKey: any, oldKey: any, steps: any, history: any) {
  const sameKey = oldKey === newKey;
  if (!sameKey && newKey in steps) {
    history.replace(location.pathname + location.search + `#${newKey}`);
    return true;
  }
  return false;
}

export function getNewStepUrl(stepKey: any) {
  return location.pathname + location.search + `#${stepKey}`;
}

export function getPrevStepUrl(curStep: any, stepMap: Record<string, string>) {
  let newStepKey = stepMap[curStep.key];
  if (!newStepKey) {
    const prevCondition = curStep.previous_conditions[0];
    if (prevCondition) newStepKey = prevCondition.previous_step_key;
  }
  return newStepKey ? getNewStepUrl(newStepKey) : '';
}

// Update the map we maintain to track files that have already been uploaded to S3
// This means nulling the existing mapping because the user uploaded a new file
export function clearFilePathMapEntry(key: any, index = null) {
  if (index !== null) {
    if (!filePathMap[key]) filePathMap[key] = [];
    // @ts-ignore
    filePathMap[key][index] = null;
  } else {
    filePathMap[key] = null;
  }
}

export function setUrlStepHash(history: any, steps: any, stepName: string) {
  // No hash necessary if form only has one step
  if (Object.keys(steps).length > 1) {
    history.replace(location.pathname + location.search + `#${stepName}`);
  }
}

export function registerRenderCallback(
  internalId: string,
  key: 'form' | 'loginForm',
  callback: () => void
) {
  initState.renderCallbacks[internalId] = {
    ...initState.renderCallbacks[internalId],
    [key]: callback
  };
}

export function rerenderAllForms() {
  Object.values(initInfo().renderCallbacks).forEach(
    (formCbs: Record<string, any>) =>
      Object.values(formCbs).forEach((cb: any) => cb())
  );
}

export function remountAllForms() {
  Object.values(initInfo().remountCallbacks).forEach((cb) => cb());
}

/**
 *
 * @returns Url hash without the #, or '' if decodeURI fails
 */
export function getUrlHash() {
  try {
    return decodeURI(location.hash.substr(1));
  } catch (e) {
    console.warn(e);
    return '';
  }
}

export function getInitialStep({
  initialStepId,
  steps,
  sessionCurrentStep
}: {
  initialStepId: string;
  steps: any;
  sessionCurrentStep?: string;
}) {
  const hashKey = getUrlHash();
  return (
    initialStepId ||
    (hashKey && hashKey in steps && hashKey) ||
    sessionCurrentStep ||
    (getOrigin as any)(steps).key
  );
}

export function castVal(servarType: string | undefined, val: any) {
  // If there is no type, it is a hidden field and we will treat it as a string
  if (servarType === undefined) return String(val);
  let castVal;
  switch (servarType) {
    case 'currency':
    case 'integer_field':
    case 'rating':
    case 'slider':
      castVal = Number(val);
      break;
    case 'checkbox':
      castVal = !['False', 'false'].includes(val);
      break;
    case 'multiselect':
    case 'button_group':
      castVal = [val];
      break;
    default:
      castVal = String(val);
      break;
  }

  return castVal;
}

export function getServarTypeMap(steps: any) {
  const servarKeyToTypeMap: Record<string, string> = {};
  if (steps) {
    Object.values(steps).forEach((step: any) => {
      step.servar_fields.forEach(({ servar }: any) => {
        servarKeyToTypeMap[servar.key] = servar.type;
      });
    });
  }
  return servarKeyToTypeMap;
}

export function isStepTerminal(step: any) {
  // If step is navigable to another step, it's not terminal
  if (step.next_conditions.length > 0) return false;

  if (
    step.servar_fields.some((field: any) => field.servar.required) &&
    step.buttons.some((b: any) => b.properties.submit)
  ) {
    // Not terminal if there is a required field on the step that can be saved
    return false;
  }

  const hasNext = step.buttons.some((b: any) =>
    (b.properties.actions ?? []).some(
      (action: any) =>
        action.type === ACTION_NEXT ||
        (action.type === ACTION_URL && !action.open_tab)
    )
  );

  return !hasNext;
}

export function saveInitialValuesAndUrlParams({
  updateFieldValues,
  client,
  saveUrlParams,
  initialValues,
  steps
}: {
  updateFieldValues: (newFieldValues: any, rerender?: boolean) => boolean;
  client: Client;
  saveUrlParams: boolean;
  initialValues: any;
  steps: any;
}) {
  let rerenderRequired = false;
  // Submit initial values & URL params
  let valuesToSubmit: Record<string, any> = {};
  if (!isObjectEmpty(initialValues)) {
    rerenderRequired = true;
    const servarKeyToTypeMap = getServarTypeMap(steps);
    valuesToSubmit = { ...initialValues };
    Object.entries(valuesToSubmit).map(([key, val]) => {
      valuesToSubmit[key] = castVal(servarKeyToTypeMap[key], val);
    });
  }
  const params = new URLSearchParams(featheryWindow().location.search);
  if (saveUrlParams) {
    params.forEach((value, key) => {
      if (key === '_slug') return;
      valuesToSubmit[key] = value;
    });
  }
  if (!isObjectEmpty(valuesToSubmit)) {
    updateFieldValues(valuesToSubmit, rerenderRequired);
    client.submitCustom(valuesToSubmit, false);
  }
}

export function mapFormSettingsResponse(res: any) {
  return {
    errorType: res.error_type,
    autocomplete: res.autocomplete ? 'on' : 'off',
    autofocus: res.autofocus,
    formOff: Boolean(res.formOff),
    allowEdits: res.allow_edits,
    completionBehavior: res.completion_behavior,
    showBrand: Boolean(res.show_brand),
    brandPosition: res.brand_position,
    autoscroll: res.autoscroll,
    rightToLeft: res.right_to_left,
    saveUrlParams: res.save_url_params
  };
}
