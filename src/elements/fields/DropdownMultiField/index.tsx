import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { InputActionMeta } from 'react-select';
import useBorder from '../../components/useBorder';
import InlineTooltip from '../../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from '../index';
import Placeholder from '../../components/Placeholder';
import useSalesforceSync from '../../../hooks/useSalesforceSync';

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
import useCollapsedSelectionManager from './useCollapsedSelectionManager';
import useDropdownOptions from './useDropdownOptions';
import useWindowedOptions from './useWindowedOptions';
import useSelectProps from './useSelectProps';
import useDropdownInteractions from './useDropdownInteractions';
import type { CreatableValidator } from './types';

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

  // Build all dropdown options and selections
  const { options: allOptions, selectVal } = useDropdownOptions({
    fieldVal,
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
  const handleInputChange = useCallback(
    (newValue: string, actionMeta: InputActionMeta) => {
      // Only update on actual input changes, not on menu close/blur
      if (actionMeta.action === 'input-change') {
        setInputValue(newValue);
      }
    },
    []
  );

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
    values: selectVal
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
    (!!servar.max_length && selectVal.length >= servar.max_length) ||
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
    onChange
  });

  const hasTooltip = !!properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const SelectComponent = create ? DropdownCreatableSelect : DropdownSelect;

  responsiveStyles.applyFontStyles('field');

  const shouldHideInput = collapseSelected && !isMeasuring && !focused;

  const selectStyles = useMemo(
    () =>
      createSelectStyles({
        chevronPosition,
        fontColor: element.styles.font_color,
        menuZIndex: DROPDOWN_Z_INDEX,
        responsiveStyles,
        rightToLeft
      }),
    [chevronPosition, element.styles.font_color, responsiveStyles, rightToLeft]
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
    ariaLabel: element.properties.aria_label
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
      >
        {customBorder}
        <SelectComponent {...selectProps} />
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
