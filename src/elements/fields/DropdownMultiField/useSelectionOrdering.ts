import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { ActionMeta, OnChangeValue } from 'react-select';

import type { OptionData } from './types';

type SelectionOrderingParams = {
  values: OptionData[];
  enabled: boolean;
};

type SelectionOrderingResult = {
  orderedValues: OptionData[];
  reorderSelection: (
    selected: OnChangeValue<OptionData, true>,
    actionMeta: ActionMeta<OptionData>
  ) => OnChangeValue<OptionData, true>;
};

const valuesSignature = (values: OptionData[]) =>
  JSON.stringify(values.map((item) => item.value));

const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

export default function useSelectionOrdering({
  values,
  enabled
}: SelectionOrderingParams): SelectionOrderingResult {
  const selectionOrderRef = useRef<string[]>(
    values.map((option) => option.value)
  );

  const signature = useMemo(() => valuesSignature(values), [values]);

  useEffect(() => {
    if (!enabled) {
      selectionOrderRef.current = [];
      return;
    }

    const currentValues = values.map((option) => option.value);
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
  }, [enabled, signature, values]);

  const orderedValues = useMemo(() => {
    if (!enabled) return values;

    const order = selectionOrderRef.current;
    if (order.length <= 1) return values;

    const orderIndex = new Map<string, number>();
    order.forEach((value, index) => orderIndex.set(value, index));

    return [...values].sort((a, b) => {
      const aIndex = orderIndex.get(a.value) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.get(b.value) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [enabled, signature, values]);

  const reorderSelection = useCallback(
    (
      selected: OnChangeValue<OptionData, true>,
      actionMeta: ActionMeta<OptionData>
    ) => {
      if (!enabled || !Array.isArray(selected)) return selected;

      const option = actionMeta.option;
      if (!option) return selected;
      if (!selected.some((item) => item.value === option.value)) {
        return selected;
      }

      const optionValue = option.value;
      const stableOrder = selectionOrderRef.current.filter((value) =>
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

      selectionOrderRef.current = [
        optionValue,
        ...selectionOrderRef.current.filter((value) => value !== optionValue)
      ];

      return orderedSelection;
    },
    [enabled]
  );

  return { orderedValues, reorderSelection };
}
