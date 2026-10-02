import React, { useReducer, useRef } from 'react';
import Elements from './FormFrame';
import { fieldValues } from '../src/utils/init';
import { getFieldValue } from '../src/utils/fieldHelperFunctions';
import { stringifyWithNull } from '../src/utils/primitives';
import {
  handleCheckboxGroupChange,
  handleCheckboxGroupSelectAllChange,
  otherChangeCheckboxGroup,
  otherChangeRadioButtonGroup
} from '../src/Form/grid/Element/utils/utils';

// Stands in for the form around a field: the value lives in the form's global
// field values, where several fields read it from, and each servar type gets
// the props and change handler Form/grid/Element gives it.

const UNSEEDED = Symbol('unseeded');

export function StoryField({
  element,
  value,
  disabled,
  editMode
}: {
  element: any;
  /** Seeds the value, and resets it whenever the story's control changes */
  value?: any;
  disabled?: boolean;
  editMode?: string;
}) {
  const { servar } = element;
  const key = servar.key;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const seeded = useRef<any>(UNSEEDED);
  if (value !== undefined && seeded.current !== value) {
    fieldValues[key] = value;
    seeded.current = value;
  }

  const updateFieldValues = (values: Record<string, any>) => {
    Object.assign(fieldValues, values);
    rerender();
  };
  const changeValue = (val: any) => updateFieldValues({ [key]: val });
  const { value: fieldVal } = getFieldValue(element);

  // Option groups treat a value outside their options as the "other" entry
  const isOther = (val: any) => !(servar.metadata.options ?? []).includes(val);
  let otherVal = '';
  if (servar.metadata.other) {
    if (servar.type === 'select' && isOther(fieldVal)) otherVal = fieldVal;
    if (servar.type === 'multiselect')
      fieldVal.forEach((val: any) => {
        if (isOther(val)) otherVal = val;
      });
  }

  const props = {
    element,
    disabled,
    editMode,
    required: servar.required,
    onEnter: (e: any) => e.preventDefault()
  };

  switch (servar.type) {
    case 'matrix':
      return (
        <Elements.MatrixField
          {...props}
          fieldVal={fieldVal}
          onChange={(e: any) => {
            const { value: val, checked, type } = e.target;
            const questionId = e.target.dataset.questionId;
            const next = { ...fieldVal };
            if (type === 'radio') next[questionId] = [val];
            else
              next[questionId] = checked
                ? [...(next[questionId] ?? []), val]
                : next[questionId].filter((v: any) => v !== val);
            changeValue(next);
          }}
          repeatIndex={null}
        />
      );
    case 'date_selector':
      return (
        <Elements.DateSelectorField
          {...props}
          value={fieldVal}
          onComplete={changeValue}
          repeatIndex={null}
        />
      );
    case 'signature':
      return (
        <Elements.SignatureField
          {...props}
          defaultValue={fieldVal}
          onEnd={(file: any) => changeValue(Promise.resolve(file))}
          onClear={() => changeValue(null)}
          repeatIndex={null}
        />
      );
    case 'qr_scanner':
      return (
        <Elements.QRScanner
          {...props}
          fieldVal={fieldVal}
          onChange={changeValue}
        />
      );
    case 'custom':
      return (
        <Elements.CustomField
          {...props}
          rawValue={fieldVal}
          onChange={changeValue}
          fieldStyles={element.properties.style}
          index={null}
        />
      );
    case 'file_upload':
      return (
        <Elements.FileUploadField
          {...props}
          initialFiles={fieldVal}
          onChange={changeValue}
        />
      );
    case 'audio_recording':
      return (
        <Elements.AudioRecordingField
          {...props}
          initialFile={fieldVal}
          onChange={changeValue}
        />
      );
    case 'button_group':
      return (
        <Elements.ButtonGroupField
          {...props}
          fieldVal={fieldVal}
          onClick={(option: any) => {
            if (servar.metadata.multiple)
              changeValue(
                fieldVal.includes(option)
                  ? fieldVal.filter((v: any) => v !== option)
                  : [...fieldVal, option]
              );
            // An optional group can be deselected
            else
              changeValue(
                servar.required || fieldVal[0] !== option ? [option] : []
              );
          }}
          repeatIndex={null}
        />
      );
    case 'checkbox':
      return (
        <Elements.CheckboxField
          {...props}
          fieldVal={fieldVal}
          onChange={(e: any) => changeValue(e.target.checked)}
        />
      );
    case 'dropdown':
    case 'gmap_state':
    case 'gmap_country':
      return (
        <Elements.DropdownField
          {...props}
          fieldVal={fieldVal}
          onChange={(e: any) => changeValue(e.target.value)}
          countryCode={
            servar.type === 'gmap_state' ? servar.metadata.default_country : ''
          }
          repeatIndex={null}
        />
      );
    case 'dropdown_multi':
      return (
        <Elements.DropdownMultiField
          {...props}
          fieldVal={fieldVal}
          onChange={(entries: any[]) =>
            changeValue(entries.map((entry) => entry.value))
          }
          repeatIndex={null}
        />
      );
    case 'pin_input':
      return (
        <Elements.PinInputField
          {...props}
          fieldVal={fieldVal}
          onChange={changeValue}
        />
      );
    case 'multiselect':
      return (
        <Elements.CheckboxGroupField
          {...props}
          fieldVal={fieldVal}
          otherVal={otherVal}
          onChange={(e: any) =>
            handleCheckboxGroupChange(e, element, updateFieldValues)
          }
          onSelectAllChange={(options: any[], checked: boolean) =>
            handleCheckboxGroupSelectAllChange(
              options,
              checked,
              element,
              updateFieldValues
            )
          }
          onOtherChange={(e: any) =>
            otherChangeCheckboxGroup(otherVal, e, updateFieldValues, null)
          }
          repeatIndex={null}
        />
      );
    case 'select':
      return (
        <Elements.RadioButtonGroupField
          {...props}
          fieldVal={fieldVal}
          otherVal={otherVal}
          onChange={(e: any) => changeValue(e.target.value)}
          onOtherChange={(e: any) =>
            otherChangeRadioButtonGroup(e, updateFieldValues, null)
          }
          repeatIndex={null}
        />
      );
    case 'hex_color':
      return (
        <Elements.ColorPickerField
          {...props}
          fieldVal={fieldVal}
          onChange={changeValue}
        />
      );
    case 'slider':
      return (
        <Elements.SliderField
          {...props}
          fieldVal={fieldVal}
          onChange={changeValue}
        />
      );
    case 'rating':
      return (
        <Elements.RatingField
          {...props}
          fieldVal={fieldVal}
          onChange={changeValue}
        />
      );
    case 'password':
      return (
        <Elements.PasswordField
          {...props}
          rawValue={stringifyWithNull(fieldVal)}
          onChange={(e: any) => changeValue(e.target.value)}
          repeatIndex={null}
        />
      );
    case 'text_area':
      return (
        <Elements.TextArea
          {...props}
          rawValue={stringifyWithNull(fieldVal)}
          onChange={(e: any) => changeValue(e.target.value)}
          repeatIndex={null}
        />
      );
    case 'phone_number':
      return (
        <Elements.PhoneField
          {...props}
          fullNumber={stringifyWithNull(fieldVal)}
          onComplete={changeValue}
          repeatIndex={null}
        />
      );
    case 'gmap_line_1':
    case 'gmap_city':
      return (
        <Elements.AddressLine1
          {...props}
          value={stringifyWithNull(fieldVal)}
          onChange={(e: any) => changeValue(e.target.value)}
          // Suggestions need Google Places, which stories don't load
          onSelect={() => {}}
          repeatIndex={null}
        />
      );
    case 'payment_method':
      return (
        <Elements.PaymentMethodField
          {...props}
          setCardElement={() => {}}
          setFieldError={() => {}}
          onChange={changeValue}
        />
      );
    default:
      return (
        <Elements.TextField
          {...props}
          onAccept={(val: any) => changeValue(val)}
          // Changes identity with the value, so the memoized field re-renders
          value={fieldVal}
          repeatIndex={null}
        />
      );
  }
}
