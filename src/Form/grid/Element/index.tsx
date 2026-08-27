import React, { useCallback } from 'react';
import Elements from '../../../elements';
import {
  clearFilePathMapEntry,
  setFormElementError
} from '../../../utils/formHelperFunctions';
import { getFieldValue } from '../../../utils/fieldHelperFunctions';
import {
  isNum,
  isObjectEmpty,
  stringifyWithNull
} from '../../../utils/primitives';
import { justRemove } from '../../../utils/array';
import { fieldValues, initState } from '../../../utils/init';
import { isButtonDisabled } from '../../../utils/button';
import { ACTION_NEXT } from '../../../utils/elementActions';
import {
  fileFieldShouldSubmit,
  getInlineError,
  handleCheckboxGroupChange,
  handleCheckboxGroupSelectAllChange,
  isFieldActuallyRequired,
  otherChangeCheckboxGroup,
  otherChangeRadioButtonGroup,
  textFieldShouldSubmit
} from './utils/utils';
import { getVisibleElements } from '../../../utils/hideAndRepeats';
import debounce from 'lodash.debounce';
import { isMobile } from '../../../utils/browser';
import {
  clearNonCountryAddressFields,
  getChangedAddressServarIds,
  getRelatedAddressValues
} from './utils/address';
import {
  getControllingCountryCode,
  stateFieldHasNoOptions
} from '../../../utils/addressState';

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
    tableOnClick,
    fieldOnChange,
    inlineErrors,
    setInlineErrors,
    changeValue,
    updateFieldValues,
    submitCustom,
    elementOnView,
    onViewElements,
    formSettings,
    formRef,
    focusRef,
    setCardElement,
    visiblePositions,
    featheryContext,
    assistantClient
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
  const linkId = el.properties?.link_id;
  const viewId = onViewElements.includes(fieldId)
    ? fieldId
    : linkId && onViewElements.includes(linkId)
    ? linkId
    : undefined;
  if (elementOnView && viewId)
    basicProps.onView = (inView: boolean) => elementOnView(viewId, inView);

  if (type === 'progress_bar')
    return (
      <Elements.ProgressBarElement
        {...basicProps}
        progress={userProgress}
        curDepth={curDepth}
        maxDepth={maxDepth}
        stepKey={activeStep?.key}
        runElementActions={runElementActions}
        client={form.client}
      />
    );
  else if (type === 'image') return <Elements.ImageElement {...basicProps} />;
  else if (type === 'video') return <Elements.VideoElement {...basicProps} />;
  else if (type === 'table')
    return (
      <Elements.TableElement
        {...basicProps}
        onClick={(payload: any) => tableOnClick(el, payload)}
        updateFieldValues={updateFieldValues}
        submitCustom={submitCustom}
        buttonLoaders={buttonLoaders}
        assistantClient={assistantClient}
      />
    );
  else if (type === 'tab')
    return (
      <Elements.TabsElement
        {...basicProps}
        stepKey={activeStep?.key}
        onTabClick={(entry: any, index: number) => {
          runElementActions({
            actions: [{ type: ACTION_NEXT, next_step_key: entry.step_key }],
            element: el,
            elementType: 'tab',
            submit: el.properties.submit,
            triggerPayload: {
              entryIndex: index,
              text: entry.label
            }
          });
        }}
      />
    );
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
    const disabled = isButtonDisabled(
      el,
      activeStep,
      visiblePositions,
      readOnly
    );
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

    // Submit steps by pressing `Enter`
    const onEnter = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
      if (!formSettings.enterToSubmit) return;

      // { element: Element, last: Boolean, type: 'buttons' }
      const visibleButtons = getVisibleElements(
        activeStep,
        visiblePositions,
        ['buttons'],
        false
      );

      const enterButton = visibleButtons.find(
        ({ element }: any) => element.properties.submit
      );
      if (enterButton) {
        // Simulate button click if available
        buttonOnClick(enterButton.element);
      }
    };

    const fieldProps = {
      ...basicProps,
      elementProps: elementProps[servar.key],
      autoComplete: formSettings.autocomplete,
      rightToLeft: formSettings.rightToLeft,
      disabled:
        el.properties.disabled ||
        readOnly ||
        stateFieldHasNoOptions(el, activeStep, fieldValues, index ?? undefined),
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
                  autosubmit && fileFieldShouldSubmit(servar, files, fieldIndex)
              });
            }}
            initialFiles={fieldVal}
          />
        );
      case 'audio_recording':
        return (
          <Elements.AudioRecordingField
            {...fieldProps}
            onChange={(newFile: Promise<File> | null) => {
              clearFilePathMapEntry(servar.key, servar.repeated ? index : null);
              changeValue(newFile, el, index);
              onChange();
            }}
            initialFile={fieldVal}
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
        if (servar.type === 'gmap_state')
          countryCode = getControllingCountryCode(
            el,
            activeStep,
            fieldValues,
            index ?? undefined
          );
        return (
          <Elements.DropdownField
            {...fieldProps}
            fieldVal={fieldVal}
            onChange={(e: any) => {
              const val = e.target.value;
              const previousVal = fieldVal;

              changeValue(val, el, index);

              // Clear related address fields when country changes
              let clearedServarIds: string[] = [];
              if (
                servar.type === 'gmap_country' &&
                servar.metadata.clear_address_on_change &&
                val !== previousVal
              ) {
                clearedServarIds = clearNonCountryAddressFields(
                  el,
                  activeStep,
                  fieldValues,
                  updateFieldValues,
                  index
                );
              }

              onChange({
                submitData: autosubmit && val,
                relatedServarIds: clearedServarIds
              });
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
            onSelectAllChange={(optionValues: any[], checked: boolean) => {
              const index = handleCheckboxGroupSelectAllChange(
                optionValues,
                checked,
                el,
                updateFieldValues
              );
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
                // Must be read before updateFieldValues overwrites fieldValues
                const relatedServarIds = getChangedAddressServarIds(
                  el,
                  activeStep,
                  fieldValues,
                  addrValues,
                  index
                ).filter((servarId) => servarId !== servar.id);

                updateFieldValues(addrValues);
                debouncedOnChange({
                  triggerType: 'addressSelect',
                  relatedServarIds,
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
