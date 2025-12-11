import { useMemo } from 'react';
import type { OptionData } from './types';

const MAX_VISIBLE_OPTIONS = 250;

interface UseWindowedOptionsParams {
  options: OptionData[];
  inputValue: string;
  selectedValues: OptionData[];
}

// Skip react-select's filtering when we handle it ourselves
const PASSTHROUGH_FILTER: () => true = () => true;

interface UseWindowedOptionsReturn {
  windowedOptions: OptionData[];
  /** Pass directly to react-select's filterOption prop */
  filterOption: (() => true) | undefined;
  hiddenCount: number;
}

/**
 * Windows large option lists to prevent react-select from processing thousands
 * of options. Selected values are always included at the top.
 */
export default function useWindowedOptions({
  options,
  inputValue,
  selectedValues
}: UseWindowedOptionsParams): UseWindowedOptionsReturn {
  return useMemo(() => {
    if (options.length <= MAX_VISIBLE_OPTIONS) {
      return {
        windowedOptions: options,
        filterOption: undefined,
        hiddenCount: 0
      };
    }

    const searchTerm = inputValue.toLowerCase().trim();
    const selectedValueSet = new Set(selectedValues.map((v) => v.value));

    let filteredOptions: OptionData[];

    if (searchTerm) {
      filteredOptions = options.filter(
        (option) =>
          option.label.toLowerCase().includes(searchTerm)
      );
    } else {
      filteredOptions = options;
    }

    if (filteredOptions.length <= MAX_VISIBLE_OPTIONS) {
      return {
        windowedOptions: filteredOptions,
        filterOption: PASSTHROUGH_FILTER,
        hiddenCount: 0
      };
    }

    const selectedOptions: OptionData[] = [];
    const unselectedOptions: OptionData[] = [];

    for (const option of filteredOptions) {
      if (selectedValueSet.has(option.value)) {
        selectedOptions.push(option);
      } else {
        unselectedOptions.push(option);
      }
    }

    const remainingSlots = Math.max(
      0,
      MAX_VISIBLE_OPTIONS - selectedOptions.length
    );
    const visibleUnselected = unselectedOptions.slice(0, remainingSlots);

    const windowedOptions = [...selectedOptions, ...visibleUnselected];
    const hiddenCount = filteredOptions.length - windowedOptions.length;

    return {
      windowedOptions,
      filterOption: PASSTHROUGH_FILTER,
      hiddenCount
    };
  }, [options, inputValue, selectedValues]);
}
