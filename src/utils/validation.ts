import {
  evalComparisonRule,
  ComparisonRule,
  ResolvedComparisonRule
} from './logic';
import { setFormElementError, shouldElementHide } from './formHelperFunctions';
import { dynamicImport } from '../integrations/utils';
import React from 'react';
import { fieldValues } from './init';

export interface CustomValidation {
  message?: string;
  rules: ComparisonRule[];
}
export interface ResolvedCustomValidation {
  message?: string;
  rules: ResolvedComparisonRule[];
}

/**
 * Validate elements on a form
 */
function validateElements({
  elements,
  servars,
  triggerErrors,
  errorType,
  formRef,
  errorCallback = () => {},
  setInlineErrors
}: {
  elements: any[];
  servars: any[];
  triggerErrors: boolean;
  errorType: string;
  formRef: React.RefObject<any>;
  errorCallback?: any;
  setInlineErrors: any;
}): {
  errors: string[];
  invalidCheckPromise: Promise<boolean>;
  inlineErrors: { [key: string]: any };
} {
  const inlineErrors = {};
  const errors = elements
    // Skip validation on hidden elements
    .filter((element: any) => !shouldElementHide({ fields: servars, element }))
    .reduce((errors: any, element: any) => {
      const { key: servarKey, type = 'button' } = element.servar || {}; // if not a servar, then a button
      const message = validateElement(element);
      const key = servarKey || element.id;
      errors[key] = message;
      if (triggerErrors) {
        setFormElementError({
          formRef,
          errorCallback,
          fieldKey: key,
          message,
          errorType: errorType,
          servarType: type,
          inlineErrors
        });
      }
      return errors;
    }, {});
  let invalidCheckPromise = Promise.resolve(false);
  if (triggerErrors) {
    invalidCheckPromise = setFormElementError({
      formRef,
      errorType: errorType,
      inlineErrors,
      setInlineErrors,
      triggerErrors: true
    });
  }
  return { errors, invalidCheckPromise, inlineErrors };
}

/**
 * Performs all default/standard and custom validations on a field/element
 * and returns any validation message.
 */
function validateElement(element: {
  servar?: {
    type: string;
    key: string;
    metadata?: any;
    required: boolean;
  };
  validations?: ResolvedCustomValidation[];
}): string {
  // First priority is standard validations for servar fields
  const { servar, validations } = element;
  if (servar) {
    const errorMsg = getStandardFieldError(fieldValues[servar.key], servar);
    if (errorMsg) return errorMsg;
  }

  // Now apply any custom validations
  if (validations) {
    const firstMatchingValidation = validations.find((validation) =>
      validation.rules.every((rule) => evalComparisonRule(rule, fieldValues))
    );
    if (firstMatchingValidation)
      return firstMatchingValidation.message || 'Invalid'; // if no message, then a default message
  }
  return '';
}

//
// Standard Validations
//
const emailPatternStr =
  "^[a-zA-Z0-9.!#$%&'*+\\/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)+$";
const emailPattern = new RegExp(emailPatternStr);
// TODO: deprecate and support international format
const phonePattern = /^\d{10}$/;

const LIB_PHONE_NUMBER_URL =
  'https://cdn.jsdelivr.net/npm/libphonenumber-js@1.10.12/bundle/libphonenumber-js.min.js';

let phoneLibPromise = Promise.resolve();
const loadPhoneValidator = () =>
  (phoneLibPromise = dynamicImport(LIB_PHONE_NUMBER_URL));

const validators = {
  email: (a: string) => emailPattern.test(a),
  phone: (a: string) => {
    try {
      return global.libphonenumber.isValidPhoneNumber(a, 'US');
    } catch (e) {
      // Invalid phone number
      return false;
    }
  },
  internationalPhone: (a: string) => {
    try {
      return global.libphonenumber.isValidPhoneNumber(`+${a}`);
    } catch (e) {
      // Invalid phone number
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
      noVal = value.length === 0;
      break;
    case 'payment_method':
      noVal = !value?.complete;
      break;
    default:
      noVal = value === '';
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
  if (isFieldValueEmpty(value, servar)) {
    // If no value, error if field is required
    return servar.required ? 'This is a required field' : '';
  }

  // Check if value is badly formatted
  if (servar.type === 'phone_number' && !validators.internationalPhone(value)) {
    return 'Invalid phone number';
  } else if (servar.type === 'email' && !validators.email(value)) {
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
    servar.metadata.login_methods.forEach((method: any) => {
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
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

export {
  validateElement,
  validateElements,
  getStandardFieldError,
  isFieldValueEmpty,
  phonePattern,
  emailPattern,
  emailPatternStr,
  loadPhoneValidator,
  validators,
  phoneLibPromise
};
