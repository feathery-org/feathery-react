import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { ActionMeta, OnChangeValue } from 'react-select';
import useBorder from '../../components/useBorder';
import InlineTooltip from '../../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from '../index';
import Placeholder from '../../components/Placeholder';
import HiddenValueInput from '../../components/HiddenValueInput';
import useSalesforceSync from '../../../hooks/useSalesforceSync';
import { inputBoxAttrs } from '../../styles';

import {
  Control as DropdownControl,
  CollapsibleMultiValue,
  CollapsibleMultiValueContainer,
  TooltipOption,
  CollapsibleMultiValueRemove
} from './DropdownMultiFieldSelectComponents';
import {
  DropdownCreatableSelect,
  DropdownSelect
} from './createDropdownSelect';
import { createSelectStyles } from './selectStyles';
import useMobileViewport from './useMobileViewport';
import useCollapsedSelectionManager from './useCollapsedSelectionManager';
import useDropdownOptions from './useDropdownOptions';
import useWindowedOptions from './useWindowedOptions';
import useSelectProps from './useSelectProps';
import { fieldAriaLabel } from '../shared/accessibleName';
import useDropdownInteractions from './useDropdownInteractions';
import type { CreatableValidator, OptionData } from './types';

export default function DropdownMultiField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  required = false,
  disabled = false,
  fieldVal = [],
  repeatIndex = null,
  editMode,
  onChange = () => {},
  elementProps = {},
  rightToLeft,
  children
}: any) {
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });

  const containerRef = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const servar = element.servar;
  const fieldKey = servar.key;
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

  const properties = element.properties || {};
  const translation = properties.translate || {};
  const noOptionsMessage = translation.no_options
    ? () => translation.no_options as string
    : undefined;
  const entityLabel = 'Dropdown field';

  // Controlled inputValue needed to filter full dataset before passing to react-select
  const [inputValue, setInputValue] = useState('');

  // A single max selectable option behaves like a searchable native dropdown.
  // servar is untyped, so coerce - a stored "1" must not fall back to chips.
  const isSingleSelectMode = Number(servar.max_length) === 1;

  // Single mode hands react-select one option (or null on clear), but the
  // stored field value is always a string array, so re-wrap on the way out.
  const handleValueChange = useCallback(
    (
      selected: OnChangeValue<OptionData, boolean>,
      actionMeta: ActionMeta<OptionData>
    ) => {
      if (!isSingleSelectMode || Array.isArray(selected))
        return onChange(selected, actionMeta);
      onChange(selected ? [selected] : [], actionMeta);
    },
    [isSingleSelectMode, onChange]
  );

  // Clamp what single mode displays, but leave the stored array alone: writing
  // it back on mount would fire this field's change logic rules on load.
  const displayFieldVal = useMemo(
    () =>
      isSingleSelectMode && Array.isArray(fieldVal)
        ? fieldVal.slice(0, 1)
        : fieldVal,
    [fieldVal, isSingleSelectMode]
  );

  // Build all dropdown options and selections
  const { options: allOptions, selectVal } = useDropdownOptions({
    fieldVal: displayFieldVal,
    fieldKey,
    servar,
    dynamicOptions,
    shouldSalesforceSync,
    repeatIndex,
    entityLabel
  });

  // Window options for large datasets to prevent react-select from processing all options
  const { windowedOptions: options, filterOption } = useWindowedOptions({
    options: allOptions,
    inputValue,
    selectedValues: selectVal
  });

  // Handle input changes for windowed filtering
  const handleInputChange = useCallback((newValue: string) => {
    setInputValue(newValue);
  }, []);

  const {
    collapseSelected,
    collapsedCount,
    menu,
    pointer,
    measurement,
    selectRef
  } = useCollapsedSelectionManager({
    containerRef,
    disabled,
    values: selectVal,
    isSingleSelectMode
  });

  const {
    open: openCollapseMenu,
    close: closeCollapseMenu,
    forceClose: forceCloseCollapseMenu
  } = menu;
  const { onMouseDown: focusOnMouseDown, onTouchStart: focusOnTouchStart } =
    pointer;
  const { isMeasuring, visibleCount } = measurement;
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const selectComponentsOverride = useMemo(
    () => ({
      Control: DropdownControl,
      Option: TooltipOption,
      MultiValue: CollapsibleMultiValue,
      MultiValueContainer: CollapsibleMultiValueContainer,
      MultiValueRemove: CollapsibleMultiValueRemove
    }),
    []
  );

  const disableAllOptions =
    (!isSingleSelectMode &&
      !!servar.max_length &&
      selectVal.length >= servar.max_length) ||
    loadingDynamicOptions;
  const create = servar.metadata.creatable_options;
  let formatCreateLabel: ((inputValue: string) => string) | undefined;
  if (create && translation.create_option_label) {
    const template = translation.create_option_label;
    const hasValuePlaceholder = template.includes('{value}');
    formatCreateLabel = hasValuePlaceholder
      ? (inputValue: string) => template.replace(/\{value\}/g, inputValue)
      : (inputValue: string) => `${template} "${inputValue}"`;
  }
  const isCreatableInputValid = useCallback(
    (inputValue: string) => {
      const trimmed = inputValue.trim();
      if (!trimmed) return false;
      const normalized = trimmed.toLowerCase();
      const hasOption = options.some(
        (option) => option?.value?.toLowerCase() === normalized
      );
      if (hasOption) return false;
      const hasSelected = selectVal.some(
        (option) => option?.value?.toLowerCase() === normalized
      );
      return !hasSelected;
    },
    [options, selectVal]
  );

  // React Select passes value/options/accessors here, but our validation only
  // cares about the raw input string. The rest parameters keep the signature
  // compatible while making that intent explicit.
  const isValidNewOption = useCallback<CreatableValidator>(
    (inputValue) => isCreatableInputValid(inputValue),
    [isCreatableInputValid]
  );

  // Handle all user interactions: keyboard, mouse, touch, and menu
  const {
    handleWrapperMouseDown,
    handleWrapperTouchStart,
    handleKeyDownCapture,
    handleChange,
    handleSelectKeyDown,
    handleMenuOpen,
    handleMenuClose,
    handleControlPress,
    handleCollapsedChipPress,
    extendCloseSuppression
  } = useDropdownInteractions({
    selectRef,
    containerRef,
    disabled,
    isMenuOpen,
    setIsMenuOpen,
    openCollapseMenu,
    closeCollapseMenu,
    forceCloseCollapseMenu,
    focusOnMouseDown,
    focusOnTouchStart,
    selectVal,
    options,
    isCreatableInputValid: create ? isCreatableInputValid : undefined,
    create,
    disableAllOptions,
    isSingleSelectMode,
    onChange: handleValueChange
  });

  const SelectComponent = create ? DropdownCreatableSelect : DropdownSelect;

  responsiveStyles.applyFontStyles('field');

  const shouldHideInput = collapseSelected && !isMeasuring && !focused;

  // The caret handling below is resolved in JS, so it reads the alignment the
  // way a media query would: the mobile override under the breakpoint, the
  // desktop value above it.
  const isMobileViewport = useMobileViewport(
    responsiveStyles.getMobileBreakpoint()
  );
  const align = isMobileViewport
    ? element.mobile_styles?.horizontal_align ??
      element.styles?.horizontal_align
    : element.styles?.horizontal_align;
  const aligned = align === 'center' || align === 'flex-end';

  const selectStyles = useMemo(
    () =>
      createSelectStyles({
        aligned,
        fontColor: element.styles.font_color,
        menuZIndex: DROPDOWN_Z_INDEX,
        responsiveStyles,
        rightToLeft
      }),
    [aligned, element.styles.font_color, responsiveStyles, rightToLeft]
  );

  // Organize all SelectComponent props
  const selectProps = useSelectProps({
    selectRef,
    containerRef,
    servar,
    selectVal,
    options,
    required,
    disabled,
    isMenuOpen,
    loadingDynamicOptions,
    isSingleSelectMode,
    selectStyles,
    selectComponentsOverride,
    collapseSelected,
    visibleCount,
    collapsedCount,
    isMeasuring,
    shouldHideInput,
    handleChange,
    setFocused,
    handleSelectKeyDown,
    handleMenuOpen,
    handleMenuClose,
    handleCollapsedChipPress,
    handleControlPress,
    extendCloseSuppression,
    noOptionsMessage,
    create,
    formatCreateLabel,
    isValidNewOption: create ? isValidNewOption : undefined,
    onInputChange: handleInputChange,
    filterOption,
    ariaLabel: fieldAriaLabel(element)
  });

  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        // A moved padding or alignment turns the element into a column here
        // (applyMultiselectLayout); untouched forms keep this block layout.
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:hover': disabled
            ? {}
            : {
                ...responsiveStyles.getTarget('hover'),
                ...borderStyles.hover
              },
          '&&': focused
            ? {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              }
            : {}
        }}
        onMouseDown={handleWrapperMouseDown}
        onTouchStart={handleWrapperTouchStart}
        onKeyDownCapture={handleKeyDownCapture}
        {...inputBoxAttrs(servar.type)}
      >
        {customBorder}
        <SelectComponent {...selectProps} inputValue={inputValue} />
        {/* react-select's control is built from divs, so the selection is not
            otherwise readable under the field key by certification scanners */}
        <HiddenValueInput
          name={fieldKey}
          value={selectVal.map((opt: any) => opt.value).join(', ')}
        />
        <Placeholder
          value={selectVal.length || focused}
          element={element}
          responsiveStyles={responsiveStyles}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          containerRef={containerRef}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}
