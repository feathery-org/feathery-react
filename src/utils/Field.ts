import { defaultClient, FeatheryFieldTypes, fieldValues } from './init';
import debounce from 'lodash.debounce';
import { rerenderAllForms, OptionType } from './formHelperFunctions';
import {
  evalComparisonRule,
  OPERATOR_CODE,
  ResolvedComparisonRule
} from './logic';
import { dataURLToFile, isBase64Image } from './image';
import internalState from './internalState';

/**
 * Represents a field in a form.  Part of the SDK coding model.
 * For repeating fields, value is an array.
 *
 * myField.value is the raw value of the field and will either be a single value or an array
 * This enables the following sorts of syntax in rules:
 * myField.value = 'blaa' if it is not repeating
 * myField.value[0] = 'blaa' if it is repeating
 * myField.equals('something')    (non-repeating or repeating)
 * myField.value[0] === 'something'    (repeating)
 * myField.value === ['something','another']    (repeating - all fields)
 *
 * NOTE: I tried to make this a subclass of Array<Field> but that didn't work out.  Extending
 * the builtin array type requires native true ES6 syntax and with webpack it seems to be
 * not supported.  It would have been a much cleaner implementation and cleaner and simpler syntax
 * for working with repeats.
 * The syntax above is a bit more verbose but will have to do for now.
 * SEE: https://stackoverflow.com/questions/35128241/extreme-es6-array-extension-weirdness-it-reverts-to-regular-array-with-webpack
 */

export default class Field {
  _fieldKey = '';
  _formUuid = '';
  _hiddenField = false;
  _repeatingFields = new Array<Field>();
  _sourceField: any = null;

  constructor(fieldKey: string, formUuid: string, hiddenField = false) {
    this._fieldKey = fieldKey;
    this._formUuid = formUuid;
    this._hiddenField = hiddenField;
  }

  get id(): string {
    return this._fieldKey;
  }

  // raw field value
  get value(): FeatheryFieldTypes {
    // need to track changes via a proxy to any field value that is an Object or Array
    if (
      fieldValues[this._fieldKey] !== null &&
      fieldValues[this._fieldKey] instanceof Object
    )
      return new Proxy(fieldValues[this._fieldKey] as object, {
        set: (target: any, property: any, value) => {
          target[property] = parseUserVal(value, this._fieldKey);
          // we just need to know there is a change
          updateFieldKeys.push(this._fieldKey);
          notifyFieldsChanged();
          return true;
        }
      });
    return fieldValues[this._fieldKey];
  }

  // set raw field value
  set value(val: FeatheryFieldTypes) {
    if (Array.isArray(val))
      fieldValues[this._fieldKey] = val.map((entry) =>
        parseUserVal(entry, this._fieldKey)
      );
    else fieldValues[this._fieldKey] = parseUserVal(val, this._fieldKey);

    // update
    updateFieldKeys.push(this._fieldKey);
    notifyFieldsChanged();
  }

  _getFormSpecificProps(): {
    type: string;
    displayText: string;
    onThisForm: boolean;
  } {
    const field = this._getSourceField();
    const type = field ? field.servar.type : '';
    const displayText = field ? field.servar.name : '';
    const onThisForm = !!field;
    return { type, displayText, onThisForm };
  }

  _getSourceField(): any {
    if (this._sourceField === null && internalState) {
      this._sourceField = Object.values(
        internalState[this._formUuid].steps
      ).reduce((field: any, step: any) => {
        if (field) return field;
        return step.servar_fields.find(
          (field: any) => field.servar.key === this._fieldKey
        );
      }, null);
    }
    return this._sourceField;
  }

  // read-only props that are only relevant to form fields
  get type(): string {
    const { type, onThisForm } = this._getFormSpecificProps();
    if (!onThisForm)
      console.warn(
        'The type property is only available for fields in this form'
      );
    return type;
  }

  set type(val: string) {
    console.warn('The type property is read-only');
  }

  get displayText(): string {
    const { displayText, onThisForm } = this._getFormSpecificProps();
    if (!onThisForm)
      console.warn(
        'The displayText property is only available for fields in this form'
      );
    return displayText;
  }

  set displayText(val: string) {
    console.warn('The displayText property is read-only');
  }

  get onThisForm(): boolean {
    const { onThisForm } = this._getFormSpecificProps();
    return onThisForm;
  }

  set onThisForm(val: boolean) {
    console.warn('The onThisForm property is read-only');
  }

  // Indicates that this field is a hidden field (not that it is hidden)
  get isHiddenField(): boolean {
    return this._hiddenField;
  }

  set isHiddenField(val: boolean) {
    console.warn('The isHiddenField property is read-only');
  }

  // options for the field
  get options(): OptionType[] {
    const field = this._getSourceField();
    return field
      ? field.servar.metadata.options.map((option: string, index: number) => ({
          value: option,
          label: (field.servar.metadata.option_labels ?? [])[index]
        }))
      : [];
  }

  // options for the field
  // you cannot modify the options directly in-place.
  // You need to explicitly set options to change.
  set options(newOptions: OptionType[]) {
    const { steps, updateFieldOptions, currentStep } =
      internalState[this._formUuid];
    updateFieldOptions(steps, currentStep)({ [this._fieldKey]: newOptions });
  }

  // errors for a field - write only
  setError(errors: string | { index: number; message: string }) {
    internalState[this._formUuid].setFieldErrors({ [this._fieldKey]: errors });
  }

  // helper function to create a comparisonRule
  _comparisonRule(
    comparison: OPERATOR_CODE,
    values?: ({ id: string } | string)[]
  ): ResolvedComparisonRule {
    return {
      comparison,
      values: (values ?? []).map((v) =>
        typeof v === 'string'
          ? v
          : { field_key: v.id, field_id: v.id, field_type: 'servar' }
      ),
      field_id: null,
      field_key: this._fieldKey,
      field_type: 'servar'
    };
  }

  _executeLogic(
    comparison: OPERATOR_CODE,
    values?: ({ id: string } | string)[]
  ): boolean {
    return evalComparisonRule(this._comparisonRule(comparison, values));
  }

  /// ////////////////////////////////////////////////////////////////////////
  //
  // Comparison operator methods
  //
  /// ////////////////////////////////////////////////////////////////////////
  equals(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('equal', values);
  }

  notEquals(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('not_equal', values);
  }

  greaterThan(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('greater_than', values);
  }

  greaterThanOrEqual(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('greater_than_or_equal', values);
  }

  lessThan(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('less_than', values);
  }

  lessThanOrEqual(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('less_than_or_equal', values);
  }

  isFilled(): boolean {
    return this._executeLogic('is_filled');
  }

  isEmpty(): boolean {
    return this._executeLogic('is_empty');
  }

  isTrue(): boolean {
    return this._executeLogic('is_true');
  }

  isFalse(): boolean {
    return this._executeLogic('is_false');
  }

  contains(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('contains', values);
  }

  doesNotContain(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('not_contains', values);
  }

  containsIgnoreCase(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('contains_ignore_case', values);
  }

  doesNotContainIgnoreCase(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('not_contains_ignore_case', values);
  }

  startsWith(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('starts_with', values);
  }

  doesNotStartWith(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('not_starts_with', values);
  }

  endsWith(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('ends_with', values);
  }

  doesNotEndWith(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('not_ends_with', values);
  }

  isNumerical(): boolean {
    return this._executeLogic('is_numerical');
  }

  isText(): boolean {
    return this._executeLogic('is_text');
  }

  selectionsInclude(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('selections_include', values);
  }

  selectionsDoNotInclude(...values: ({ id: string } | string)[]): boolean {
    return this._executeLogic('selections_dont_include', values);
  }
}

export function parseUserVal(userVal: FeatheryFieldTypes, key: string) {
  let val: FeatheryFieldTypes | File = userVal;
  if (isBase64Image(val)) val = dataURLToFile(val, `${key}.png`);
  // If the value is a file type, convert the file or files (if repeated) to Promises
  return val instanceof File ? Promise.resolve(val) : val;
}

// Debouncing the update of field values to avoid unnecessary rerenders and BE updates
const updateFieldKeys: string[] = [];

const notifyFieldsChanged = debounce(() => {
  const fieldValuesToUpdate = updateFieldKeys.reduce(
    (newObj, key) =>
      key in fieldValues ? { ...newObj, [key]: fieldValues[key] } : newObj,
    {}
  );
  // update BE
  defaultClient.submitCustom(fieldValuesToUpdate);
  updateFieldKeys.length = 0;

  rerenderAllForms();
}, 100);
