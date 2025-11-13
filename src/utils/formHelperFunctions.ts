import getRandomBoolean from './random';
import {
  fieldValues,
  filePathMap,
  fileDeduplicationCount,
  fileRetryStatus,
  initInfo,
  initState,
  setFieldValues
} from './init';
import throttle from 'lodash.throttle';
import { ACTION_EXECUTION_ORDER, ACTION_STORE_FIELD } from './elementActions';
import { featheryDoc, featheryWindow } from './browser';
import { DEFAULT_MOBILE_BREAKPOINT } from '../elements/styles';
import internalState from './internalState';
import { setSavedStepKey } from './stepHelperFunctions';

export function isStoreFieldValueAction(el: any) {
  (el.properties?.actions ?? []).some(
    (action: any) => action.type === ACTION_STORE_FIELD
  );
}

export const getABVariant = (stepRes: any) => {
  stepRes.steps = stepRes.data;
  delete stepRes.data;
  if (!stepRes.variant) return stepRes;

  const { sdkKey, userId } = initInfo();
  // If userId was not passed in, sdkKey is assumed to be a user admin key
  // and thus a unique user ID

  const useVariant = !getRandomBoolean(userId || sdkKey, stepRes.form_name);

  if (useVariant) {
    stepRes.new_form_id = stepRes.variant_id;
    stepRes.form_name = stepRes.variant_name;
    stepRes.version = stepRes.variant_version;
    stepRes.steps = stepRes.variant;
    stepRes.logic_rules = stepRes.variant_logic_rules;
    stepRes.shared_codes = stepRes.variant_shared_codes;
    stepRes.connector_fields = stepRes.variant_connector_fields;
  }

  delete stepRes.variant_id;
  delete stepRes.variant_name;
  delete stepRes.variant_version;
  delete stepRes.variant;
  delete stepRes.variant_logic_rules;
  delete stepRes.variant_shared_codes;
  delete stepRes.variant_connector_fields;
  return stepRes;
};

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

  const replaceNullInServarArrays = (
    acc: Record<string, any>,
    [key, value]: [string, any]
  ) => {
    if (Array.isArray(value) && session.servars.includes(key)) {
      acc[key] = value.map((item) => (item === null ? '' : item));
    } else {
      acc[key] = value;
    }
    return acc;
  };

  const transformedFieldValues = Object.entries(session.field_values).reduce(
    replaceNullInServarArrays,
    {}
  );

  Object.assign(fieldValues, { ...transformedFieldValues, ...filePromises });
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

      elements.forEach((element) => {
        if (!element) return;

        // If we are targeting a non-submit button, we instead target its hidden input child
        if (element.tagName === 'BUTTON' && element.type !== 'submit') {
          element = element.querySelector(`#error_${element.id}`);
        }
        element.setCustomValidity(message);
        if (triggerErrors) {
          // Trigger manually-set errors first before other form errors
          element.reportValidity();
          errorTriggered = true;
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
  delete fileDeduplicationCount[key];
  fileRetryStatus[key] = false;
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

export function remountAllForms(saveCurrentStep?: boolean) {
  if (saveCurrentStep) {
    // Save current step keys from internal state before remounting
    Object.entries(internalState).forEach(([formId, state]) => {
      if (state?.currentStep?.key) {
        setSavedStepKey(formId, state.currentStep.key);
      }
    });
  }
  Object.values(initInfo().remountCallbacks).forEach((cb) => cb());
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
    saveHideIfFields: res.save_hide_if_fields,
    clearHideIfFields: res.clear_hide_if_fields,
    mobileBreakpoint: res.mobile_breakpoint ?? DEFAULT_MOBILE_BREAKPOINT
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
      Array.from(customScript.attributes).forEach((attr) => {
        el.setAttribute(attr.name, attr.value);
      });
      // Copy inline script content
      el.textContent = customScript.textContent;
      if (el.src) {
        scriptWait.push(
          new Promise((resolve) => {
            el.onload = () => resolve(custom);
            el.onerror = () => resolve(custom);
          })
        );
      }
      custom = el;
    }
    featheryDoc().head.appendChild(custom);
  });
  await Promise.all(scriptWait);
}

export function updateCustomCSS(cssCode: string) {
  if (!cssCode) return;

  const style = featheryDoc().createElement('style');
  style.textContent = cssCode;
  featheryDoc().head.appendChild(style);
}

function getConnectorFieldValues(connectorFields: string[]) {
  const _fieldValues: { [key: string]: any } = connectorFields
    .filter((fieldKey) => !(fieldKey in filePathMap))
    .reduce(
      (acc, fieldKey) => ({
        ...acc,
        [fieldKey]: fieldValues[fieldKey]
      }),
      {}
    );
  _fieldValues.feathery_user_id = initState.userId;
  return _fieldValues;
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
      (helpers[method] = async (
        url: string,
        data: Record<string, any> | any[],
        headers: Record<string, string>
      ) => {
        if (!url) return {};

        const response = await client.runCustomRequest(
          { method: method.toUpperCase(), url, data, headers },
          getConnectorFieldValues(connectorFields)
        );

        return {
          data: response.data,
          statusCode: response.status_code,
          // status_code for backwards compatibility
          status_code: response.statusCode
        };
      })
  );

  helpers.connect = async (
    name: string,
    data: Record<string, any> | any[],
    headers: Record<string, string>
  ) => {
    if (!name) return {};

    const response = await client.runCustomRequest(
      { name, data, headers },
      getConnectorFieldValues(connectorFields)
    );

    if (response?.field_values)
      // skip server submit when setting field values here
      // because these values were just created on the server
      setFieldValues(response?.field_values, true, true);

    return {
      data: response.data,
      statusCode: response.status_code
    };
  };

  return helpers;
}
