import React from 'react';
import Elements from '../../elements';
import {
  getFieldValue,
  getInlineError,
  isFieldActuallyRequired,
  isFieldValueEmpty,
  reactFriendlyKey,
  shouldElementHide,
  textFieldShouldSubmit
} from '../../utils/formHelperFunctions';
import { stringifyWithNull } from '../../utils/string';
import { fieldCounter } from '../Form';
import { justRemove } from '../../utils/array';
import { isObjectEmpty } from '../../utils/primitives';
import { fieldValues } from '../../utils/init';

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
    submit,
    fieldOnChange,
    inlineErrors,
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
    focusRef,
    steps
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

  const basicProps = {
    key: reactFriendlyKey(el),
    componentOnly: false,
    element: el,
    elementProps: elementProps[el.id],
    onView
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

    const onClick = (e, submitData = false) => {
      const metadata = {
        elementType: 'field',
        elementIDs: [el.id],
        trigger: 'click'
      };
      if (submitData) {
        submit({ metadata, repeat: el.repeat || 0 });
      } else {
        handleRedirect({ metadata });
      }
    };

    const onChange = fieldOnChange({
      fieldIDs: [el.id],
      fieldKeys: [servar.key],
      elementRepeatIndex: el.repeat || 0
    });

    const inlineError =
      formSettings.errorType === 'inline' && getInlineError(el, inlineErrors);
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
      case 'signature':
        return (
          <Elements.SignatureField
            {...fieldProps}
            defaultValue={fieldValues[servar.key]}
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
                  el.properties.submit_trigger === 'auto' &&
                  !el.properties.multiple &&
                  files.length > 0
              });
            }}
            onClick={onClick}
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
              } = fieldProps.element.servar;
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
              onChange();
              onClick(null, el.properties.submit_trigger === 'auto');
            }}
          />
        );
      case 'checkbox':
        return (
          <Elements.CheckboxField
            {...fieldProps}
            fieldVal={fieldVal}
            onClick={onClick}
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
            onClick={onClick}
            onChange={(e) => {
              const val = e.target.value;
              changeValue(val, el, index);
              onChange({
                submitData: el.properties.submit_trigger === 'auto' && val
              });
            }}
          />
        );
      case 'pin_input':
        return (
          <Elements.PinInputField
            {...fieldProps}
            fieldVal={fieldVal}
            onClick={onClick}
            onChange={(val) => {
              const change = changeValue(val, el, index, false);
              if (change)
                onChange({
                  submitData:
                    el.properties.submit_trigger === 'auto' &&
                    val.length === el.servar.max_length
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
            onClick={onClick}
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
              onChange({
                submitData: el.properties.submit_trigger === 'auto' && val
              });
            }}
            onOtherChange={(e) => {
              handleOtherStateChange(otherVal)(e);
              onChange({
                submitData:
                  el.properties.submit_trigger === 'auto' && e.target.value
              });
            }}
            onClick={onClick}
          />
        );
      case 'hex_color':
        return (
          <Elements.ColorPickerField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(color) => {
              changeValue(color, el, index);
              onChange({
                submitData: el.properties.submit_trigger === 'auto' && color
              });
            }}
            onClick={onClick}
          />
        );
      case 'text_area':
        return (
          <Elements.TextArea
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onClick={onClick}
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
            onClick={onClick}
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
      default:
        return (
          <Elements.TextField
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onClick={onClick}
            onAccept={(val, mask) => {
              const newVal = mask._unmaskedValue === '' ? '' : val;
              const change = changeValue(newVal, el, index, false);
              if (change) {
                const submitData =
                  el.properties.submit_trigger === 'auto' &&
                  textFieldShouldSubmit(servar, newVal);
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
