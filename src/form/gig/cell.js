import React from 'react';
import Elements from '../../elements';
import {
  getFieldValue,
  getInlineError,
  isFieldActuallyRequired,
  reactFriendlyKey,
  textFieldShouldSubmit
} from '../../utils/formHelperFunctions';
import { stringifyWithNull } from '../../utils/string';
import { fieldCounter } from '../Form';
import { justRemove } from '../../utils/array';

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
    repeatedRowCount,
    changeValue,
    updateFieldValues,
    handleCheckboxGroupChange,
    handleOtherStateChange,
    setGMapBlurKey,
    elementOnView,
    onViewElements,
    formSettings,
    clearFilePathMapEntry,
    focusRef
  } = form;

  const fieldId = el.servar?.key ?? el.id;
  let onView;
  if (elementOnView && onViewElements.includes(fieldId)) {
    onView = (isVisible) => elementOnView(fieldId, isVisible);
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
        key={`pb-${el.column_index}-${el.column_index_end}-${el.row_index}-${el.row_index_end}`}
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
  else if (type === 'button')
    return (
      <Elements.ButtonElement
        values={fieldValues}
        loader={
          loaders[el.id]?.showOn === 'on_button' && loaders[el.id]?.loader
        }
        handleRedirect={handleRedirect}
        onClick={() => buttonOnClick(el)}
        {...basicProps}
      />
    );
  else if (type === 'field') {
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

    const inlineErr =
      formSettings.errorType === 'inline' && getInlineError(el, inlineErrors);

    const required = isFieldActuallyRequired(
      el,
      repeatTriggerExists,
      repeatedRowCount
    );

    const fieldProps = {
      key: reactFriendlyKey(el),
      element: el,
      componentOnly: false,
      elementProps: elementProps[servar.key],
      autoComplete: formSettings.autocomplete,
      required,
      onView
    };

    let changeHandler;
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
            onClick={(e) => {
              const newVal = e.target.textContent;
              const {
                metadata: { multiple },
                required
              } = fieldProps.element.servar;
              if (multiple) {
                const existingIndex = fieldVal.indexOf(newVal);
                if (existingIndex === -1) {
                  changeValue([...fieldVal, newVal], el, index);
                } else {
                  changeValue(justRemove(fieldVal, existingIndex), el, index);
                }
              } else {
                changeValue(
                  // Allow de-selection if field is optional
                  !required && fieldVal[0] === newVal ? [] : [newVal],
                  el,
                  index
                );
              }
              onChange();
              onClick(e, el.properties.submit_trigger === 'auto');
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
            inlineError={inlineErr}
          />
        );
      case 'pin_input':
        return (
          <Elements.PinInputField
            {...fieldProps}
            fieldVal={fieldVal}
            onClick={onClick}
            onChange={(val) => {
              changeValue(val, el, index, false);
              onChange({
                submitData:
                  el.properties.submit_trigger === 'auto' &&
                  val.length === el.servar.max_length
              });
              onChange();
            }}
            inlineError={inlineErr}
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
        changeHandler = (e, change = true) => {
          const val = e.target.value;
          if (change) changeValue(val, el, index);
          onChange({
            submitData: el.properties.submit_trigger === 'auto' && val
          });
        };
        return (
          <Elements.RadioButtonGroupField
            {...fieldProps}
            fieldVal={fieldVal}
            otherVal={otherVal}
            onChange={changeHandler}
            onOtherChange={(e) => {
              handleOtherStateChange(otherVal)(e);
              changeHandler(e, false);
            }}
            onClick={onClick}
          />
        );
      case 'hex_color':
        changeHandler = (color) => {
          activeStep.servar_fields.forEach((field) => {
            const iterServar = field.servar;
            if (iterServar.key !== servar.key) return;
            updateFieldValues({
              [iterServar.key]: color
            });
          });
          onChange({
            submitData: el.properties.submit_trigger === 'auto' && color
          });
        };
        return (
          <Elements.ColorPickerField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={changeHandler}
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
            inlineError={inlineErr}
          />
        );
      default:
        return (
          <Elements.TextField
            {...fieldProps}
            rawValue={stringifyWithNull(fieldVal)}
            onBlur={() => {
              if (servar.type === 'gmap_line_1') setGMapBlurKey(servar.key);
            }}
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
            inlineError={inlineErr}
          />
        );
    }
  }

  return null;
};

export default Cell;
