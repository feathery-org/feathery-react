import { evalComparisonRule, ResolvedComparisonRule } from './logic';
import { setFormElementError } from './formHelperFunctions';
import { dynamicImport } from '../integrations/utils';
import React from 'react';
import { fieldValues, initInfo } from './init';
import { getVisibleElements } from './hideAndRepeats';

export interface ResolvedCustomValidation {
  message: string;
  rules: ResolvedComparisonRule[];
}

/**
 * Validate elements on a form
 */
function validateElements({
  step,
  visiblePositions,
  triggerErrors,
  errorType,
  formRef,
  errorCallback = () => {},
  setInlineErrors
}: {
  step: any;
  visiblePositions: any;
  triggerErrors: boolean;
  errorType: string;
  formRef: React.MutableRefObject<any>;
  errorCallback?: any;
  setInlineErrors: any;
}): {
  errors: { [fieldKey: string]: string };
  inlineErrors: { [key: string]: any };
  invalid: boolean;
} {
  let invalid = false;
  const inlineErrors = {};
  const errors = getVisibleElements(
    step,
    visiblePositions,
    ['servar_fields', 'buttons'],
    true
  ).reduce((errors: any, { element, repeat, last }) => {
    let key, type;
    if (element.servar) {
      if (element.servar.repeat_trigger === 'set_value' && last && repeat > 0) {
        // Skip validation on last repeat since it might be default value
        return errors;
      }
      type = element.servar.type;
      key = element.servar.key;
    } else {
      // if not a servar, then a button
      type = 'button';
      key = element.id;
    }

    const message = validateElement(element, repeat);
    if (!(key in errors)) errors[key] = message;
    else if (Array.isArray(errors[key])) errors[key].push(message);
    else errors[key] = [errors[key], message];

    if (message && !invalid) invalid = true;

    if (triggerErrors) {
      setFormElementError({
        formRef,
        errorCallback,
        fieldKey: key,
        message,
        errorType: errorType,
        servarType: type,
        inlineErrors,
        index: repeat
      });
    }
    return errors;
  }, {});
  if (triggerErrors) {
    setFormElementError({
      formRef,
      errorType: errorType,
      inlineErrors,
      setInlineErrors,
      triggerErrors: true
    });
  }
  return { errors, inlineErrors, invalid };
}

/**
 * Performs all default/standard and custom validations on a field/element
 * and returns any validation message.
 */
function validateElement(
  element: {
    servar?: {
      type: string;
      key: string;
      metadata?: any;
      required: boolean;
      repeated: boolean;
    };
    validations?: ResolvedCustomValidation[];
  },
  repeat: any
): string {
  // First priority is standard validations for servar fields
  const { servar, validations } = element;
  if (servar) {
    let fieldVal: any = fieldValues[servar.key];
    if (servar.repeated) fieldVal = fieldVal[repeat];
    const errorMsg = getStandardFieldError(fieldVal, servar);
    if (errorMsg) return errorMsg;
  }

  // Now apply any custom validations
  if (validations) {
    const firstMatchingValidation = validations.find((validation) =>
      validation.rules.every((rule) => evalComparisonRule(rule, repeat))
    );
    if (firstMatchingValidation) return firstMatchingValidation.message;
  }
  return '';
}

//
// Standard Validations
//
const emailPatternStr =
  "^[a-zA-Z0-9.!#$%&'*+\\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]{2,63})+$";
const emailPattern = new RegExp(emailPatternStr);

const LIB_PHONE_NUMBER_URL =
  'https://cdn.jsdelivr.net/npm/libphonenumber-js@1.10.12/bundle/libphonenumber-js.min.js';

let phoneLibPromise = Promise.resolve();
const loadPhoneValidator = () =>
  (phoneLibPromise = dynamicImport(LIB_PHONE_NUMBER_URL));

const validators = {
  email: (a: string) => {
    const parts = a.split('@');
    if (parts.length !== 2) return false;
    // Email handle cannot end with '.'
    if (parts[0].endsWith('.')) return false;

    return emailPattern.test(a);
  },
  phone: (a: string) => {
    try {
      return global.libphonenumber.isValidPhoneNumber(`+${a}`);
    } catch (e) {
      // Invalid phone number
      return false;
    }
  },
  url: (a: string) => {
    try {
      return Boolean(new URL(a));
    } catch (e) {
      return false;
    }
  }
};

function isFieldValueEmpty(value: any, servar: any) {
  let noVal;
  switch (servar.type) {
    case 'select':
    case 'signature':
      noVal = !value;
      break;
    case 'checkbox':
      // eslint-disable-next-line camelcase
      noVal = !value && servar.metadata?.must_check;
      break;
    case 'file_upload':
    case 'button_group':
    case 'multiselect':
      noVal = value.length === 0;
      break;
    case 'payment_method':
      noVal = !value?.complete;
      break;
    default:
      noVal = ['', null, undefined].includes(value);
      break;
  }
  return noVal;
}

/**
 * Default validations.
 * Returns the error message for a field value if it's invalid.
 * Returns an empty string if it's valid.
 */
function getStandardFieldError(value: any, servar: any) {
  const defaultErrors = initInfo().defaultErrors;

  if (isFieldValueEmpty(value, servar)) {
    // If no value, error if field is required
    return servar.required ? defaultErrors.required : '';
  }

  const defaultErr = defaultErrors[servar.type];
  // Check if value is badly formatted
  if (servar.type === 'phone_number' && !validators.phone(value)) {
    return defaultErr;
  } else if (servar.type === 'email' && !validators.email(value)) {
    return defaultErr;
  } else if (servar.type === 'url' && !validators.url(value)) {
    return defaultErr;
  } else if (servar.type === 'ssn' && value.length !== 9) {
    return defaultErr;
  } else if (
    servar.type === 'pin_input' &&
    value.length !== servar.max_length
  ) {
    return defaultErr;
  }

  // No error
  return '';
}

export {
  validateElement,
  validateElements,
  getStandardFieldError,
  isFieldValueEmpty,
  emailPatternStr,
  loadPhoneValidator,
  validators,
  phoneLibPromise
};
