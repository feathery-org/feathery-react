import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ActionMeta, OnChangeValue } from 'react-select';

import type { OptionData } from './types';

// Stable key used to detect when the selected values change without relying on
// object identity coming from React Select.
const valuesSignature = (values: OptionData[]) =>
  values.map((item) => item.value).join('|');

const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

type ReorderFn = (
  selected: OnChangeValue<OptionData, true>,
  actionMeta: ActionMeta<OptionData>
) => OnChangeValue<OptionData, true>;

type SelectionOrdering = {
  orderedSelectVal: OptionData[];
  reorderSelected: ReorderFn;
};

export default function useSelectionOrdering(
  selectVal: OptionData[],
  enabled: boolean
): SelectionOrdering {
  // Cache the pick order so collapsed chips mirror selection sequence while hover can reshuffle.
  const selectionOrderRef = useRef<string[]>(
    selectVal.map((option) => option.value)
  );

  const selectValSignature = useMemo(
    () => valuesSignature(selectVal),
    [selectVal]
  );

  useEffect(() => {
    // Drop deselected values and append new ones so the ref tracks selectVal without losing order.
    const currentValues = selectVal.map((option) => option.value);
    let nextOrder = selectionOrderRef.current.filter((value) =>
      currentValues.includes(value)
    );

    for (let index = currentValues.length - 1; index >= 0; index -= 1) {
      const value = currentValues[index];
      if (!nextOrder.includes(value)) {
        nextOrder = [value, ...nextOrder];
      }
    }

    if (!arraysEqual(selectionOrderRef.current, nextOrder)) {
      selectionOrderRef.current = nextOrder;
    }
  }, [selectVal, selectValSignature]);

  const orderedSelectVal = useMemo(() => {
    if (!enabled) return selectVal;

    const order = selectionOrderRef.current;
    if (order.length <= 1) return selectVal;

    const orderIndexMap = new Map<string, number>();
    order.forEach((value, index) => orderIndexMap.set(value, index));

    // Sort selections by the preserved order; unknown values naturally sink to the end.
    return [...selectVal].sort((a, b) => {
      const aIndex = orderIndexMap.get(a.value) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndexMap.get(b.value) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [enabled, selectVal, selectValSignature]);

  const reorderSelected: ReorderFn = useCallback(
    (selected, actionMeta) => {
      if (!enabled || !Array.isArray(selected)) return selected;

      // Only adjust ordering when React Select provides the added option and it persists in the selection.
      const option = actionMeta.option;
      if (!option) return selected;
      if (!selected.some((item) => item.value === option.value)) {
        return selected;
      }

      const optionValue = option.value;
      const previousOrder = selectionOrderRef.current;
      const stableOrder = previousOrder.filter((value) =>
        selected.some((item) => item.value === value)
      );

      if (!stableOrder.includes(optionValue)) {
        stableOrder.push(optionValue);
      }

      const stableOrderIndex = new Map<string, number>();
      stableOrder.forEach((value, index) => stableOrderIndex.set(value, index));

      const orderedSelection = [...selected].sort((a, b) => {
        const aIndex = stableOrderIndex.get(a.value) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = stableOrderIndex.get(b.value) ?? Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex;
      });

      // Surface the latest pick first for hover preview without rewriting the stored order.
      selectionOrderRef.current = [
        optionValue,
        ...selectionOrderRef.current.filter((value) => value !== optionValue)
      ];

      return orderedSelection;
    },
    [enabled]
  );

  return { orderedSelectVal, reorderSelected };
}
