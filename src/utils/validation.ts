import { evalComparisonRule, ResolvedComparisonRule } from './logic';
import { setFormElementError } from './formHelperFunctions';
import { InlineErrors } from './inlineErrors';
import { ARRAY_FIELD_TYPES } from './fieldHelperFunctions';

import React from 'react';
import { stateFieldHasNoOptions } from './addressState';
import { fieldValues, initInfo } from './init';
import { getVisibleElements } from './hideAndRepeats';
import { alignToSlider, getLinkedValue } from './valueBounds';
import { Trigger } from '../types/Form';
// @ts-ignore
import isUrl from 'is-url';

export interface ResolvedCustomValidation {
  message: string;
  rules: ResolvedComparisonRule[];
}

const LETTER_MATCH = /[a-zA-Z]/;
const UPPERCASE_LETTER_MATCH = /[A-Z]/;
const LOWERCASE_LETTER_MATCH = /[a-z]/;
const NUMBER_MATCH = /\d/;
// eslint-disable-next-line no-useless-escape
const SYMBOL_MATCH = /[#$\.%&'()\+,-/:;<=>!?@\\\[\]\^_`{|}~\*]/;
const DOMAIN_ALLOWED_CHARACTERS = /^[a-zA-Z0-9.\\-]+$/;

/**
 * Validate elements on a form
 */
function validateElements({
  step,
  visiblePositions,
  triggerErrors,
  reportNativeErrors = true,
  errorType,
  formRef,
  errorCallback = () => {},
  setInlineErrors,
  trigger
}: {
  step: any;
  visiblePositions: any;
  triggerErrors: boolean;
  reportNativeErrors?: boolean;
  errorType: string;
  formRef: React.MutableRefObject<any>;
  errorCallback?: any;
  setInlineErrors: any;
  trigger?: Trigger;
}): {
  errors: { [fieldKey: string]: string };
  inlineErrors: InlineErrors;
  invalid: boolean;
} {
  let invalid = false;
  const inlineErrors: InlineErrors = {};
  const visibleElements = getVisibleElements(
    step,
    visiblePositions,
    ['servar_fields', 'buttons'],
    true
  );
  alignSliderValues(visibleElements);
  const errors = visibleElements.reduce(
    (errors: any, { element, repeat, last, type: elementType }) => {
      let key, type;
      if (elementType === 'servar_fields') {
        if (isTrailingSetValueRow(element, repeat, last)) return errors;
        // A state field disabled for want of states can never be filled in
        if (stateFieldHasNoOptions(element, step, fieldValues, repeat)) {
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

      let inputKey = key;
      if (type === 'matrix' && message && errorType === 'html5') {
        // The `${key}-${questionIndex}` suffix targets the specific unanswered
        // matrix question's DOM control, so it is only for HTML5 targeting.
        // Inline storage must keep the real servar key, otherwise the renderer
        // (which reads inlineErrors[servar.key]) never finds the message.
        let fieldValue: any = fieldValues[key];
        // handle repeated matrix fields
        if (repeat != null && Array.isArray(fieldValue))
          fieldValue = fieldValue[repeat] ?? {};
        const { questions } = element.servar.metadata;
        const questionIds = questions.map((q: { id: string }) => q.id);

        for (let i = 0; i < questionIds.length; i++) {
          const value = fieldValue[questionIds[i]];
          if (
            value === undefined ||
            (Array.isArray(value) && value.length === 0)
          ) {
            inputKey = `${key}-${i}`;
            break;
          }
        }
      }

      if (triggerErrors) {
        setFormElementError({
          formRef,
          errorCallback,
          fieldKey: key,
          inputKey,
          message,
          errorType: errorType,
          servarType: type,
          inlineErrors,
          index: repeat
        });
      }
      return errors;
    },
    {}
  );
  if (triggerErrors) {
    setFormElementError({
      formRef,
      errorType: errorType,
      inlineErrors,
      setInlineErrors,
      triggerErrors: true,
      reportNativeErrors
    });
  }
  return { errors, inlineErrors, invalid };
}

// A set_value repeat adds a trailing row holding the default value, which isn't
// an answer until the user sets it, so it's neither validated nor aligned
function isTrailingSetValueRow(element: any, repeat: any, last?: boolean) {
  return Boolean(
    element.servar.repeat_trigger === 'set_value' && last && repeat
  );
}

// A slider submits the value it shows within its range. Sliders can bound
// other fields, so this runs before any field is validated. Each pass aligns the
// original answers against the previous pass's results, so a slider bounded by
// another slider sees its settled value whatever order the fields are in
function alignSliderValues(
  elements: { element: any; repeat: any; last?: boolean }[]
) {
  const answers = elements.flatMap(({ element, repeat, last }) => {
    const { servar } = element;
    if (servar?.type !== 'slider') return [];
    if (isTrailingSetValueRow(element, repeat, last)) return [];
    const stored: any = fieldValues[servar.key];
    const value = servar.repeated ? stored?.[repeat] : stored;
    if (isFieldValueEmpty(value, servar)) return [];
    const num = Number(value);
    return Number.isFinite(num) ? [{ servar, repeat, num }] : [];
  });
  let aligned = answers.map(({ num }) => num);
  for (let pass = 0; pass <= answers.length; pass++) {
    // Repeated fields can't bound others, so only single sliders are sources
    const values: Record<string, any> = { ...fieldValues };
    answers.forEach(({ servar }, i) => {
      if (!servar.repeated) values[servar.key] = aligned[i];
    });
    const next = answers.map(({ servar, num }) =>
      alignToSlider(num, servar, values)
    );
    const settled = next.every((value, i) => value === aligned[i]);
    aligned = next;
    if (settled) break;
  }
  answers.forEach(({ servar, repeat, num }, i) => {
    if (aligned[i] === num) return;
    if (servar.repeated) (fieldValues[servar.key] as any)[repeat] = aligned[i];
    else fieldValues[servar.key] = aligned[i];
  });
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

let phoneLib: any = null;
let phoneLibPromise: Promise<any> = Promise.resolve();
const loadPhoneValidator = () => {
  phoneLibPromise = import(
    /* webpackChunkName: "libphonenumber" */ 'libphonenumber-js'
  ).then((mod) => {
    phoneLib = mod;
    return mod;
  });
};

// The phone library is only preloaded when the form has a phone field, so
// actions that validate phone numbers from other field types must load it
const ensurePhoneValidator = async () => {
  if (!phoneLib) loadPhoneValidator();
  await phoneLibPromise;
};

const validators = {
  email: (a: string) => {
    if (!a) return false;
    const parts = a.split('@');
    if (parts.length !== 2) return false;
    // Email handle cannot end with '.'
    const part = parts[0];
    if (part.endsWith('.') || part.startsWith('.')) return false;
    if (part.includes('..')) return false;

    return emailPattern.test(a);
  },
  phone: (a: string) => {
    try {
      return phoneLib.isValidPhoneNumber(`+${a}`);
    } catch (e) {
      // Invalid phone number
      return false;
    }
  },
  url: (a: string) => {
    if (!isUrl(a)) return false;
    try {
      const urlObj = new URL(a);
      if (!urlObj) return false;
      const hostname = urlObj.hostname;
      if (hostname.length >= 64) return false;
      if (!DOMAIN_ALLOWED_CHARACTERS.test(hostname)) return false;
      const parts = hostname.split('.');
      if (parts.some((part) => !part)) return false;
      // Last part of domain cannot contain digit
      if (NUMBER_MATCH.test(parts[parts.length - 1])) return false;
      // Colon at end of hostname gets filtered out by URL object but
      // should be invalid
      if (a[urlObj.origin.length] === ':') return false;
      // Check for filtered out special characters, e.g.
      // https://@google.com -> https://google.com
      if (!a.toLowerCase().includes(`/${hostname.toLowerCase()}`)) return false;
      return parts.length > 1;
    } catch (e) {
      return false;
    }
  }
};

function isFieldValueEmpty(value: any, servar: any) {
  if (ARRAY_FIELD_TYPES.includes(servar.type)) {
    if (!value || value.length === 0) return true;

    // For file uploads and button groups, check if array contains only null/falsy values
    if (['file_upload', 'button_group'].includes(servar.type)) {
      // In repeatable containers, file upload values are stored as individual Files (not arrays)
      // because changeValue extracts value[0] for each row. Handle both cases:
      if (!Array.isArray(value)) {
        return !value; // Single file or null (from repeatable container)
      }
      if (value.every((val: any) => !val)) {
        return true;
      }
    }

    // If 'other' is selected for checkbox group, make sure it has a value
    return servar.type === 'multiselect' && value.some((val: any) => !val);
  }

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
    case 'audio_recording':
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

// Static bounds are left to the input mask; only linked bounds are checked here
function getValueBoundError(
  value: number,
  servar: any,
  defaultErrors: Record<string, string>
) {
  const min = getLinkedValue(servar.metadata?.min_value_field_key);
  const max = getLinkedValue(servar.metadata?.max_value_field_key);
  if (min !== undefined && value < min)
    return defaultErrors.minimum_value.replace('{value}', String(min));
  if (max !== undefined && value > max)
    return defaultErrors.maximum_value.replace('{value}', String(max));
  return '';
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
    // A custom logic rule may erroneously store a leading '+'. If the number
    // is otherwise valid, strip it so validation and step submission see the
    // digits-only value
    const stripped =
      typeof value === 'string' ? value.replace(/^\++/, '') : value;
    if (stripped !== value && validators.phone(stripped)) {
      if (servar.repeated) {
        // @ts-ignore
        fieldValues[servar.key][repeat] = stripped;
      } else fieldValues[servar.key] = stripped;
      return '';
    }
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
  } else if (
    servar.type === 'ssn' &&
    value.length !== (servar.metadata.last_four_digits ? 4 : 9)
  ) {
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
  } else if (servar.type === 'integer_field') {
    return getValueBoundError(Number(value), servar, defaultErrors);
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
  ensurePhoneValidator,
  validators,
  phoneLibPromise,
  phoneLib
};
