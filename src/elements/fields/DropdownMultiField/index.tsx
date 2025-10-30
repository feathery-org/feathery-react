import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import useBorder from '../../components/useBorder';
import { ActionMeta, OnChangeValue, type SelectInstance } from 'react-select';
import { featheryDoc, hoverStylesGuard } from '../../../utils/browser';
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
import useDropdownCollapse from './useDropdownCollapse';
import useSelectionOrdering from './useSelectionOrdering';
import type {
  OptionData,
  Options,
  RawOption,
  DropdownOptionsInput,
  NormalizeDropdownOptionParams,
  BuildDropdownOptionsParams
} from './types';
import {
  normalizeToString,
  warnInvalidData
} from '../../utils/fieldNormalization';

type SelectWithInternalState = SelectInstance<OptionData, true> & {
  state?: {
    focusedOption?: OptionData | null;
  };
};

type SelectInternalState = SelectWithInternalState['state'] & {
  inputValue?: string;
};

type CreatableOption = OptionData & { __isNew__?: boolean };

const normalizeDropdownOption = ({
  warningState,
  option,
  fieldKey,
  context,
  entityLabel
}: NormalizeDropdownOptionParams): OptionData | null => {
  const candidate =
    typeof option === 'string' ||
    typeof option === 'number' ||
    typeof option === 'boolean'
      ? { value: option }
      : option;

  if (!candidate || typeof candidate !== 'object') {
    warnInvalidData({
      state: warningState,
      type: 'option',
      field: fieldKey,
      reason: 'invalid shape',
      context,
      payload: option,
      entityLabel
    });
    return null;
  }

  const normalizedCandidate = candidate as Partial<OptionData> & {
    value?: unknown;
    label?: unknown;
    tooltip?: unknown;
  };

  const coercedValue = normalizeToString(normalizedCandidate.value);
  if (coercedValue === null) {
    warnInvalidData({
      state: warningState,
      type: 'option',
      field: fieldKey,
      reason: 'missing value',
      context,
      payload: option,
      entityLabel
    });
    return null;
  }

  let label = coercedValue;
  const rawLabel = normalizedCandidate.label;
  if (typeof rawLabel === 'string') {
    label = rawLabel;
  } else if (typeof rawLabel === 'number' || typeof rawLabel === 'boolean') {
    label = String(rawLabel);
  }

  let tooltip: string | undefined;
  const rawTooltip = normalizedCandidate.tooltip;
  if (typeof rawTooltip === 'string') {
    tooltip = rawTooltip;
  } else if (
    typeof rawTooltip === 'number' ||
    typeof rawTooltip === 'boolean'
  ) {
    tooltip = String(rawTooltip);
  }

  return {
    value: coercedValue,
    label,
    tooltip
  };
};

const buildDropdownOptions = (
  rawOptions: Options | DropdownOptionsInput,
  {
    warningState,
    fieldKey,
    contextPrefix,
    labelOverrides,
    tooltipOverrides,
    labelMap,
    tooltipMap,
    entityLabel
  }: BuildDropdownOptionsParams
) => {
  const optionList = Array.isArray(rawOptions) ? rawOptions : [];
  return optionList.reduce<OptionData[]>((acc, option, index) => {
    const normalized = normalizeDropdownOption({
      warningState,
      option: option as RawOption,
      fieldKey,
      context: `${contextPrefix}[${index}]`,
      entityLabel
    });
    if (!normalized) return acc;

    let label = normalized.label;
    let tooltip = normalized.tooltip ?? '';

    if (
      typeof option === 'string' ||
      typeof option === 'number' ||
      typeof option === 'boolean'
    ) {
      const labelOverride = labelOverrides?.[index];
      const tooltipOverride = tooltipOverrides?.[index];

      if (typeof labelOverride === 'string' && labelOverride.length) {
        label = labelOverride;
      } else if (labelOverride) {
        label = String(labelOverride);
      }

      if (typeof tooltipOverride === 'string' && tooltipOverride.length) {
        tooltip = tooltipOverride;
      } else if (tooltipOverride) {
        tooltip = String(tooltipOverride);
      }
    }

    labelMap[normalized.value] = label;
    tooltipMap[normalized.value] = tooltip;
    acc.push({
      value: normalized.value,
      label,
      tooltip
    });
    return acc;
  }, []);
};

const getLatestInputValue = (
  stateValue: unknown,
  inputRef: HTMLInputElement | null | undefined
) => {
  if (typeof stateValue === 'string') return stateValue;
  if (typeof inputRef?.value === 'string') return inputRef.value;
  return '';
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
  const fieldKey = servar.key;
  const warningState = useMemo(() => new Set<string>(), [fieldKey]);
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

  const properties = element.properties || {};
  const translation = properties.translate || {};
  const noOptionsMessage = translation.no_options
    ? () => translation.no_options as string
    : undefined;
  const entityLabel = 'Dropdown field';

  const normalizedFieldValues = useMemo<string[]>(() => {
    if (!Array.isArray(fieldVal)) {
      warnInvalidData({
        state: warningState,
        type: 'value',
        field: fieldKey,
        reason: 'expected array for multi-select value',
        context: 'fieldVal',
        payload: fieldVal,
        entityLabel
      });
      return [];
    }

    return fieldVal.reduce<string[]>((acc, rawValue, index) => {
      const coerced = normalizeToString(rawValue);
      if (coerced === null) {
        warnInvalidData({
          state: warningState,
          type: 'value',
          field: fieldKey,
          reason: 'unsupported value type',
          context: `fieldVal[${index}]`,
          payload: rawValue,
          entityLabel
        });
        return acc;
      }
      acc.push(coerced);
      return acc;
    }, []);
  }, [fieldKey, fieldVal, warningState]);

  const addFieldValOptions = (options: Options): DropdownOptionsInput => {
    const newOptions: DropdownOptionsInput = Array.isArray(options)
      ? [...options]
      : [];
    if (!normalizedFieldValues.length) return newOptions;

    normalizedFieldValues.forEach((val: string) => {
      const items = newOptions as (string | OptionData)[];
      if (typeof items[0] === 'string') {
        const stringOptions = newOptions as string[];
        if (!stringOptions.includes(val)) stringOptions.push(val);
        return;
      }

      const optionDataOptions = newOptions as OptionData[];
      const hasExistingOption = optionDataOptions.some((option) => {
        const normalizedValue = normalizeToString(option?.value);
        return normalizedValue === val;
      });
      if (!hasExistingOption) {
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
    const dynamicSource = addFieldValOptions(dynamicOptions);
    options = buildDropdownOptions(dynamicSource, {
      warningState,
      fieldKey,
      contextPrefix: 'dynamicOptions',
      labelMap,
      tooltipMap,
      entityLabel
    });
  } else if (
    repeatIndex !== null &&
    servar.metadata.repeat_options?.[repeatIndex] !== undefined
  ) {
    const repeatOptions = servar.metadata.repeat_options[repeatIndex];
    const repeatSource = addFieldValOptions(repeatOptions);
    options = buildDropdownOptions(repeatSource, {
      warningState,
      fieldKey,
      contextPrefix: 'repeat_options',
      labelMap,
      tooltipMap,
      entityLabel
    });
  } else {
    const baseOptions = addFieldValOptions(servar.metadata.options);
    options = buildDropdownOptions(baseOptions, {
      warningState,
      fieldKey,
      contextPrefix: 'options',
      labelOverrides: labels,
      tooltipOverrides: tooltips,
      labelMap,
      tooltipMap,
      entityLabel
    });
  }

  const selectVal: OptionData[] = normalizedFieldValues.length
    ? normalizedFieldValues.map((val: string) => ({
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
  // Handle React Select quirks where touch-initiated opens can trigger
  // immediate closes if we don't suppress the close event for a short time
  // since we took over the pointer interaction.
  const suppressCloseUntilRef = useRef<number>(0);
  const extendCloseSuppression = useCallback(() => {
    suppressCloseUntilRef.current = performance.now() + 250;
  }, []);
  const { onMouseDown: focusOnMouseDown, onTouchStart: focusOnTouchStart } =
    pointer;

  const syncSelectInstance = useCallback(
    () => selectRef.current as SelectWithInternalState | null,
    [selectRef]
  );

  const openMenu = useCallback(() => {
    const instance = syncSelectInstance();
    if (!instance) return;

    extendCloseSuppression();
    setIsMenuOpen(true);
    openCollapseMenu();
    instance.focus?.();
    instance.openMenu?.('first');
  }, [extendCloseSuppression, openCollapseMenu, syncSelectInstance]);

  const closeMenuImmediately = useCallback(
    (options?: Parameters<typeof forceCloseCollapseMenu>[0]) => {
      setIsMenuOpen(false);
      closeCollapseMenu();
      forceCloseCollapseMenu(options);
    },
    [closeCollapseMenu, forceCloseCollapseMenu]
  );

  const handleMenuOpen = useCallback(() => {
    setIsMenuOpen(true);
    openCollapseMenu();
    syncSelectInstance();
  }, [openCollapseMenu, syncSelectInstance]);

  const handleMenuClose = useCallback(() => {
    if (performance.now() < suppressCloseUntilRef.current) {
      return;
    }
    setIsMenuOpen(false);
    closeCollapseMenu();
  }, [closeCollapseMenu]);

  const shouldOpenFromTarget = useCallback(
    (eventTarget: EventTarget | null) => {
      if (!collapseSelected || isMenuOpen) return false;

      const elementTarget = eventTarget as HTMLElement | null;
      if (elementTarget?.closest('[data-feathery-multi-value-remove="true"]')) {
        return false;
      }

      return true;
    },
    [collapseSelected, isMenuOpen]
  );

  const handleWrapperMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (shouldOpenFromTarget(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        openMenu();
        return;
      }

      focusOnMouseDown(event);
    },
    [focusOnMouseDown, openMenu, shouldOpenFromTarget]
  );

  const handleWrapperTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (shouldOpenFromTarget(event.target)) {
        event.stopPropagation();
        openMenu();
        return;
      }

      focusOnTouchStart(event);
    },
    [focusOnTouchStart, openMenu, shouldOpenFromTarget]
  );

  const handleControlPress = useCallback(
    (event: React.SyntheticEvent, { isTouch }: { isTouch: boolean }) => {
      if (!shouldOpenFromTarget(event.currentTarget)) return false;

      if (!isTouch && 'preventDefault' in event && event.cancelable) {
        event.preventDefault?.();
      }
      event.stopPropagation();
      openMenu();
      return true;
    },
    [openMenu, shouldOpenFromTarget]
  );

  const handleCollapsedChipPress = useCallback(
    (event: React.SyntheticEvent) => {
      if (!shouldOpenFromTarget(event.currentTarget)) return;

      event.stopPropagation();
      openMenu();
    },
    [openMenu, shouldOpenFromTarget]
  );
  const { isMeasuring, visibleCount } = measurement;

  const selectComponentsOverride = useMemo(
    () =>
      collapseSelected
        ? {
            Control: DropdownControl,
            Option: TooltipOption,
            MultiValue: CollapsibleMultiValue,
            MultiValueContainer: CollapsibleMultiValueContainer,
            MultiValueRemove: CollapsibleMultiValueRemove
          }
        : {
            Control: DropdownControl,
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
      if (
        actionMeta.action === 'remove-value' ||
        actionMeta.action === 'pop-value'
      ) {
        extendCloseSuppression();
      }
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
      extendCloseSuppression,
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
  const normalizedOptionValues = useMemo(() => {
    const values = new Set<string>();
    options.forEach((option) => {
      if (option?.value) values.add(option.value.toLowerCase());
    });
    return values;
  }, [options]);

  const normalizedSelectedValues = useMemo(() => {
    const values = new Set<string>();
    orderedSelectVal.forEach((option) => {
      if (option?.value) values.add(option.value.toLowerCase());
    });
    return values;
  }, [orderedSelectVal]);

  type EnterGuardDecision = 'allow' | 'block' | 'block-open';

  const evaluateEnterGuard = useCallback((): EnterGuardDecision => {
    const instance = selectRef.current as SelectWithInternalState | null;
    const selectState = instance?.state as SelectInternalState | undefined;
    const rawFocusedOption = selectState?.focusedOption as
      | CreatableOption
      | undefined;
    const focusedOption = rawFocusedOption ?? null;
    const focusedValue = focusedOption?.value;
    const hasFocusedOption = Boolean(focusedValue);
    const isCreateFocused = Boolean(create && focusedOption?.__isNew__);
    // React Select defers state updates during keydown; fall back to the live
    // input element so creatable text is visible before the state commit.
    const rawInputValue = getLatestInputValue(
      selectState?.inputValue,
      instance?.inputRef ?? null
    );
    const inputValue = rawInputValue.trim();
    const hasInput = inputValue.length > 0;
    const normalizedInput = inputValue.toLowerCase();
    const matchesExistingOption =
      hasInput && normalizedOptionValues.has(normalizedInput);
    const matchesSelectedValue =
      hasInput && normalizedSelectedValues.has(normalizedInput);
    const isCreatableCandidate = create && hasInput && !matchesExistingOption;
    const normalizedFocusedValue = focusedValue?.toLowerCase();
    const isFocusedSelected = Boolean(
      normalizedFocusedValue &&
        normalizedSelectedValues.has(normalizedFocusedValue)
    );

    if (!isMenuOpen) {
      return 'block-open';
    }

    if (isCreatableCandidate) {
      return 'allow';
    }

    if (isCreateFocused) {
      return 'block';
    }

    if (hasFocusedOption) {
      return isFocusedSelected ? 'block' : 'allow';
    }

    if (disableAllOptions) {
      return 'block';
    }

    if (matchesExistingOption || matchesSelectedValue) {
      return 'block';
    }

    // No option focused and no creatable input to act on—block to preserve the
    // form submit guard.
    return 'block';
  }, [
    create,
    disableAllOptions,
    isMenuOpen,
    normalizedOptionValues,
    normalizedSelectedValues,
    orderedSelectVal,
    selectRef
  ]);

  const handleSelectKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' || disabled) return;

      const decision = evaluateEnterGuard();
      if (decision === 'allow') return;

      event.preventDefault();
      event.stopPropagation();

      if (decision === 'block-open') {
        const instance = selectRef.current as SelectWithInternalState | null;
        instance?.openMenu?.('first');
      }
    },
    [disabled, evaluateEnterGuard, selectRef]
  );

  // Capture the keydown before it reaches the native form submit handler. This
  // keeps Enter from bubbling out when React Select bails early (e.g., no
  // creatable input or all options selected).
  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' || disabled) return;

      const decision = evaluateEnterGuard();
      if (decision === 'allow') return;

      event.preventDefault();
      event.stopPropagation();

      if (decision === 'block-open') {
        const instance = selectRef.current as SelectWithInternalState | null;
        instance?.openMenu?.('first');
      }
    },
    [disabled, evaluateEnterGuard, selectRef]
  );

  const hasTooltip = !!properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const SelectComponent = create ? DropdownCreatableSelect : DropdownSelect;

  responsiveStyles.applyFontStyles('field');

  const shouldHideInput =
    collapseSelected && !isMeasuring && !focused && !isMenuOpen;

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

  useEffect(() => {
    if (!isMenuOpen) return;

    const doc = featheryDoc();

    const handlePointerDown = (event: PointerEvent) => {
      const root = containerRef.current;
      if (!root) return;
      if (root.contains(event.target as Node)) return;
      closeMenuImmediately();
    };

    doc.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      doc.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [closeMenuImmediately, isMenuOpen]);

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
        onKeyDownCapture={handleKeyDownCapture}
      >
        {customBorder}
        <SelectComponent
          ref={selectRef}
          styles={selectStyles}
          components={selectComponentsOverride}
          // In collapsed mode we open via custom press handlers; disable the
          // default click-toggle to avoid immediate close on touch. Preserve
          // default click-open when not collapsing.
          openMenuOnClick={!collapseSelected}
          menuIsOpen={isMenuOpen}
          onMenuOpen={handleMenuOpen}
          onMenuClose={handleMenuClose}
          containerRef={containerRef}
          visibleCount={visibleCount}
          collapsedCount={collapsedCount}
          isMeasuring={isMeasuring}
          collapseSelected={collapseSelected}
          inputHidden={shouldHideInput}
          onCollapsedChipPress={
            collapseSelected ? handleCollapsedChipPress : undefined
          }
          onControlPress={collapseSelected ? handleControlPress : undefined}
          onMultiValueRemovePointer={extendCloseSuppression}
          inputId={servar.key}
          value={orderedSelectVal}
          required={required}
          isDisabled={disabled}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          closeMenuOnSelect={false}
          tabSelectsValue={false}
          onKeyDown={handleSelectKeyDown}
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
