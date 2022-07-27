import React from 'react';
import Elements from '../../elements';
import {
  getFieldValue,
  setFormElementError,
  getInlineError,
  isFieldActuallyRequired,
  isFieldValueEmpty,
  reactFriendlyKey,
  shouldElementHide,
  textFieldShouldSubmit
} from '../../utils/formHelperFunctions';
import { fieldCounter } from '../Form';
import { justRemove } from '../../utils/array';
import { isObjectEmpty, stringifyWithNull } from '../../utils/primitives';

const mapFieldTypes = new Set([
  'gmap_line_1',
  'gmap_line_2',
  'gmap_city',
  'gmap_state',
  'gmap_zip'
]);

const Cell = ({ node: el, form }) => {
  const { type } = el;

  const {
    userProgress,
    curDepth,
    maxDepth,
    elementProps,
    fieldValues,
    handleRedirect,
    activeStep,
    loaders,
    buttonOnClick,
    fieldOnChange,
    inlineErrors,
    setInlineErrors,
    repeatTriggerExists,
    changeValue,
    updateFieldValues,
    handleCheckboxGroupChange,
    handleOtherStateChange,
    setGMapBlurKey,
    elementOnView,
    onViewElements,
    formSettings,
    clearFilePathMapEntry,
    formRef,
    focusRef,
    steps,
    setCardElement
  } = form;

  const fieldId = el.servar?.key ?? el.id;
  let onView;
  if (elementOnView && onViewElements.includes(fieldId)) {
    onView = (isVisible) => elementOnView(fieldId, isVisible);
  }

  if (
    shouldElementHide({
      fields: activeStep.servar_fields,
      values: fieldValues,
      element: el
    })
  ) {
    return null;
  }

  const inlineError =
    formSettings.errorType === 'inline' && getInlineError(el, inlineErrors);
  const basicProps = {
    key: reactFriendlyKey(el),
    componentOnly: false,
    element: el,
    elementProps: elementProps[el.id],
    onView,
    inlineError
  };
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
        values={fieldValues}
        handleRedirect={handleRedirect}
        conditions={activeStep.next_conditions}
        {...basicProps}
      />
    );
  else if (type === 'button') {
    let disabled = false;
    if (el.properties.disable_if_fields_incomplete) {
      disabled = activeStep.servar_fields
        .filter(
          (field) =>
            !shouldElementHide({
              fields: activeStep.servar_fields,
              values: fieldValues,
              element: field
            })
        )
        .some((field) => {
          if (isFieldActuallyRequired(field, repeatTriggerExists)) {
            const servar = field.servar;
            return isFieldValueEmpty(fieldValues[servar.key], servar);
          }
          return false;
        });
    }
    return (
      <Elements.ButtonElement
        values={fieldValues}
        loader={
          loaders[el.id]?.showOn === 'on_button' && loaders[el.id]?.loader
        }
        handleRedirect={handleRedirect}
        onClick={() => buttonOnClick(el)}
        disabled={disabled}
        {...basicProps}
      />
    );
  } else if (type === 'field') {
    fieldCounter.value++;
    const thisCounter = fieldCounter.value;
    const index = el.repeat ?? null;
    const servar = el.servar;
    const { value: fieldVal } = getFieldValue(el, fieldValues);
    const autosubmit = el.properties.submit_trigger === 'auto';

    let otherVal = '';
    if (servar.metadata.other) {
      if (
        servar.type === 'select' &&
        !servar.metadata.options.includes(fieldVal)
      ) {
        otherVal = fieldVal;
      } else if (servar.type === 'multiselect') {
        fieldVal.forEach((val) => {
          if (!servar.metadata.options.includes(val)) otherVal = val;
        });
      }
    }

    const onChange = fieldOnChange({
      fieldIDs: [el.id],
      fieldKeys: [servar.key],
      elementRepeatIndex: el.repeat || 0
    });

    const required = isFieldActuallyRequired(el, repeatTriggerExists);
    const fieldProps = {
      key: reactFriendlyKey(el),
      element: el,
      componentOnly: false,
      elementProps: elementProps[servar.key],
      autoComplete: formSettings.autocomplete,
      inlineError,
      required,
      onView
    };

    switch (servar.type) {
      case 'date_selector':
        return (
          <Elements.DateSelectorField
            {...fieldProps}
            value={fieldVal}
            onChange={(val) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref) => {
              if (thisCounter === 1) focusRef.current = ref;
            }}
          />
        );
      case 'signature':
        return (
          <Elements.SignatureField
            {...fieldProps}
            defaultValue={fieldVal}
            onEnd={(newFile) => {
              clearFilePathMapEntry(servar.key, servar.repeated ? index : null);
              fieldValues[servar.key] = Promise.resolve(newFile);
              onChange();
            }}
            onClear={() => {
              fieldValues[servar.key] = null;
              onChange();
            }}
          />
        );
      case 'file_upload':
        return (
          <Elements.FileUploadField
            {...fieldProps}
            onChange={(files, fieldIndex) => {
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
            onClick={(option) => {
              const {
                metadata: { multiple },
                required
              } = el.servar;
              if (multiple) {
                const existingIndex = fieldVal.indexOf(option);
                if (existingIndex === -1) {
                  changeValue([...fieldVal, option], el, index);
                } else {
                  changeValue(justRemove(fieldVal, existingIndex), el, index);
                }
              } else {
                changeValue(
                  // Allow de-selection if field is optional
                  !required && fieldVal[0] === option ? [] : [option],
                  el,
                  index
                );
              }
              onChange({ submitData: !multiple && autosubmit && option });
            }}
          />
        );
      case 'checkbox':
        return (
          <Elements.CheckboxField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e) => {
              const val = e.target.checked;
              changeValue(val, el, index);
              onChange();
            }}
          />
        );
      case 'dropdown':
      case 'gmap_state':
        return (
          <Elements.DropdownField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e) => {
              const val = e.target.value;
              changeValue(val, el, index);
              onChange({ submitData: autosubmit && val });
            }}
          />
        );
      case 'pin_input':
        return (
          <Elements.PinInputField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(val) => {
              const change = changeValue(val, el, index, false);
              if (change)
                onChange({
                  submitData: autosubmit && val.length === el.servar.max_length
                });
            }}
            shouldFocus
          />
        );
      case 'multiselect':
        return (
          <Elements.CheckboxGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            otherVal={otherVal}
            onChange={(e) => {
              handleCheckboxGroupChange(e, servar.key);
              onChange();
            }}
            onOtherChange={(e) => {
              handleOtherStateChange(otherVal)(e);
              onChange();
            }}
          />
        );
      case 'select':
        return (
          <Elements.RadioButtonGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            otherVal={otherVal}
            onChange={(e) => {
              const val = e.target.value;
              changeValue(val, el, index);
              onChange({ submitData: autosubmit && val });
            }}
            onOtherChange={(e) => {
              handleOtherStateChange(otherVal)(e);
              onChange({ submitData: autosubmit && e.target.value });
            }}
          />
        );
      case 'hex_color':
        return (
          <Elements.ColorPickerField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(color) => {
              changeValue(color, el, index);
              onChange({ submitData: autosubmit && color });
            }}
          />
        );
      case 'text_area':
        return (
          <Elements.TextArea
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onChange={(e) => {
              const val = e.target.value;
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            setRef={(ref) => {
              if (thisCounter === 1) focusRef.current = ref;
            }}
          />
        );
      case 'gmap_line_1':
        return (
          <Elements.AddressLine1
            {...fieldProps}
            value={stringifyWithNull(fieldVal)}
            onBlur={() => setGMapBlurKey(servar.key)}
            onChange={(e) => {
              const val = e.target.value;
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            onSelect={(address) => {
              const keyIDMap = {};
              const addrValues = {};

              const trackMapFields = (step) => {
                step.servar_fields.forEach((field) => {
                  const servar = field.servar;
                  if (servar.type in address) {
                    addrValues[servar.key] = address[servar.type];
                    keyIDMap[servar.key] = field.id;
                  } else if (mapFieldTypes.has(servar.type)) {
                    addrValues[servar.key] = '';
                    keyIDMap[servar.key] = field.id;
                  }
                });
              };
              Object.values(steps).forEach((step) => trackMapFields(step));
              // register current step field IDs if possible
              trackMapFields(activeStep);

              if (!isObjectEmpty(Object.keys(addrValues))) {
                updateFieldValues(addrValues);
                fieldOnChange({
                  fieldIDs: Object.values(keyIDMap),
                  fieldKeys: Object.keys(keyIDMap)
                })({
                  trigger: 'addressSelect',
                  integrationData: address.address_components
                });
              }
            }}
            setRef={(ref) => {
              if (thisCounter === 1) focusRef.current = ref;
            }}
          />
        );
      case 'payment_method':
        return (
          <Elements.PaymentMethodField
            {...fieldProps}
            setCardElement={setCardElement}
            setFieldError={(message) =>
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
            onChange={(val) => {
              const change = changeValue(val, el, index);
              if (change) onChange();
            }}
            errorDisplayMode={formSettings.errorType}
          />
        );
      default:
        return (
          <Elements.TextField
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onAccept={(val, mask) => {
              const newVal = mask._unmaskedValue === '' ? '' : val;
              const change = changeValue(newVal, el, index, false);
              if (change) {
                const submitData =
                  autosubmit && textFieldShouldSubmit(servar, newVal);
                onChange({ submitData });
              }
            }}
            setRef={(ref) => {
              if (thisCounter === 1) focusRef.current = ref;
            }}
          />
        );
    }
  }

  return null;
};

export default Cell;
