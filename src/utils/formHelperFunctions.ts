import getRandomBoolean from './random';
import {
  fieldValues,
  filePathMap,
  initInfo,
  initState,
  setFieldValues
} from './init';
import { toBase64 } from './image';
import { evalComparisonRule, ResolvedComparisonRule } from './logic';
import { getVisibleElements } from './hideAndRepeats';
import throttle from 'lodash.throttle';
import {
  ACTION_NEXT,
  ACTION_URL,
  ACTION_EXECUTION_ORDER,
  ACTION_STORE_FIELD
} from './elementActions';
import { featheryDoc, featheryWindow } from './browser';
import FeatheryClient from './featheryClient';
import { isObjectEmpty } from './primitives';
import Field from './api/Field';
import { formatDateString } from '../elements/fields/DateSelectorField';
import { findCountryByID } from '../elements/components/data/countries';
import { CLOSED } from '../elements/components/FormOff';

export const ARRAY_FIELD_TYPES = [
  'button_group',
  'file_upload',
  'multiselect',
  'dropdown_multi'
];

function _transformSignatureVal(value: any) {
  return value !== null && (value instanceof File || value instanceof Promise)
    ? Promise.resolve(value).then((file) => toBase64(file))
    : Promise.resolve('');
}

function _transformUrlVal(value: any) {
  return value ? value.replaceAll(' ', '%20') : value;
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
    { value: any; type: string; displayText: string; options?: any[] }
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
      value = servar.repeated
        ? value.map(_transformUrlVal)
        : _transformUrlVal(value);
    }
    formattedFields[servar.key] = {
      value,
      type: servar.type,
      displayText: servar.name
    };
    if (servar.metadata.options) {
      formattedFields[servar.key].options = servar.metadata.options.map(
        (option: string, index: number) => ({
          value: option,
          label: (servar.metadata.option_labels ?? [])[index]
        })
      );
    }
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

export const getAllFields = (
  fieldKeys: string[],
  hiddenFieldKeys: string[],
  formUuid: string
): Record<string, Field> => {
  const fields: Record<string, Field> = {};
  fieldKeys.forEach((key) => {
    fields[key] = new Field(key, formUuid);
  });
  hiddenFieldKeys.forEach((key) => {
    fields[key] = new Field(key, formUuid, true);
  });

  return fields;
};

export function isValidFieldIdentifier(str: string) {
  // Regular expression to match (approximately) all valid Unicode identifiers
  // The most complete regex is here: https://stackoverflow.com/a/2008444 but seems
  // impractical to use in this case
  const identifierRegex = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/u;

  // Check if the string matches the regex and is not a reserved word
  return (
    identifierRegex.test(str) &&
    !isRuntimeReservedWord(str) &&
    !isJsReservedWord(str)
  );
}

export function isStoreFieldValueAction(el: any) {
  (el.properties?.actions ?? []).some(
    (action: any) => action.type === ACTION_STORE_FIELD
  );
}

//
// The issue is that the form designer could assign a field id that collides with a
// javascript reserved word. They will get a validation error should they try to use
// it in a rule. However, even if they do not use it in a rule, the runtime injects
// that field and this causes an exception at runtime due to the reserved word being
// used. So to keep things robust we need to avoid injecting fields with reserved word
// ids/keys.
//
function isRuntimeReservedWord(str: string) {
  // these are allowed
  const browserGlobals = [
    'atob',
    'Blob',
    'btoa',
    'clearInterval',
    'clearTimeout',
    'document',
    'fetch',
    'File',
    'FileList',
    'FileReader',
    'Intl',
    'location',
    'Navigator',
    'setInterval',
    'setTimeout',
    'TextDecoder',
    'TextEncoder',
    'URL',
    'URLSearchParams',
    'window'
  ];
  const otherGlobals = ['feathery', 'console'];
  return browserGlobals.includes(str) || otherGlobals.includes(str);
}
// Helper function to check if a string is a Javascript reserved word
function isJsReservedWord(str: string) {
  const reservedWords = [
    'abstract',
    'await',
    'boolean',
    'break',
    'byte',
    'case',
    'catch',
    'char',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'double',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'final',
    'finally',
    'float',
    'for',
    'function',
    'goto',
    'if',
    'implements',
    'import',
    'in',
    'instanceof',
    'int',
    'interface',
    'let',
    'long',
    'native',
    'new',
    'null',
    'package',
    'private',
    'protected',
    'public',
    'return',
    'short',
    'static',
    'super',
    'switch',
    'synchronized',
    'this',
    'throw',
    'throws',
    'transient',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'volatile',
    'while',
    'with',
    'yield'
  ];

  return reservedWords.includes(str);
}

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
  if (meta.default_value) {
    if (['multiselect', 'dropdown_multi'].includes(servar.type)) {
      return meta.default_value.split(',').map((val: string) => val.trim());
    }
    return meta.default_value;
  }
  if (servar.type === 'date_selector' && meta.default_date_today)
    return formatDateString(new Date(), meta.choose_time);

  const matrixVal: Record<string, any> = {};
  let country: string;
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
    case 'dropdown_multi':
    case 'button_group':
    case 'multiselect':
      return [];
    case 'gmap_state':
      return meta.default_state ?? '';
    case 'gmap_country':
      country = meta.default_country;
      if (!country) return '';
      if (meta.store_abbreviation) return country;
      else return findCountryByID(country)?.countryName ?? '';
    case 'matrix':
      (meta.questions as any[])
        .filter((question) => question.default_value)
        .forEach((question) => {
          const val = question.default_value;
          matrixVal[question.id] = meta.multiple
            ? val.split(',').map((v: string) => v.trim())
            : [val];
        });
      return matrixVal;
    default:
      return '';
  }
}

export function getDefaultFormFieldValue(field: any) {
  // Default value is null for file_upload, but value should always be an
  // array regardless if repeated or not
  if (field.servar.type === 'file_upload') return [];

  const val = getDefaultFieldValue(field);
  return field.servar.repeated ? [val] : val;
}

export type OptionType =
  | string
  | { value: string; label?: string; image?: string };
// TODO: remove string[] for backcompat
export type FieldOptions = Record<string, OptionType[]>;

export function updateStepFieldOptions(
  step: any,
  newOptions: FieldOptions,
  repeatIndex?: number
) {
  step.servar_fields.forEach((field: any) => {
    const servar = field.servar;
    if (servar.key in newOptions) {
      const options = newOptions[servar.key];
      if (repeatIndex === null || repeatIndex === undefined) {
        servar.metadata.options = options.map((option) =>
          typeof option === 'object' ? option.value : option
        );
        servar.metadata.option_labels = options.map((option) =>
          typeof option === 'object' ? option.label ?? option.value : option
        );
        servar.metadata.option_images = options.map((option) =>
          typeof option === 'object' ? option.image ?? '' : ''
        );
      } else {
        if (!servar.metadata.repeat_options)
          servar.metadata.repeat_options = [];
        servar.metadata.repeat_options[repeatIndex] = options.map((option) =>
          typeof option === 'object' ? option.value : option
        );
      }
    }
  });
}

export type FieldStyles = Record<string, any>;

export function updateStepFieldStyles(
  step: any,
  fieldKey: string,
  newStyles: FieldStyles
) {
  step.servar_fields.forEach((field: any) => {
    const servar = field.servar;
    if (servar.key === fieldKey) Object.assign(field.styles, newStyles);
  });
}

export type FieldProperties = Record<string, any>;
export function updateStepFieldProperties(
  step: any,
  fieldKey: string,
  newProperties: Record<string, any>
) {
  step.servar_fields.forEach((field: any, i: number) => {
    const servar = field.servar;
    if (servar.key === fieldKey) Object.assign(field.properties, newProperties);
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

export const lookUpTrigger = (
  step: any,
  elementID: string,
  type: string
): Record<string, any> => {
  let payload = {};
  if (type === 'button') {
    const element = step.buttons.find((button: any) => button.id === elementID);
    payload = { text: element?.properties?.text ?? '' };
  } else if (type === 'text') {
    const element = step.texts.find((text: any) => text.id === elementID);
    payload = { text: element.properties.text };
  } else if (type === 'field') {
    const element = step.servar_fields.find(
      (field: any) => field.id === elementID
    );
    // servarId will remain undocumented and only used internally
    payload = {
      id: element.servar.key,
      _servarId: element.servar.id,
      text: element.servar.name
    };
  }
  return { id: elementID, type, ...payload };
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

    let errorTriggered = false;
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
      elements.forEach((e) => {
        if (e) {
          e.setCustomValidity(message);
          if (triggerErrors) {
            // Trigger manually-set errors first before other form errors
            e.reportValidity();
            errorTriggered = true;
          }
        }
      });
    }
    if (triggerErrors && !errorTriggered) formRef.current.reportValidity();
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

export function changeStep(
  newKey: string,
  oldKey: string,
  steps: any,
  setStepKey: any,
  history: any
) {
  const sameKey = oldKey === newKey;
  if (!sameKey && newKey) {
    if (newKey in steps) {
      history.replace(location.pathname + location.search + `#${newKey}`);
      setStepKey(newKey);
      return true;
    } else console.warn(`${newKey} is not a valid step to navigate to`);
  }
  return false;
}

export function getNewStepUrl(stepKey: any) {
  return location.pathname + location.search + `#${stepKey}`;
}

export function getPrevStepKey(curStep: any, stepMap: Record<string, string>) {
  let newStepKey = stepMap[curStep.key];
  if (!newStepKey) {
    const prevCondition = curStep.previous_conditions[0];
    if (prevCondition) newStepKey = prevCondition.previous_step_key;
  }
  return newStepKey;
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
  return initialStepId || sessionCurrentStep || (getOrigin as any)(steps).key;
}

export function castVal(
  servarType: string | undefined,
  val: any,
  repeated = false
): any {
  if (Array.isArray(val)) {
    if (ARRAY_FIELD_TYPES.includes(servarType ?? '')) return val;
    else return val.map((entry) => castVal(servarType, entry));
  }

  // If there is no type, it is a hidden field and we will treat it as a string
  if (servarType === undefined) return String(val);
  else if (ARRAY_FIELD_TYPES.includes(servarType) || repeated) return [val];

  let newVal;
  switch (servarType) {
    case 'currency':
    case 'integer_field':
    case 'rating':
    case 'slider':
      newVal = Number(val);
      break;
    case 'checkbox':
      newVal = !['False', 'false', false].includes(val);
      break;
    default:
      newVal = String(val);
      break;
  }

  return newVal;
}

export function getServarAttrMap(steps: any) {
  const servarKeyToTypeMap: Record<
    string,
    { type: string; repeated: boolean }
  > = {};
  if (steps) {
    Object.values(steps).forEach((step: any) => {
      step.servar_fields.forEach(({ servar }: any) => {
        servarKeyToTypeMap[servar.key] = {
          type: servar.type,
          repeated: servar.repeated
        };
      });
    });
  }
  return servarKeyToTypeMap;
}
// Reorders by leaving non-execution order actions in place and moving actons with specific
// exceution orders to the end.  Non-priority order actions are
// essenially order 0 (before others).
export function prioritizeActions(actions: any[]) {
  const newActions = [...actions];
  Object.entries(ACTION_EXECUTION_ORDER)
    .sort((a, b) => a[1] - b[1])
    .forEach(([action]) => {
      const index = newActions.findIndex((a) => a.type === action);
      if (index > -1) {
        newActions.push(newActions.splice(index, 1)[0]);
      }
    });
  return newActions;
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

  const onlyExits = ['buttons', 'texts', 'subgrids'].every((key) =>
    step[key].every((b: any) =>
      (b.properties.actions ?? []).every(
        (action: any) => action.type === ACTION_URL
      )
    )
  );
  if (onlyExits && step.servar_fields.length === 0) return true;

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
  updateFieldValues: any;
  client: FeatheryClient;
  saveUrlParams: boolean;
  initialValues: any;
  steps: any;
}) {
  let rerenderRequired = false;
  // Submit initial values & URL params
  let valuesToSubmit: Record<string, any> = {};
  if (!isObjectEmpty(initialValues)) {
    rerenderRequired = true;
    const servarAttrMap = getServarAttrMap(steps);
    valuesToSubmit = { ...initialValues };
    Object.entries(valuesToSubmit).map(([key, val]) => {
      const attrs = servarAttrMap[key] ?? {};
      valuesToSubmit[key] = castVal(attrs.type, val, attrs.repeated);
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
    updateFieldValues(valuesToSubmit, { rerender: rerenderRequired });
    client.submitCustom(valuesToSubmit, false);
  }
}

export function mapFormSettingsResponse(res: any) {
  return {
    errorType: res.error_type,
    autocomplete: res.autocomplete ? 'on' : 'off',
    autofocus: res.autofocus,
    allowEdits: res.allow_edits,
    completionBehavior: res.completion_behavior,
    showBrand: Boolean(res.show_brand),
    brandPosition: res.brand_position,
    autoscroll: res.autoscroll,
    rightToLeft: res.right_to_left,
    saveUrlParams: res.save_url_params,
    enterToSubmit: res.enter_submit,
    globalStyles: res.global_styles,
    saveHideIfFields: res.save_hide_if_fields
  };
}

export async function updateCustomHead(headCode: string) {
  if (!headCode) return;

  const parser = new DOMParser();
  const doc = parser.parseFromString(headCode, 'text/html');

  const scriptWait: any[] = [];
  doc.querySelectorAll('*').forEach((custom) => {
    if (['HEAD', 'HTML', 'BODY'].includes(custom.tagName)) return;
    if (custom.tagName === 'SCRIPT') {
      const customScript = custom as HTMLScriptElement;
      // Parsed script cannot be added directly, must be transferred to a
      // created element
      const el = featheryDoc().createElement(customScript.tagName);
      el.type = customScript.type;
      if (customScript.text) el.text = customScript.text;
      if (customScript.src) {
        el.src = customScript.src;
        scriptWait.push(
          new Promise((resolve) => (el.onload = () => resolve(custom)))
        );
      }
      custom = el;
    }
    featheryDoc().head.appendChild(custom);
  });
  await Promise.all(scriptWait);
}

export function httpHelpers(client: any, connectorFields: string[] = []) {
  const helpers: Record<string, any> = {};
  [
    'GET',
    'get',
    'PATCH',
    'patch',
    'POST',
    'post',
    'PUT',
    'put',
    'DELETE',
    'delete'
  ].forEach(
    (method) =>
      (helpers[method] = (
        url: string,
        data: Record<string, any> | any[],
        headers: Record<string, string>
      ) => {
        if (!url) return;

        const _fieldValues: { [key: string]: any } = connectorFields.reduce(
          (acc, fieldKey) => ({
            ...acc,
            [fieldKey]: fieldValues[fieldKey]
          }),
          {}
        );
        _fieldValues.feathery_user_id = initState.userId;

        return client.runCustomRequest(
          { method: method.toUpperCase(), url, data, headers },
          _fieldValues
        );
      })
  );

  helpers.connect = async (name: string) => {
    if (!name) return {};

    const _fieldValues: { [key: string]: any } = connectorFields.reduce(
      (acc, fieldKey) => ({
        ...acc,
        [fieldKey]: fieldValues[fieldKey]
      }),
      {}
    );
    _fieldValues.feathery_user_id = initState.userId;

    const response = await client.runCustomRequest(name, _fieldValues);

    if (response?.field_values) setFieldValues(response?.field_values);

    return {
      data: response.data,
      statusCode: response.status_code
    };
  };

  return helpers;
}

export function isElementInViewport(el: any) {
  const rect = el.getBoundingClientRect();

  const height =
    featheryWindow().innerHeight || featheryDoc().documentElement.clientHeight;
  const width =
    featheryWindow().innerWidth || featheryDoc().documentElement.clientWidth;
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= height &&
    rect.right <= width
  );
}
