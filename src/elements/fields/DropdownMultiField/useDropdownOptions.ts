import { useCallback, useMemo } from 'react';
import type { OptionData, Options, DropdownOptionsInput } from './types';
import {
  normalizeToString,
  warnInvalidData
} from '../../utils/fieldNormalization';
import { buildDropdownOptions } from './optionNormalization';
import useSelectionOrdering from './useSelectionOrdering';

type OptionsSourcePlan = {
  source: DropdownOptionsInput | Options;
  contextPrefix: string;
  labelOverrides?: unknown[];
  tooltipOverrides?: unknown[];
};

interface UseDropdownOptionsParams {
  fieldVal: any[];
  fieldKey: string;
  servar: any;
  properties: any;
  dynamicOptions: any[];
  shouldSalesforceSync: boolean;
  repeatIndex: number | null;
  entityLabel: string;
}

interface UseDropdownOptionsReturn {
  options: OptionData[];
  orderedSelectVal: OptionData[];
  labelMap: Record<string, string>;
  tooltipMap: Record<string, string | undefined>;
  reorderSelection: (selected: any, actionMeta: any) => any;
}

/**
 * Handles all dropdown options building logic:
 * - Normalizes field values
 * - Determines option source (Salesforce, repeat, or default)
 * - Builds options with labels and tooltips
 * - Manages selection ordering
 * - Supplies selection ordering helpers for interaction logic
 */
export default function useDropdownOptions({
  fieldVal,
  fieldKey,
  servar,
  properties,
  dynamicOptions,
  shouldSalesforceSync,
  repeatIndex,
  entityLabel
}: UseDropdownOptionsParams): UseDropdownOptionsReturn {
  const warningState = useMemo(() => new Set<string>(), [fieldKey]);

  // Normalize field values to strings, filtering out invalid entries
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
  }, [fieldKey, fieldVal, warningState, entityLabel]);

  // Ensure selected values exist in options list (backwards compatibility)
  const addFieldValOptions = useCallback(
    (options: Options): DropdownOptionsInput => {
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
    },
    [normalizedFieldValues]
  );

  const labels = servar.metadata.option_labels || [];
  const tooltips = servar.metadata.option_tooltips || [];

  // Determine which option source to use (Salesforce, repeat, or default)
  const optionsSource = useMemo<OptionsSourcePlan>(() => {
    if (shouldSalesforceSync) {
      return {
        source: addFieldValOptions(dynamicOptions),
        contextPrefix: 'dynamicOptions'
      };
    }

    const repeatOptions =
      repeatIndex !== null
        ? servar.metadata.repeat_options?.[repeatIndex]
        : undefined;

    if (repeatOptions !== undefined) {
      return {
        source: addFieldValOptions(repeatOptions),
        contextPrefix: 'repeat_options'
      };
    }

    return {
      source: addFieldValOptions(servar.metadata.options),
      contextPrefix: 'options',
      labelOverrides: labels,
      tooltipOverrides: tooltips
    };
  }, [
    shouldSalesforceSync,
    dynamicOptions,
    repeatIndex,
    servar.metadata.repeat_options,
    servar.metadata.options,
    labels,
    tooltips,
    addFieldValOptions
  ]);

  // Build normalized options with labels and tooltips
  const { options, labelMap, tooltipMap } = useMemo(() => {
    const labelMap: Record<string, string> = {};
    const tooltipMap: Record<string, string | undefined> = {};

    const options = buildDropdownOptions(optionsSource.source, {
      warningState,
      fieldKey,
      contextPrefix: optionsSource.contextPrefix,
      labelOverrides: optionsSource.labelOverrides,
      tooltipOverrides: optionsSource.tooltipOverrides,
      labelMap,
      tooltipMap,
      entityLabel
    });

    return { options, labelMap, tooltipMap };
  }, [fieldKey, entityLabel, optionsSource, warningState]);

  // Convert selected string values into full OptionData objects
  const selectVal: OptionData[] = normalizedFieldValues.length
    ? normalizedFieldValues.map((val: string) => ({
        label: labelMap[val] ?? val,
        value: val,
        tooltip: tooltipMap[val]
      }))
    : [];

  // Apply selection ordering if enabled (only works with collapse mode, which is now always on)
  const selectionOrderingPreference = !!properties.preserveSelectionOrder;
  const { orderedValues: orderedSelectVal, reorderSelection } =
    useSelectionOrdering({
      values: selectVal,
      enabled: selectionOrderingPreference
    });

  return {
    options,
    orderedSelectVal,
    labelMap,
    tooltipMap,
    reorderSelection
  };
}
