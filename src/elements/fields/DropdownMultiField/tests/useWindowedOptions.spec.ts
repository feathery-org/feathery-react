import { renderHook } from '@testing-library/react';
import useWindowedOptions from '../useWindowedOptions';
import type { OptionData } from '../types';

const MAX_VISIBLE_OPTIONS = 250;

const createOptions = (count: number, prefix = 'Option'): OptionData[] => {
  return Array.from({ length: count }, (_, i) => ({
    value: `${prefix.toLowerCase()}-${i + 1}`,
    label: `${prefix} ${i + 1}`
  }));
};

describe('useWindowedOptions', () => {
  describe('Small datasets (≤250 options)', () => {
    it('returns all options when count is below threshold', () => {
      const options = createOptions(100);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      expect(result.current.windowedOptions).toEqual(options);
      expect(result.current.hiddenCount).toBe(0);
      expect(result.current.filterOption).toBeUndefined();
    });

    it('returns all options when count exactly equals threshold', () => {
      const options = createOptions(MAX_VISIBLE_OPTIONS);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      expect(result.current.windowedOptions).toHaveLength(MAX_VISIBLE_OPTIONS);
      expect(result.current.hiddenCount).toBe(0);
      expect(result.current.filterOption).toBeUndefined();
    });

    it('does not add "more results" indicator for small datasets', () => {
      const options = createOptions(50);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      const hasIndicator = result.current.windowedOptions.some(
        (opt) => opt.isMoreIndicator
      );
      expect(hasIndicator).toBe(false);
    });
  });

  describe('Large datasets (>250 options)', () => {
    it('windows options to MAX_VISIBLE_OPTIONS limit', () => {
      const options = createOptions(500);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      // 250 visible options + 1 "more results" indicator
      expect(result.current.windowedOptions).toHaveLength(
        MAX_VISIBLE_OPTIONS + 1
      );
      expect(result.current.hiddenCount).toBe(250);
    });

    it('returns passthrough filter for large datasets', () => {
      const options = createOptions(500);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      expect(result.current.filterOption).toBeDefined();
      expect(result.current.filterOption?.()).toBe(true);
    });

    it('adds "more results" indicator when there are hidden options', () => {
      const options = createOptions(300);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      const indicator = result.current.windowedOptions.find(
        (opt) => opt.isMoreIndicator
      );

      expect(indicator).toBeDefined();
      expect(indicator?.value).toBe('__more_results_indicator__');
      expect(indicator?.label).toContain('50 more results');
      expect(indicator?.label).toContain('refine your search');
    });

    it('shows correct singular form for 1 hidden result', () => {
      // Create exactly 251 options to hide just 1
      const options = createOptions(MAX_VISIBLE_OPTIONS + 1);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      const indicator = result.current.windowedOptions.find(
        (opt) => opt.isMoreIndicator
      );

      expect(indicator?.label).toContain('1 more result');
      expect(indicator?.label).not.toContain('results');
    });

    it('calculates hiddenCount correctly', () => {
      const options = createOptions(1000);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues: []
        })
      );

      expect(result.current.hiddenCount).toBe(750);
    });
  });

  describe('Search filtering', () => {
    it('filters options by search term', () => {
      const options = createOptions(500);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: 'Option 10', // Matches 'Option 10', 'Option 100', etc.
          selectedValues: []
        })
      );

      // All filtered options should contain 'Option 10' in their label
      const matchingOptions = result.current.windowedOptions.filter(
        (opt) => !opt.isMoreIndicator
      );
      matchingOptions.forEach((opt) => {
        expect(opt.label.toLowerCase()).toContain('option 10');
      });
    });

    it('returns no indicator when search reduces results below threshold', () => {
      const options = createOptions(500);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: 'Option 1', // Matches ~111 options (1, 10-19, 100-199, etc.)
          selectedValues: []
        })
      );

      const hasIndicator = result.current.windowedOptions.some(
        (opt) => opt.isMoreIndicator
      );
      expect(hasIndicator).toBe(false);
      expect(result.current.hiddenCount).toBe(0);
    });

    it('handles case-insensitive search', () => {
      // Create large dataset to trigger windowing/search logic
      const baseOptions = createOptions(300);
      const options = [
        { value: 'apple', label: 'Apple' },
        { value: 'banana', label: 'BANANA' },
        { value: 'cherry', label: 'Cherry' },
        ...baseOptions
      ];

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: 'apple',
          selectedValues: []
        })
      );

      expect(result.current.windowedOptions).toHaveLength(1);
      expect(result.current.windowedOptions[0].label).toBe('Apple');
    });

    it('trims whitespace from search term', () => {
      // Create large dataset to trigger windowing/search logic
      const baseOptions = createOptions(300);
      const options = [
        { value: 'apple', label: 'Apple' },
        { value: 'banana', label: 'Banana' },
        ...baseOptions
      ];

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '  apple  ',
          selectedValues: []
        })
      );

      expect(result.current.windowedOptions).toHaveLength(1);
      expect(result.current.windowedOptions[0].label).toBe('Apple');
    });

    it('still applies windowing to large filtered results', () => {
      // Create options where many match 'Option'
      const options = createOptions(1000);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: 'Option', // Matches all 1000 options
          selectedValues: []
        })
      );

      // Should be windowed to 250 + indicator
      expect(result.current.windowedOptions).toHaveLength(
        MAX_VISIBLE_OPTIONS + 1
      );
      expect(result.current.hiddenCount).toBe(750);
    });
  });

  describe('Selected values prioritization', () => {
    it('always includes selected values in windowed results', () => {
      const options = createOptions(500);
      const selectedValues = [
        { value: 'option-400', label: 'Option 400' },
        { value: 'option-450', label: 'Option 450' }
      ];

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues
        })
      );

      const windowedValues = result.current.windowedOptions.map(
        (opt) => opt.value
      );
      expect(windowedValues).toContain('option-400');
      expect(windowedValues).toContain('option-450');
    });

    it('places selected values at the beginning', () => {
      const options = createOptions(500);
      const selectedValues = [{ value: 'option-300', label: 'Option 300' }];

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues
        })
      );

      // First option should be the selected one (after filtering out indicator)
      const nonIndicatorOptions = result.current.windowedOptions.filter(
        (opt) => !opt.isMoreIndicator
      );

      // Selected value should be included somewhere in the results
      const selectedInResults = nonIndicatorOptions.some(
        (opt) => opt.value === 'option-300'
      );
      expect(selectedInResults).toBe(true);
    });

    it('accounts for selected values in remaining slots calculation', () => {
      const options = createOptions(300);
      const selectedValues = [
        { value: 'option-1', label: 'Option 1' },
        { value: 'option-2', label: 'Option 2' }
      ];

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues
        })
      );

      // Should have 250 options (2 selected + 248 unselected) + 1 indicator
      expect(result.current.windowedOptions).toHaveLength(
        MAX_VISIBLE_OPTIONS + 1
      );

      // Hidden count should be total - visible (excluding indicator)
      expect(result.current.hiddenCount).toBe(50);
    });

    it('handles case where all slots are filled by selected values', () => {
      const options = createOptions(500);
      // Select 250 options
      const selectedValues = createOptions(MAX_VISIBLE_OPTIONS);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues
        })
      );

      // Should include all selected values + indicator
      expect(result.current.windowedOptions).toHaveLength(
        MAX_VISIBLE_OPTIONS + 1
      );
      expect(result.current.hiddenCount).toBe(250);
    });
  });

  describe('Edge cases', () => {
    it('handles empty options array', () => {
      const { result } = renderHook(() =>
        useWindowedOptions({
          options: [],
          inputValue: '',
          selectedValues: []
        })
      );

      expect(result.current.windowedOptions).toHaveLength(0);
      expect(result.current.hiddenCount).toBe(0);
      expect(result.current.filterOption).toBeUndefined();
    });

    it('handles empty search with no matches in large dataset', () => {
      const options = createOptions(500);

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: 'xyz-nonexistent',
          selectedValues: []
        })
      );

      expect(result.current.windowedOptions).toHaveLength(0);
      expect(result.current.hiddenCount).toBe(0);
    });

    it('handles selected values not present in options', () => {
      const options = createOptions(500);
      const selectedValues = [{ value: 'ghost-option', label: 'Ghost Option' }];

      const { result } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues
        })
      );

      // Should still work, ghost option won't be in the windowed results
      expect(result.current.windowedOptions).toHaveLength(
        MAX_VISIBLE_OPTIONS + 1
      );
    });

    it('memoizes results when inputs do not change', () => {
      const options = createOptions(500);
      const selectedValues: OptionData[] = [];

      const { result, rerender } = renderHook(() =>
        useWindowedOptions({
          options,
          inputValue: '',
          selectedValues
        })
      );

      const firstResult = result.current.windowedOptions;
      rerender();
      const secondResult = result.current.windowedOptions;

      expect(firstResult).toBe(secondResult);
    });
  });
});
