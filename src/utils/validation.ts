import {
  evalComparisonRule,
  ComparisonRule,
  ResolvedComparisonRule
} from './logic';
import { setFormElementError } from './formHelperFunctions';
import { shouldElementHide } from './hideIfs';
import { dynamicImport } from '../integrations/utils';
import React from 'react';
import { fieldValues } from './init';

export interface ResolvedCustomValidation {
  message?: string;
  rules: ResolvedComparisonRule[];
}

/**
 * Validate elements on a form
 */
function validateElements({
  elements,
  triggerErrors,
  errorType,
  formRef,
  errorCallback = () => {},
  setInlineErrors
}: {
  elements: any[];
  triggerErrors: boolean;
  errorType: string;
  formRef: React.RefObject<any>;
  errorCallback?: any;
  setInlineErrors: any;
}): {
  errors: string[];
  inlineErrors: { [key: string]: any };
  invalid: boolean;
} {
  const inlineErrors = {};
  const errors = elements
    // Skip validation on hidden elements
    .filter((element: any) => !shouldElementHide({ element }))
    .reduce((errors: any, element: any) => {
      let key, type;
      if (element.servar) {
        type = element.servar.type;
        key = element.servar.key;
      } else {
        // if not a servar, then a button
        type = 'button';
        key = element.id;
      }
      const message = validateElement(element);
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
  if (triggerErrors) {
    setFormElementError({
      formRef,
      errorType: errorType,
      inlineErrors,
      setInlineErrors,
      triggerErrors: true
    });
  }
  return {
    errors,
    inlineErrors,
    invalid: Object.values(errors).some(Boolean)
  };
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

const LIB_PHONE_NUMBER_URL =
  'https://cdn.jsdelivr.net/npm/libphonenumber-js@1.10.12/bundle/libphonenumber-js.min.js';

let phoneLibPromise = Promise.resolve();
const loadPhoneValidator = () =>
  (phoneLibPromise = dynamicImport(LIB_PHONE_NUMBER_URL));

const validators = {
  email: (a: string) => emailPattern.test(a),
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
  if (servar.type === 'phone_number' && !validators.phone(value)) {
    return 'Invalid phone number';
  } else if (servar.type === 'email' && !validators.email(value)) {
    return 'Invalid email format';
  } else if (servar.type === 'url' && !validators.url(value)) {
    return 'Invalid URL';
  } else if (servar.type === 'ssn' && value.length !== 9) {
    return 'Invalid social security number';
  } else if (
    servar.type === 'pin_input' &&
    value.length !== servar.max_length
  ) {
    return 'Please enter a full code';
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
