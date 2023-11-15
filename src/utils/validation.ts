import { evalComparisonRule, ResolvedComparisonRule } from './logic';
import { ARRAY_FIELD_TYPES, setFormElementError } from './formHelperFunctions';
import { dynamicImport } from '../integrations/utils';
import React from 'react';
import { fieldValues, initInfo } from './init';
import { getVisibleElements } from './hideAndRepeats';
import { Trigger } from '../types/Form';

export interface ResolvedCustomValidation {
  message: string;
  rules: ResolvedComparisonRule[];
}

const LETTER_MATCH = /[a-zA-Z]/;
const UPPERCASE_LETTER_MATCH = /[A-Z]/;
const LOWERCASE_LETTER_MATCH = /[a-z]/;
const NUMBER_MATCH = /\d/;
// eslint-disable-next-line no-useless-escape
const SYMBOL_MATCH = /[#$\.%&'()\+,-/:;<=>?@\\\[\]\^_`{|}~\*]/;

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
  setInlineErrors,
  trigger
}: {
  step: any;
  visiblePositions: any;
  triggerErrors: boolean;
  errorType: string;
  formRef: React.MutableRefObject<any>;
  errorCallback?: any;
  setInlineErrors: any;
  trigger?: Trigger;
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
  ).reduce((errors: any, { element, repeat, last, type: elementType }) => {
    let key, type;
    if (elementType === 'servar_fields') {
      if (element.servar.repeat_trigger === 'set_value' && last && repeat) {
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

    let message = validateElement(element, repeat);

    // We want to clear button errors when the button is not "relevant" to what the user is doing.
    // If the element is a button and was NOT the trigger or no trigger,
    // then we don't show the error.
    if (type === 'button' && ((trigger && key !== trigger.id) || !trigger))
      message = '';

    if (!(key in errors)) errors[key] = message;
    else if (Array.isArray(errors[key])) errors[key].push(message);
    else errors[key] = [errors[key], message];

    if (message && !invalid) invalid = true;

    if (type === 'matrix' && message) {
      // Get question index where error is
      const fieldValue: any = fieldValues[key];
      const { questions } = element.servar.metadata;
      const questionIds = questions.map((q: { id: string }) => q.id);

      for (let i = 0; i < questionIds.length; i++) {
        const value = fieldValue[questionIds[i]];
        if (
          value === undefined ||
          (Array.isArray(value) && value.length === 0)
        ) {
          key = `${key}-${i}`;
          break;
        }
      }
    }

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
  const { servar, validations } = element;

  // First priority is custom validations for servar fields
  if (validations) {
    const firstMatchingValidation = validations.find((validation) =>
      validation.rules.every((rule) => evalComparisonRule(rule, repeat))
    );
    if (firstMatchingValidation) return firstMatchingValidation.message;
  }

  // Now apply any standard validations
  if (servar) {
    let fieldVal: any = fieldValues[servar.key];
    if (servar.repeated) fieldVal = fieldVal[repeat];
    const errorMsg = getStandardFieldError(fieldVal, servar, repeat);
    if (errorMsg) return errorMsg;
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
    if (!a) return false;
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
      const urlObj = new URL(a);
      if (!urlObj) return false;
      const parts = urlObj.hostname.split('.');
      if (parts.some((part) => !part)) return false;
      return parts.length > 1;
    } catch (e) {
      return false;
    }
  }
};

function isFieldValueEmpty(value: any, servar: any) {
  if (ARRAY_FIELD_TYPES.includes(servar.type))
    return !value || value.length === 0;

  let noVal;
  switch (servar.type) {
    case 'matrix':
      // Each key in value needs to have an array with at least one value
      noVal = servar.metadata.questions.some(
        ({ id }: any) => !value[id] || value[id].length === 0
      );
      break;
    case 'select':
    case 'signature':
      noVal = !value;
      break;
    case 'checkbox':
      // eslint-disable-next-line camelcase
      noVal = !value && servar.metadata?.must_check;
      break;
    case 'payment_method':
      noVal = !value?.complete;
      break;
    case 'rating':
      noVal = !value;
      break;
    default:
      if (typeof value === 'string') value = value.trim();
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
function getStandardFieldError(value: any, servar: any, repeat: any) {
  const defaultErrors = initInfo().defaultErrors;

  if (isFieldValueEmpty(value, servar)) {
    // If no value, error if field is required
    return servar.required ? defaultErrors.required : '';
  }

  if (servar.min_length && value.length < servar.min_length) {
    return defaultErrors.minimum.replace('{length}', servar.min_length);
  }

  const defaultErr = defaultErrors[servar.type];
  // Check if value is badly formatted
  if (servar.type === 'phone_number' && !validators.phone(value)) {
    return defaultErr;
  } else if (servar.type === 'email' && !validators.email(value)) {
    return defaultErr;
  } else if (servar.type === 'url' && !validators.url(value)) {
    // Try appending https since user may have just omitted the protocol
    const newVal = 'https://' + value;
    if (validators.url(newVal)) {
      if (servar.repeated) {
        // @ts-ignore
        fieldValues[servar?.key][repeat] = newVal;
      } else fieldValues[servar.key] = newVal;
      return '';
    }
    return defaultErr;
  } else if (servar.type === 'ssn' && value.length !== 9) {
    return defaultErr;
  } else if (
    servar.type === 'pin_input' &&
    value.length !== servar.max_length
  ) {
    return defaultErr;
  } else if (servar.type === 'password') {
    const meta = servar.metadata;
    const msg = (key: string) => `Your password must have at least 1 ${key}`;
    if (meta.letter_required && !LETTER_MATCH.test(value)) return msg('letter');
    if (meta.uppercase_letter_required && !UPPERCASE_LETTER_MATCH.test(value))
      return msg('uppercase letter');
    if (meta.lowercase_letter_required && !LOWERCASE_LETTER_MATCH.test(value))
      return msg('lowercase letter');
    if (meta.number_required && !NUMBER_MATCH.test(value)) return msg('number');
    if (meta.symbol_required && !SYMBOL_MATCH.test(value)) return msg('symbol');
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
