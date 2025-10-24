import React, { useCallback, useMemo, useRef, useState } from 'react';
import useBorder from '../../components/useBorder';
import Select, {
  ActionMeta,
  OnChangeValue,
  type SelectInstance
} from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { hoverStylesGuard } from '../../../utils/browser';
import InlineTooltip from '../../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from '../index';
import Placeholder from '../../components/Placeholder';
import useSalesforceSync from '../../../hooks/useSalesforceSync';

import {
  CollapsibleMultiValue,
  CollapsibleMultiValueContainer,
  TooltipOption,
  CollapsibleMultiValueRemove
} from './DropdownMultiFieldSelectComponents';
import useDropdownCollapse from './useDropdownCollapse';
import useSelectionOrdering from './useSelectionOrdering';
import type { DropdownSelectProps, OptionData, Options } from './types';

type SelectWithInternalState = SelectInstance<OptionData, true> & {
  state?: {
    focusedOption?: OptionData | null;
  };
};

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
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

  const properties = element.properties || {};
  const translation = properties.translate || {};
  const noOptionsMessage = translation.no_options
    ? () => translation.no_options as string
    : undefined;

  const addFieldValOptions = (options: Options) => {
    const newOptions = Array.isArray(options) ? [...options] : [];
    if (!fieldVal) return newOptions;

    fieldVal.forEach((val: string) => {
      const items = newOptions as (string | OptionData)[];
      if (typeof items[0] === 'string') {
        const stringOptions = newOptions as string[];
        if (!stringOptions.includes(val)) stringOptions.push(val);
        return;
      }

      const optionDataOptions = newOptions as OptionData[];
      if (!optionDataOptions.some((option) => option.value === val)) {
        optionDataOptions.push({ value: val, label: val });
      }
    });

    return newOptions;
  };

  const labels = servar.metadata.option_labels || [];
  const tooltips = servar.metadata.option_tooltips || [];

  const labelMap: Record<string, string> = {};
  const tooltipMap: Record<string, string | undefined> = {};
  let options: OptionData[] = [];

  if (shouldSalesforceSync) {
    options = dynamicOptions.map((option: OptionData) => {
      labelMap[option.value] = option.label;
      return {
        value: option.value,
        label: option.label
      };
    });
  } else if (
    repeatIndex !== null &&
    servar.metadata.repeat_options?.[repeatIndex] !== undefined
  ) {
    const repeatOptions = servar.metadata.repeat_options[repeatIndex];
    options = addFieldValOptions(repeatOptions).map((option) => {
      if (typeof option === 'string') {
        labelMap[option] = option;
        tooltipMap[option] = '';
        return { value: option, label: option, tooltip: '' };
      }
      labelMap[option.value] = option.label;
      tooltipMap[option.value] = option.tooltip;
      return option;
    });
  } else {
    options = addFieldValOptions(servar.metadata.options).map(
      (option, index) => {
        if (typeof option === 'string') {
          labelMap[option] = labels[index] || option;
          tooltipMap[option] = tooltips[index];

          return {
            value: option,
            label: labels[index] || option,
            tooltip: tooltips[index] || ''
          };
        }

        labelMap[option.value] = option.label;
        tooltipMap[option.value] = option.tooltip;

        return option;
      }
    );
  }

  const selectVal: OptionData[] = fieldVal
    ? fieldVal.map((val: string) => ({
        label: labelMap[val] ?? val,
        value: val,
        tooltip: tooltipMap[val]
      }))
    : [];

  const collapseSelectedPreference = !!properties.collapseSelectedOptions;
  const selectionOrderingPreference = collapseSelectedPreference
    ? !!properties.preserveSelectionOrder
    : false;
  const { orderedSelectVal, reorderSelected } = useSelectionOrdering(
    selectVal,
    !!selectionOrderingPreference
  );

  const {
    collapseSelected,
    collapsedCount,
    menu,
    pointer,
    measurement,
    selectRef
  } = useDropdownCollapse({
    collapseSelectedPreference,
    containerRef,
    disabled,
    values: orderedSelectVal
  });

  const {
    open: openCollapseMenu,
    close: closeCollapseMenu,
    forceClose: forceCloseCollapseMenu
  } = menu;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenuImmediately = useCallback(
    (options?: Parameters<typeof forceCloseCollapseMenu>[0]) => {
      setIsMenuOpen(false);
      forceCloseCollapseMenu(options);
    },
    [forceCloseCollapseMenu]
  );
  const handleMenuOpen = useCallback(() => {
    setIsMenuOpen(true);
    openCollapseMenu();
  }, [openCollapseMenu]);
  const handleMenuClose = useCallback(() => {
    setIsMenuOpen(false);
    closeCollapseMenu();
  }, [closeCollapseMenu]);
  const {
    onMouseDown: handleWrapperMouseDown,
    onTouchStart: handleWrapperTouchStart
  } = pointer;
  const { isMeasuring, visibleCount } = measurement;

  const selectComponentsOverride = useMemo(
    () =>
      collapseSelected
        ? {
            Option: TooltipOption,
            MultiValue: CollapsibleMultiValue,
            MultiValueContainer: CollapsibleMultiValueContainer,
            MultiValueRemove: CollapsibleMultiValueRemove
          }
        : {
            Option: TooltipOption,
            MultiValueRemove: CollapsibleMultiValueRemove
          },
    [collapseSelected]
  );

  const handleChange = useCallback(
    (
      selected: OnChangeValue<OptionData, true>,
      actionMeta: ActionMeta<OptionData>
    ) => {
      const skipBlurAction =
        actionMeta.action === 'remove-value' ||
        actionMeta.action === 'pop-value' ||
        actionMeta.action === 'select-option' ||
        actionMeta.action === 'create-option';

      if (collapseSelectedPreference) {
        if (!skipBlurAction || !isMenuOpen) {
          closeMenuImmediately(skipBlurAction ? { skipBlur: true } : undefined);
        }
      }

      const nextSelected = reorderSelected(selected, actionMeta);
      onChange(nextSelected, actionMeta);
      selectRef.current?.focus?.();
    },
    [
      closeMenuImmediately,
      collapseSelectedPreference,
      isMenuOpen,
      onChange,
      reorderSelected,
      selectRef
    ]
  );

  const disableAllOptions =
    (!!servar.max_length && orderedSelectVal.length >= servar.max_length) ||
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
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' || create || disabled) return;

      const instance = selectRef.current as SelectWithInternalState | null;
      const hasFocusedOption = !!instance?.state?.focusedOption;

      if (!isMenuOpen) {
        event.preventDefault();
        instance?.openMenu?.('first');
        return;
      }

      if (!hasFocusedOption || disableAllOptions) {
        event.preventDefault();
      }
    },
    [create, disableAllOptions, disabled, isMenuOpen, selectRef]
  );
  const hasTooltip = !!properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const Component = create ? CreatableSelect : Select;

  responsiveStyles.applyFontStyles('field');

  const shouldHideInput =
    collapseSelected && !isMeasuring && !focused && !isMenuOpen;

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
          '&:hover': hoverStylesGuard(
            disabled
              ? {}
              : {
                  ...responsiveStyles.getTarget('hover'),
                  ...borderStyles.hover
                }
          ),
          '&&': focused
            ? {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              }
            : {}
        }}
        onMouseDown={handleWrapperMouseDown}
        onTouchStart={handleWrapperTouchStart}
      >
        {customBorder}
        <Component
          ref={selectRef}
          styles={{
            // @ts-ignore React Select style typing is overly strict
            control: (baseStyles) => ({
              ...baseStyles,
              ...responsiveStyles.getTarget('field'),
              width: '100%',
              height: '100%',
              minHeight: 'inherit',
              border: 'none',
              boxShadow: 'none',
              backgroundColor: 'transparent',
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${element.styles.font_color}'/></svg>")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: `${
                rightToLeft ? 'left' : 'right'
              } ${chevronPosition}px center`,
              position: 'relative'
            }),
            // @ts-ignore React Select style typing is overly strict
            container: (baseStyles) => ({
              ...baseStyles,
              height: '100%',
              minHeight: 'inherit'
            }),
            // @ts-ignore React Select style typing is overly strict
            valueContainer: (baseStyles, state) => {
              const selectProps =
                state.selectProps as typeof state.selectProps & {
                  collapseSelected: boolean;
                  isMeasuring: boolean;
                  visibleCount: number;
                  inputValue?: string;
                };
              const shouldWrap =
                selectProps.isMeasuring ||
                !selectProps.collapseSelected ||
                !!selectProps.inputValue;
              const paddingBlock = shouldWrap
                ? {
                    paddingTop:
                      baseStyles.paddingTop !== undefined
                        ? baseStyles.paddingTop
                        : '8px',
                    paddingBottom:
                      baseStyles.paddingBottom !== undefined
                        ? baseStyles.paddingBottom
                        : '8px'
                  }
                : {};

              return {
                ...baseStyles,
                ...paddingBlock,
                paddingInlineEnd: 28,
                display: 'flex',
                minWidth: 0,
                flexWrap: shouldWrap ? 'wrap' : 'nowrap',
                alignItems: shouldWrap ? 'flex-start' : 'center',
                alignContent: shouldWrap ? 'flex-start' : 'center',
                ...(selectProps.collapseSelected
                  ? {
                      '& .rs-collapsed-chip': {
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '3px 8px',
                        margin: '2px',
                        borderRadius: baseStyles.borderRadius ?? 2,
                        backgroundColor:
                          baseStyles.backgroundColor ??
                          'rgba(221, 221, 221, 0.8)',
                        color: baseStyles.color ?? '#333',
                        fontSize: baseStyles.fontSize ?? '0.85em'
                      }
                    }
                  : {})
              };
            },
            // @ts-ignore React Select style typing is overly strict
            multiValueLabel: (baseStyles) => ({
              ...baseStyles,
              whiteSpace: 'normal',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3
            }),
            indicatorSeparator: () => ({ display: 'none' }),
            indicatorsContainer: () => ({ display: 'none' }),
            // @ts-ignore React Select style typing is overly strict
            menu: (baseStyles) => ({
              ...baseStyles,
              zIndex: DROPDOWN_Z_INDEX,
              textAlign: 'start'
            }),
            // @ts-ignore React Select style typing is overly strict
            multiValue: (baseStyles, state) => {
              const selectProps =
                state.selectProps as typeof state.selectProps & {
                  collapseSelected: boolean;
                };

              if (!selectProps.collapseSelected) return baseStyles;

              return {
                ...baseStyles,
                marginInline: '2px',
                borderRadius: baseStyles.borderRadius ?? 2
              };
            },
            // @ts-ignore React Select style typing is overly strict
            input: (baseStyles, state) => {
              const selectProps = state.selectProps as DropdownSelectProps & {
                inputHidden?: boolean;
              };

              if (!selectProps.collapseSelected || !selectProps.inputHidden) {
                return baseStyles;
              }

              return {
                ...baseStyles,
                opacity: 0,
                maxWidth: '1px',
                width: '1px',
                minWidth: '1px',
                flexBasis: 0,
                flexGrow: 0,
                flexShrink: 0,
                margin: 0,
                padding: 0,
                pointerEvents: 'none',
                position: 'absolute',
                top: 0,
                right: 0,
                overflow: 'hidden',
                '> input': {
                  width: '1px',
                  minWidth: '1px',
                  opacity: 0,
                  pointerEvents: 'none'
                }
              };
            }
          }}
          components={selectComponentsOverride}
          // @ts-ignore React Select doesn't type custom props on selectProps
          containerRef={containerRef}
          // @ts-ignore React Select doesn't type custom props on selectProps
          visibleCount={visibleCount}
          // @ts-ignore React Select doesn't type custom props on selectProps
          collapsedCount={collapsedCount}
          // @ts-ignore React Select doesn't type custom props on selectProps
          isMeasuring={isMeasuring}
          // @ts-ignore React Select doesn't type custom props on selectProps
          collapseSelected={collapseSelected}
          // @ts-ignore React Select doesn't type custom props on selectProps
          inputHidden={shouldHideInput}
          inputId={servar.key}
          value={orderedSelectVal}
          required={required}
          isDisabled={disabled}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMenuOpen={handleMenuOpen}
          onMenuClose={handleMenuClose}
          closeMenuOnSelect={false}
          tabSelectsValue={false}
          onKeyDown={handleKeyDown}
          blurInputOnSelect={false}
          noOptionsMessage={create ? () => null : noOptionsMessage}
          options={options}
          isOptionDisabled={() =>
            (servar.max_length &&
              orderedSelectVal.length >= servar.max_length) ||
            loadingDynamicOptions
          }
          isMulti
          placeholder=''
          aria-label={element.properties.aria_label}
          formatCreateLabel={formatCreateLabel}
        />
        <Placeholder
          value={orderedSelectVal.length || focused}
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
