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

/**
 * Normalizes a raw dropdown option into the OptionData shape, emitting warnings for invalid entries.
 */
export const normalizeDropdownOption = ({
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

/**
 * Builds a normalized options array while applying label/tooltip overrides and populating lookup maps.
 */
export const buildDropdownOptions = (
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
): OptionData[] => {
  const optionList = Array.isArray(rawOptions)
    ? rawOptions.filter(
        (item): item is RawOption => item !== null && item !== undefined
      )
    : [];

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
