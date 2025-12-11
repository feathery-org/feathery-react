import { useMemo } from 'react';
import type { OptionData, CreatableValidator } from './types';
import type { SelectInstance, InputActionMeta } from 'react-select';

interface UseSelectPropsParams {
  // Refs
  selectRef: React.RefObject<SelectInstance<OptionData, true> | null>;
  containerRef: React.RefObject<HTMLElement | null>;

  // Data
  servar: any;
  selectVal: OptionData[];
  options: OptionData[];

  // State flags
  required: boolean;
  disabled: boolean;
  isMenuOpen: boolean;
  loadingDynamicOptions: boolean;

  // Styling
  selectStyles: any;
  selectComponentsOverride: any;

  // Collapse state
  collapseSelected: boolean;
  visibleCount: number;
  collapsedCount: number;
  isMeasuring: boolean;
  shouldHideInput: boolean;

  // Callbacks
  handleChange: (selected: any, actionMeta: any) => void;
  setFocused: (focused: boolean) => void;
  handleSelectKeyDown: (event: React.KeyboardEvent) => void;
  handleMenuOpen: () => void;
  handleMenuClose: () => void;
  handleCollapsedChipPress?: (event: React.SyntheticEvent) => void;
  handleControlPress?: (
    event: React.SyntheticEvent,
    options: { isTouch: boolean }
  ) => boolean;
  extendCloseSuppression: () => void;

  // Translation & i18n
  noOptionsMessage?: () => string;
  create: boolean;
  formatCreateLabel?: (inputValue: string) => string;
  isValidNewOption?: CreatableValidator;

  // Input handling for windowed options
  onInputChange?: (newValue: string, actionMeta: InputActionMeta) => void;
  // Pass directly from useWindowedOptions - skips react-select filtering when windowing
  filterOption?: (() => true) | undefined;

  // Accessibility
  ariaLabel?: string;
}

/**
 * Organizes all props for the SelectComponent into a clean configuration object.
 * Groups props by concern: core identity, styling, behavior, collapse features, etc.
 */
export default function useSelectProps({
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
  isValidNewOption,
  onInputChange,
  filterOption,
  ariaLabel
}: UseSelectPropsParams) {
  return useMemo(
    () => ({
      // Core identity & data
      ref: selectRef as React.RefObject<SelectInstance<OptionData, true>>,
      inputId: servar.key,
      isMulti: true as const,
      value: selectVal,
      options: options,

      // State
      required: required,
      isDisabled: disabled,
      menuIsOpen: isMenuOpen,

      // Styling
      styles: selectStyles,
      components: selectComponentsOverride,
      placeholder: '',

      // Menu behavior - all options selected for multi-select UX
      openMenuOnClick: !collapseSelected,
      closeMenuOnSelect: false,
      tabSelectsValue: false,
      blurInputOnSelect: false,

      filterOption,

      // Event handlers
      onChange: handleChange,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      onKeyDown: handleSelectKeyDown,
      onMenuOpen: handleMenuOpen,
      onMenuClose: handleMenuClose,
      onInputChange,

      // Option state
      isOptionDisabled: (option: OptionData) =>
        option.isMoreIndicator ||
        (servar.max_length && selectVal.length >= servar.max_length) ||
        loadingDynamicOptions,
      noOptionsMessage: create ? () => null : noOptionsMessage,

      // Collapse-specific props (only included when collapse mode is active)
      ...(collapseSelected
        ? {
            containerRef,
            visibleCount,
            collapsedCount,
            isMeasuring,
            collapseSelected: true,
            inputHidden: shouldHideInput,
            onCollapsedChipPress: handleCollapsedChipPress,
            onControlPress: handleControlPress,
            onMultiValueRemovePointer: extendCloseSuppression
          }
        : {
            containerRef,
            visibleCount: options.length,
            collapsedCount: 0,
            isMeasuring: false,
            collapseSelected: false
          }),

      // Creatable-specific props (only included when creatable mode is active)
      ...(create && {
        ...(formatCreateLabel ? { formatCreateLabel } : {}),
        ...(isValidNewOption ? { isValidNewOption } : {})
      }),

      // Accessibility
      'aria-label': ariaLabel
    }),
    [
      selectRef,
      servar.key,
      servar.max_length,
      selectVal,
      options,
      required,
      disabled,
      isMenuOpen,
      selectStyles,
      selectComponentsOverride,
      collapseSelected,
      containerRef,
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
      loadingDynamicOptions,
      noOptionsMessage,
      create,
      formatCreateLabel,
      isValidNewOption,
      onInputChange,
      ariaLabel,
      filterOption
    ]
  );
}
