import React, { useCallback, useMemo, useRef, useState } from 'react';
import useBorder from '../../components/useBorder';
import Select, { ActionMeta, OnChangeValue } from 'react-select';
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
import type { OptionData, Options } from './types';

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

  const translation = element.properties.translate || {};
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

  const collapseSelectedPreference = !!servar.metadata.collapse_selected_options;
  const { orderedSelectVal, reorderSelected } = useSelectionOrdering(
    selectVal,
    collapseSelectedPreference
  );

  const {
    collapseSelected,
    collapsedCount,
    computedMenuIsOpen,
    closeMenuImmediately,
    handleHoverEnter,
    handleHoverLeave,
    handleMenuClose,
    handleMenuOpen,
    handleWrapperMouseDown,
    handleWrapperTouchStart,
    isMeasuring,
    rowHeight,
    selectRef,
    closeHover,
    visibleCount
  } = useDropdownCollapse({
    collapseSelectedPreference,
    containerRef,
    disabled,
    values: orderedSelectVal
  });

  const selectComponentsOverride = useMemo(
    () =>
      collapseSelected
        ? {
            Option: TooltipOption,
            MultiValue: CollapsibleMultiValue,
            MultiValueContainer: CollapsibleMultiValueContainer,
            MultiValueRemove: CollapsibleMultiValueRemove
          }
        : { Option: TooltipOption, MultiValueRemove: CollapsibleMultiValueRemove },
    [collapseSelected]
  );

  const handleChange = useCallback(
    (
      selected: OnChangeValue<OptionData, true>,
      actionMeta: ActionMeta<OptionData>
    ) => {
      if (collapseSelectedPreference) {
        closeHover();
        closeMenuImmediately();
      }

      const nextSelected = reorderSelected(selected, actionMeta);
      onChange(nextSelected, actionMeta);
    },
    [
      closeHover,
      closeMenuImmediately,
      collapseSelectedPreference,
      onChange,
      reorderSelected
    ]
  );

  const hasTooltip = !!element.properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const create = servar.metadata.creatable_options;
  let formatCreateLabel: ((inputValue: string) => string) | undefined;
  if (create && translation.create_option_label) {
    const template = translation.create_option_label;
    const hasValuePlaceholder = template.includes('{value}');
    formatCreateLabel = hasValuePlaceholder
      ? (inputValue: string) => template.replace(/\{value\}/g, inputValue)
      : (inputValue: string) => `${template} "${inputValue}"`;
  }
  const Component = create ? CreatableSelect : Select;

  responsiveStyles.applyFontStyles('field');

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
        onMouseEnter={handleHoverEnter}
        onMouseLeave={handleHoverLeave}
        onMouseDown={handleWrapperMouseDown}
        onTouchStart={handleWrapperTouchStart}
      >
        {customBorder}
        <Component
          ref={selectRef}
          menuIsOpen={computedMenuIsOpen}
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
              backgroundPosition: `${rightToLeft ? 'left' : 'right'} ${chevronPosition}px center`,
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
                ...(collapseSelected
                  ? {
                      '& .rs-collapsed-chip': {
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
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
            })
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
          rowHeight={rowHeight}
          // @ts-ignore React Select doesn't type custom props on selectProps
          collapseSelected={collapseSelected}
          inputId={servar.key}
          value={orderedSelectVal}
          required={required}
          isDisabled={disabled}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onMenuOpen={handleMenuOpen}
          onMenuClose={handleMenuClose}
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
          formatCreateLabel={formatCreateLabel || undefined}
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
