import React, { useCallback } from 'react';
import Elements from '../../../elements';
import {
  clearFilePathMapEntry,
  getFieldValue,
  setFormElementError
} from '../../../utils/formHelperFunctions';
import {
  isNum,
  isObjectEmpty,
  numMatchingItems,
  stringifyWithNull
} from '../../../utils/primitives';
import { isFieldValueEmpty } from '../../../utils/validation';
import { justRemove } from '../../../utils/array';
import { fieldValues, initState } from '../../../utils/init';
import {
  ACTION_STORE_FIELD,
  NAVIGATION_ACTIONS
} from '../../../utils/elementActions';
import {
  getInlineError,
  handleCheckboxGroupChange,
  isFieldActuallyRequired,
  otherChangeCheckboxGroup,
  otherChangeRadioButtonGroup,
  textFieldShouldSubmit
} from './utils/utils';
import { getVisibleElements } from '../../../utils/hideAndRepeats';
import debounce from 'lodash.debounce';
import { findCountryByID } from '../../../elements/components/data/countries';
import { isMobile } from '../../../utils/browser';
import {
  clearNonCountryAddressFields,
  getRelatedAddressValues
} from './utils/address';

const Element = ({ node: el, form }: any) => {
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
    visiblePositions,
    featheryContext
  } = form;

  const readOnly =
    formSettings.readOnly || initState.collaboratorReview === 'readOnly';
  const basicProps: Record<string, any> = {
    componentOnly: false,
    element: el,
    elementProps: elementProps[el.id],
    inlineError: getInlineError(el, inlineErrors),
    featheryContext,
    formSettings
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
        .filter(
          ({ id, properties }) =>
            id !== el.id &&
            (properties.actions ?? []).some(
              (action: any) =>
                action.type === ACTION_STORE_FIELD &&
                action.custom_store_field_key
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
    if (!disabled && readOnly) {
      const actions = el.properties.actions ?? [];
      const hasNav = actions.some((action: any) =>
        NAVIGATION_ACTIONS.includes(action.type)
      );
      // Disable buttons not used for navigation
      disabled = !hasNav;
    }
    let loaderData = buttonLoaders[el.id];
    if (isNum(loaderData?.repeat) && loaderData.repeat !== el.repeat)
      loaderData = null;
    return (
      <Elements.ButtonElement
        active={customClickSelectionState(el)}
        loader={loaderData?.loader}
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
    const index = el.repeat ?? null;
    const servar = el.servar;
    const { value: fieldVal } = getFieldValue(el);

    const empty = !fieldVal || fieldVal === servar.metadata.default_value;
    if (!focusRef.current && empty) focusRef.current = el.id;

    const autosubmit = el.properties.submit_trigger === 'auto';

    const hasRepeatOptions =
      index !== null &&
      servar.metadata.repeat_options !== undefined &&
      servar.metadata.repeat_options[index] !== undefined;

    const isOtherVal = (curVal: string) => {
      if (hasRepeatOptions) {
        return !servar.metadata.repeat_options[index].includes(curVal);
      }
      return !servar.metadata.options.includes(curVal);
    };

    let otherVal = '';
    if (servar.metadata.other) {
      if (servar.type === 'select') {
        if (isOtherVal(fieldVal)) otherVal = fieldVal;
      } else if (servar.type === 'multiselect') {
        fieldVal.forEach((val: any) => {
          if (isOtherVal(val)) otherVal = val;
        });
      }
    }

    const onChange = fieldOnChange({
      fieldID: el.id,
      fieldKey: servar.key,
      servarId: servar.id,
      elementRepeatIndex: el.repeat || 0
    });

    const debouncedOnChange = useCallback(debounce(onChange, 500), []);

    const required = isFieldActuallyRequired(el, activeStep);

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

    const fieldProps = {
      ...basicProps,
      elementProps: elementProps[servar.key],
      autoComplete: formSettings.autocomplete,
      rightToLeft: formSettings.rightToLeft,
      disabled: el.properties.disabled || readOnly,
      onEnter,
      required
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
            repeatIndex={index}
          />
        );
      case 'date_selector':
        return (
          <Elements.DateSelectorField
            {...fieldProps}
            value={fieldVal}
            onComplete={(val: any) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref: any) => {
              if (focusRef.current === el.id) focusRef.current = ref;
            }}
            repeatIndex={index}
          />
        );
      case 'signature':
        return (
          <Elements.SignatureField
            {...fieldProps}
            repeatIndex={index}
            defaultValue={fieldVal}
            onEnd={(newFile: any) => {
              if (newFile.size === 0) return;
              clearFilePathMapEntry(servar.key, servar.repeated ? index : null);
              changeValue(Promise.resolve(newFile), el, index);
              onChange();
            }}
            onClear={() => {
              changeValue(null, el, index);
              onChange();
            }}
          />
        );
      case 'qr_scanner':
        return (
          <Elements.QRScanner
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(val: string) => {
              const change = changeValue(val, el, index);
              if (change) onChange({ submitData: autosubmit && val });
            }}
          />
        );
      case 'custom':
        return (
          <Elements.CustomField
            {...fieldProps}
            rawValue={fieldVal}
            onChange={(value: any) => {
              const change = changeValue(value, el, index, true, false);
              if (change) debouncedOnChange();
            }}
            fieldStyles={el.properties.style}
            index={index}
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
            repeatIndex={index}
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
              const aMatching = numMatchingItems(el.position, a.position);
              const bMatching = numMatchingItems(el.position, b.position);
              if (aMatching < bMatching) return 1;
              if (aMatching > bMatching) return -1;
              const aNext = a.position[aMatching];
              const bNext = b.position[bMatching];
              const elNext = el.position[aMatching];
              return Math.abs(elNext - aNext) > Math.abs(elNext - bNext)
                ? 1
                : -1;
            })[0];
          if (field) {
            let value = fieldValues[field.servar.key] as string | string[];
            // Hacky patch for repeating country fields
            // TODO: fix
            if (Array.isArray(value)) value = value[0];
            if (value) {
              if (field.servar.metadata.store_abbreviation) countryCode = value;
              else
                countryCode = findCountryByID(value, 'name')?.countryCode ?? '';
            } else countryCode = '';
          }
        }
        return (
          <Elements.DropdownField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e: any) => {
              const val = e.target.value;
              const previousVal = fieldVal;

              changeValue(val, el, index);

              // Clear related address fields when country changes
              if (
                servar.type === 'gmap_country' &&
                servar.metadata.clear_address_on_change &&
                val !== previousVal
              ) {
                clearNonCountryAddressFields(
                  el,
                  activeStep,
                  fieldValues,
                  updateFieldValues,
                  index
                );
              }

              onChange({ submitData: autosubmit && val });
            }}
            countryCode={countryCode}
            setRef={(ref: any) => {
              if (focusRef.current === el.id && !isMobile())
                focusRef.current = ref;
            }}
            repeatIndex={index}
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
            repeatIndex={index}
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
                debouncedOnChange({
                  submitData: autosubmit && val.length === el.servar.max_length
                });
            }}
            autoFocus={focusRef.current === el.id && formSettings.autofocus}
          />
        );
      case 'multiselect':
        return (
          <Elements.CheckboxGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            otherVal={otherVal}
            onChange={(e: any) => {
              const index = handleCheckboxGroupChange(e, el, updateFieldValues);
              onChange({ valueRepeatIndex: index });
            }}
            onOtherChange={(e: any) => {
              const returnIndex = otherChangeCheckboxGroup(
                otherVal,
                e,
                updateFieldValues,
                index
              );
              onChange({ valueRepeatIndex: returnIndex });
            }}
            repeatIndex={index}
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
              otherChangeRadioButtonGroup(e, updateFieldValues, index);
              onChange({ submitData: autosubmit && e.target.value });
            }}
            repeatIndex={index}
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
              if (change) debouncedOnChange();
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
              const change = changeValue(val, el, index, true, false);
              if (change) debouncedOnChange();
            }}
            setRef={(ref: any) => {
              if (focusRef.current === el.id) focusRef.current = ref;
            }}
            repeatIndex={index}
          />
        );
      case 'text_area':
        return (
          <Elements.TextArea
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onChange={(e: any) => {
              const val = e.target.value;
              const change = changeValue(val, el, index, true, false);
              if (change) debouncedOnChange();
            }}
            setRef={(ref: any) => {
              if (focusRef.current === el.id) focusRef.current = ref;
            }}
            repeatIndex={index}
          />
        );
      case 'phone_number':
        return (
          <Elements.PhoneField
            {...fieldProps}
            fullNumber={stringifyWithNull(fieldVal)}
            onComplete={(val: string) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref: any) => {
              if (focusRef.current === el.id) focusRef.current = ref;
            }}
            repeatIndex={index}
          />
        );
      case 'gmap_line_1':
      case 'gmap_city':
        return (
          <Elements.AddressLine1
            {...fieldProps}
            value={stringifyWithNull(fieldVal)}
            repeatIndex={index}
            onChange={(e: any) => {
              const val = e.target.value;
              const change = changeValue(val, el, index, true, false);
              if (change) debouncedOnChange();
            }}
            onSelect={(address: any, addressId: string) => {
              const addrValues: Record<string, any> = getRelatedAddressValues(
                el,
                activeStep,
                fieldValues,
                address,
                index,
                servar
              );

              if (!isObjectEmpty(addrValues)) {
                updateFieldValues(addrValues);
                debouncedOnChange({
                  triggerType: 'addressSelect',
                  integrationData: {
                    id: addressId,
                    addressComponents: address.address_components,
                    geometry: address.geometry
                  }
                });
              }
            }}
            setRef={(ref: any) => {
              if (focusRef.current === el.id) focusRef.current = ref;
            }}
          />
        );
      case 'payment_method':
        return (
          <Elements.PaymentMethodField
            {...fieldProps}
            autoFocus={focusRef.current === el.id && formSettings.autofocus}
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
            onAccept={(val: any, mask: any) => {
              // This logic should be here and not inside the text field component
              // It was causing issues with typing in embedded forms on Android
              // PR (#1225)
              const newVal = mask._unmaskedValue === '' ? '' : val;
              if (newVal === stringifyWithNull(fieldVal)) return;

              const isOrWasEmpty = !newVal || !fieldVal;
              const rerender =
                isOrWasEmpty || (servar.metadata.options ?? []).length > 0;
              const change = changeValue(val, el, index, rerender, false);
              if (change) {
                const submitData =
                  autosubmit && textFieldShouldSubmit(servar, val);
                debouncedOnChange({ submitData });
              }
            }}
            setRef={(ref: any) => {
              if (focusRef.current === el.id) focusRef.current = ref;
            }}
            repeatIndex={index}
          />
        );
    }
  }

  return null;
};

export default Element;
