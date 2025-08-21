import { findCountryByID } from '../elements/components/data/countries';
import { formatDateString } from '../elements/fields/DateSelectorField';
import { featheryWindow } from './browser';
import Field from './entities/Field';
import FeatheryClient from './featheryClient';
import { getVisibleElements } from './hideAndRepeats';
import { toBase64 } from './image';
import { fieldValues } from './init';
import { isObjectEmpty } from './primitives';

export const ARRAY_FIELD_TYPES = [
  'button_group',
  'file_upload',
  'multiselect',
  'dropdown_multi'
];

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

function _transformSignatureVal(value: any) {
  return value !== null && (value instanceof File || value instanceof Promise)
    ? Promise.resolve(value).then((file) => toBase64(file))
    : Promise.resolve('');
}

function _transformUrlVal(value: any) {
  return value ? value.replaceAll(' ', '%20') : value;
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

export function isValidFieldIdentifier(str: string) {
  // Regular expression to match (approximately) all valid Unicode identifiers
  // The most complete regex is here: https://stackoverflow.com/a/2008444 but seems
  // impractical to use in this case

  // @ts-ignore
  const identifierRegex = /^[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*$/u;

  // Check if the string matches the regex and is not a reserved word
  return (
    identifierRegex.test(str) &&
    !isRuntimeReservedWord(str) &&
    !isJsReservedWord(str)
  );
}

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
    return formatDateString(new Date(), meta);

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
export type FieldOptions = Record<string, OptionType[] | null>;

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
        if (!options) return;
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
        if (!options) servar.metadata.repeat_options.splice(repeatIndex, 1);
        else {
          servar.metadata.repeat_options[repeatIndex] = options;
        }
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
  newProperties: Record<string, any>,
  onServar = false
) {
  step.servar_fields.forEach((field: any) => {
    const servar = field.servar;
    if (servar.key === fieldKey) {
      Object.assign(onServar ? servar : field.properties, newProperties);
    }
  });
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
    {
      value: any;
      type: string;
      displayText: string;
      options?: any[];
      position: number[];
    }
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
      displayText: servar.name,
      position: field.position
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

export function castServarVal(
  servarType: string | undefined,
  val: any,
  repeated = false
): any {
  if (Array.isArray(val)) {
    if (ARRAY_FIELD_TYPES.includes(servarType ?? '')) return val;
    else return val.map((entry) => castServarVal(servarType, entry));
  }

  // If there is no type, we will treat it as a string
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

export function castHiddenVal(hfType: string, val: any) {
  let newVal;
  switch (hfType) {
    case 'number_value':
      newVal = Number(val);
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

export function saveInitialValuesAndUrlParams({
  updateFieldValues,
  client,
  saveUrlParams,
  initialValues,
  steps,
  hiddenFields
}: {
  updateFieldValues: any;
  client: FeatheryClient;
  saveUrlParams: boolean;
  initialValues: any;
  steps: any;
  hiddenFields: Record<string, string>;
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
      const hiddenFieldType = hiddenFields[key];
      valuesToSubmit[key] = hiddenFieldType
        ? castHiddenVal(hiddenFieldType, val)
        : castServarVal(attrs.type, val, attrs.repeated);
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
    client.submitCustom(valuesToSubmit, { override: false });
  }
}
