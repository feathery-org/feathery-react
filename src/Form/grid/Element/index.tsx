import React from 'react';
import Elements from '../../../elements';
import {
  getFieldValue,
  setFormElementError,
  clearFilePathMapEntry
} from '../../../utils/formHelperFunctions';
import {
  isObjectEmpty,
  numMatchingItems,
  stringifyWithNull
} from '../../../utils/primitives';
import { isFieldValueEmpty } from '../../../utils/validation';
import { justInsert, justRemove } from '../../../utils/array';
import { fieldValues } from '../../../utils/init';
import { ACTION_STORE_FIELD } from '../../../utils/elementActions';
import {
  fieldAllowedFromList,
  getInlineError,
  handleCheckboxGroupChange,
  handleOtherStateChange,
  isFieldActuallyRequired,
  pickCloserElement,
  textFieldShouldSubmit
} from './utils';
import { getVisibleElements } from '../../../utils/hideAndRepeats';

const MAP_FIELD_TYPES = new Set([
  'gmap_line_1',
  'gmap_line_2',
  'gmap_city',
  'gmap_state',
  'gmap_country',
  'gmap_zip'
]);

const Element = ({ node: el, form, flags }: any) => {
  const { type } = el;

  const {
    userProgress,
    curDepth,
    maxDepth,
    elementProps,
    activeStep,
    buttonLoaders,
    customClickSelectionState,
    runElementActions,
    buttonOnClick,
    fieldOnChange,
    inlineErrors,
    setInlineErrors,
    changeValue,
    updateFieldValues,
    elementOnView,
    onViewElements,
    formSettings,
    formRef,
    focusRef,
    setCardElement,
    visiblePositions
  } = form;

  const basicProps: Record<string, any> = {
    componentOnly: false,
    element: el,
    elementProps: elementProps[el.id],
    inlineError: getInlineError(el, inlineErrors)
  };
  const fieldId = el.servar?.key ?? el.id;
  if (elementOnView && onViewElements.includes(fieldId))
    basicProps.onView = (isVisible: any) => elementOnView(fieldId, isVisible);

  if (type === 'progress_bar')
    return (
      <Elements.ProgressBarElement
        {...basicProps}
        progress={userProgress}
        curDepth={curDepth}
        maxDepth={maxDepth}
      />
    );
  else if (type === 'image') return <Elements.ImageElement {...basicProps} />;
  else if (type === 'video') return <Elements.VideoElement {...basicProps} />;
  else if (type === 'text')
    return (
      <Elements.TextElement
        textSpanOnClick={(
          textSpanStart: number | undefined,
          textSpanEnd: number | undefined
        ) => {
          runElementActions({
            element: el,
            actions: el.properties.actions ?? [],
            elementType: 'text',
            textSpanStart,
            textSpanEnd
          });
        }}
        conditions={activeStep.next_conditions}
        {...basicProps}
      />
    );
  else if (type === 'button') {
    let disabled = false;
    if (el.properties.disable_if_fields_incomplete) {
      const fieldsMissingValue = getVisibleElements(
        activeStep,
        visiblePositions,
        ['servar_fields'],
        true
      ).some(({ element, repeat }) => {
        if (isFieldActuallyRequired(element, activeStep)) {
          const servar = element.servar;
          let fieldVal: any = fieldValues[servar.key];
          if (servar.repeated) fieldVal = fieldVal[repeat];
          return isFieldValueEmpty(fieldVal, servar);
        }
        return false;
      });
      const storeElements = getVisibleElements(
        activeStep,
        visiblePositions,
        ['buttons', 'subgrids'],
        true
      )
        .map(({ element }) => element)
        .filter(({ properties }) =>
          (properties.actions ?? []).some(
            (action: any) => action.type === ACTION_STORE_FIELD
          )
        );
      const elementsHaveValues =
        storeElements.length === 0 || // Loose check via "some" since "requiredness" of click action
        // elements can depend on use case
        storeElements.some(({ properties }: any) =>
          (properties.actions ?? []).some(
            (action: any) =>
              action.type === ACTION_STORE_FIELD &&
              fieldValues[action.custom_store_field_key]
          )
        );
      disabled = fieldsMissingValue || !elementsHaveValues;
    }
    return (
      <Elements.ButtonElement
        active={customClickSelectionState(el)}
        loader={buttonLoaders[el.id]}
        onClick={(e: MouseEvent) => {
          // prevent auto submission!
          e.preventDefault();
          e.stopPropagation();
          buttonOnClick(el);
        }}
        disabled={disabled}
        {...basicProps}
      />
    );
  } else if (type === 'field') {
    const firstField = !flags.fieldSeen;
    flags.fieldSeen = true;

    const index = el.repeat ?? null;
    const servar = el.servar;
    const { value: fieldVal } = getFieldValue(el);
    const autosubmit = el.properties.submit_trigger === 'auto';

    let otherVal = '';
    if (servar.metadata.other) {
      if (
        servar.type === 'select' &&
        !servar.metadata.options.includes(fieldVal)
      ) {
        otherVal = fieldVal;
      } else if (servar.type === 'multiselect') {
        fieldVal.forEach((val: any) => {
          if (!servar.metadata.options.includes(val)) otherVal = val;
        });
      }
    }

    const onChange = fieldOnChange({
      fieldID: el.id,
      fieldKey: servar.key,
      servarId: servar.id,
      elementRepeatIndex: el.repeat || 0
    });

    const required = isFieldActuallyRequired(el, activeStep);
    const fieldProps = {
      ...basicProps,
      elementProps: elementProps[servar.key],
      autoComplete: formSettings.autocomplete,
      rightToLeft: formSettings.rightToLeft,
      disabled: el.properties.disabled,
      required
    };

    const onEnter = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      if (!formSettings.enterToSubmit) return;

      // Submit steps by pressing `Enter`
      const enterButton = activeStep.buttons.find(
        (b: any) => b.properties.submit
      );
      if (enterButton) {
        // Simulate button click if available
        buttonOnClick(enterButton);
      }
    };

    let countryCode = '';

    switch (servar.type) {
      case 'matrix':
        return (
          <Elements.MatrixField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e: any) => {
              const val = e.target.value;
              const questionId = e.target.dataset.questionId;
              const checked = e.target.checked;
              const type = e.target.type;
              const newFieldVal = { ...fieldVal };
              if (type === 'radio') {
                newFieldVal[questionId] = [val];
              } else if (type === 'checkbox') {
                // Add to existing array, or create new array
                if (checked) {
                  if (newFieldVal[questionId]) {
                    newFieldVal[questionId].push(val);
                  } else {
                    newFieldVal[questionId] = [val];
                  }
                } else {
                  newFieldVal[questionId] = newFieldVal[questionId].filter(
                    (v: any) => v !== val
                  );
                }
              }
              changeValue(newFieldVal, el, index);
              onChange();
            }}
          />
        );
      case 'date_selector':
        return (
          <Elements.DateSelectorField
            {...fieldProps}
            value={fieldVal}
            onChange={(val: any) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
          />
        );
      case 'signature':
        return (
          <Elements.SignatureField
            {...fieldProps}
            defaultValue={fieldVal}
            onEnd={(newFile: any) => {
              clearFilePathMapEntry(servar.key, servar.repeated ? index : null);
              updateFieldValues({ [servar.key]: Promise.resolve(newFile) });
              onChange();
            }}
            onClear={() => {
              updateFieldValues({ [servar.key]: null });
              onChange();
            }}
          />
        );
      case 'file_upload':
        return (
          <Elements.FileUploadField
            {...fieldProps}
            onChange={(files: any, fieldIndex: any) => {
              clearFilePathMapEntry(servar.key, servar.repeated ? index : null);
              changeValue(files, el, index);
              onChange({
                valueRepeatIndex: fieldIndex,
                submitData:
                  autosubmit && !el.properties.multiple && files.length > 0
              });
            }}
            initialFiles={fieldVal}
          />
        );
      case 'button_group':
        return (
          <Elements.ButtonGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            onClick={(option: any) => {
              const {
                metadata: { multiple },
                required
              } = el.servar;
              let selected = !!option;
              if (multiple) {
                const existingIndex = fieldVal.indexOf(option);
                if (existingIndex === -1) {
                  changeValue([...fieldVal, option], el, index);
                } else {
                  changeValue(justRemove(fieldVal, existingIndex), el, index);
                  selected = false;
                }
              } else {
                // Allow de-selection if field is optional
                selected = required || fieldVal[0] !== option;
                changeValue(selected ? [option] : [], el, index);
              }
              onChange({ submitData: !multiple && autosubmit && selected });
            }}
          />
        );
      case 'checkbox':
        return (
          <Elements.CheckboxField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e: any) => {
              const val = e.target.checked;
              changeValue(val, el, index);
              onChange();
            }}
          />
        );
      case 'dropdown':
      case 'gmap_state':
      case 'gmap_country':
        if (servar.type === 'gmap_state') {
          const field = activeStep.servar_fields
            .filter((field: any) => field.servar.type === 'gmap_country')
            .sort((a: any, b: any) => {
              // Assume the closest country field to
              // the state field is controlling it
              return numMatchingItems(el.position, a.position) <
                numMatchingItems(el.position, b.position)
                ? 1
                : -1;
            })[0];
          if (field) {
            let value = fieldValues[field.servar.key] as string | string[];
            // Hacky patch for repeating country fields
            // TODO: fix
            if (Array.isArray(value)) value = value[0];
            countryCode = value ?? '';
          }
        }
        return (
          <Elements.DropdownField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e: any) => {
              const val = e.target.value;
              changeValue(val, el, index);
              onChange({ submitData: autosubmit && val });
            }}
            countryCode={countryCode}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
          />
        );
      case 'dropdown_multi':
        return (
          <Elements.DropdownMultiField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(val: any) => {
              val = val.map((entry: any) => entry.value);
              changeValue(val, el, index);
              onChange();
            }}
          />
        );
      case 'pin_input':
        return (
          <Elements.PinInputField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(val: any) => {
              const change = changeValue(val, el, index, false);
              if (change)
                onChange({
                  submitData: autosubmit && val.length === el.servar.max_length
                });
            }}
            onEnter={onEnter}
            shouldFocus
          />
        );
      case 'multiselect':
        return (
          <Elements.CheckboxGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            otherVal={otherVal}
            onChange={(e: any) => {
              handleCheckboxGroupChange(e, el, updateFieldValues);
              onChange();
            }}
            onOtherChange={(e: any) => {
              handleOtherStateChange(otherVal, e, updateFieldValues);
              onChange();
            }}
            onEnter={onEnter}
          />
        );
      case 'select':
        return (
          <Elements.RadioButtonGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            otherVal={otherVal}
            onChange={(e: any) => {
              const val = e.target.value;
              changeValue(val, el, index);
              onChange({ submitData: autosubmit && val });
            }}
            onOtherChange={(e: any) => {
              handleOtherStateChange(otherVal, e, updateFieldValues);
              onChange({ submitData: autosubmit && e.target.value });
            }}
            onEnter={onEnter}
          />
        );
      case 'hex_color':
        return (
          <Elements.ColorPickerField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(color: any) => {
              changeValue(color, el, index);
              onChange({ submitData: autosubmit && color });
            }}
          />
        );
      case 'slider':
        return (
          <Elements.SliderField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(val: number) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
          />
        );
      case 'rating':
        return (
          <Elements.RatingField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(val: number) => {
              const change = changeValue(val, el, index);
              if (change) onChange({ submitData: autosubmit && val });
            }}
          />
        );
      case 'password':
        return (
          <Elements.PasswordField
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onChange={(e: any) => {
              const val = e.target.value;
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
          />
        );
      case 'text_area':
        return (
          <Elements.TextArea
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onChange={(e: any) => {
              const val = e.target.value;
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
          />
        );
      case 'phone_number':
        return (
          <Elements.PhoneField
            {...fieldProps}
            fullNumber={stringifyWithNull(fieldVal)}
            // Set values as they change since hide if dependencies need to update
            onChange={(val: string) => changeValue(val, el, index, false)}
            onComplete={(val: string) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
          />
        );
      case 'gmap_line_1':
        return (
          <Elements.AddressLine1
            {...fieldProps}
            value={stringifyWithNull(fieldVal)}
            onChange={(e: any) => {
              const val = e.target.value;
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            onSelect={(address: any, addressId: string) => {
              const addrFields: Record<string, any> = {};
              activeStep.servar_fields.forEach((field: any) => {
                const servar = field.servar;
                if (MAP_FIELD_TYPES.has(servar.type))
                  addrFields[servar.type] = pickCloserElement(
                    el,
                    addrFields[servar.type],
                    field
                  );
              });

              if (!isObjectEmpty(addrFields)) {
                const keyIDMap: Record<string, string> = {};
                const addrValues: Record<string, any> = {};
                Object.entries(addrFields).forEach(([, field]) => {
                  const servar = field.servar;
                  let val;
                  if (
                    servar.type === 'gmap_state' &&
                    servar.metadata.store_abbreviation
                  )
                    val = address.gmap_state_short;
                  else val = address[servar.type];
                  val = val ?? '';

                  addrValues[servar.key] =
                    index === null
                      ? val
                      : justInsert(fieldValues[servar.key] || [], val, index);
                  keyIDMap[servar.key] = field.id;
                });

                updateFieldValues(addrValues);
                onChange({
                  triggerType: 'addressSelect',
                  integrationData: {
                    id: addressId,
                    addressComponents: address.address_components,
                    geometry: address.geometry
                  }
                });
              }
            }}
            onEnter={onEnter}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
          />
        );
      case 'payment_method':
        return (
          <Elements.PaymentMethodField
            {...fieldProps}
            setCardElement={setCardElement}
            setFieldError={(message: any) =>
              setFormElementError({
                formRef,
                fieldKey: el.servar.key,
                message,
                errorType: formSettings.errorType,
                servarType: el.servar.type,
                inlineErrors: { ...inlineErrors },
                setInlineErrors: setInlineErrors,
                triggerErrors: true
              })
            }
            onChange={(val: any) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
          />
        );
      default:
        return (
          <Elements.TextField
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onAccept={(val: any, mask: any) => {
              const newVal = mask._unmaskedValue === '' ? '' : val;
              // Rerender only necessary if autocomplete dropdown needs
              // to be updated, first char is set, or last char is removed
              const rerender =
                (servar.metadata.options ?? []).length > 0 ||
                newVal.length <= 1;
              const change = changeValue(newVal, el, index, rerender);
              if (change) {
                const submitData =
                  autosubmit && textFieldShouldSubmit(servar, newVal);
                onChange({ submitData });
              }
            }}
            setRef={(ref: any) => {
              if (firstField) focusRef.current = ref;
            }}
            onEnter={onEnter}
          />
        );
    }
  }

  return null;
};

export default Element;
