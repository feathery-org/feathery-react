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

const SELECT_ACTIONS = new Set(['select-option', 'create-option']);

export default function useSelectionOrdering(
  selectVal: OptionData[],
  enabled: boolean
): SelectionOrdering {
  // Persist the user's original selection order so we can render collapsed chips
  // in the same order they were chosen while still allowing hover reordering.
  const selectionOrderRef = useRef<string[]>(
    selectVal.map((option) => option.value)
  );

  const selectValSignature = useMemo(() => valuesSignature(selectVal), [
    selectVal
  ]);

  useEffect(() => {
    // Remove values that are no longer selected and append any new selections to
    // the end of the order ref. This keeps the ref aligned with `selectVal` while
    // preserving the relative order in which values were introduced.
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

    // Sort the current selections to match the preserved order. Values that missed
    // the ref (e.g., newly created options) naturally sink to the end.
    return [...selectVal].sort((a, b) => {
      const aIndex = orderIndexMap.get(a.value) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndexMap.get(b.value) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
  }, [enabled, selectVal, selectValSignature]);

  const reorderSelected: ReorderFn = useCallback(
    (selected, actionMeta) => {
      if (!enabled || !Array.isArray(selected)) return selected;
      if (!SELECT_ACTIONS.has(actionMeta.action)) return selected;

      // We only mutate the order when a value is added/created. React Select passes
      // the affected option via `actionMeta.option`.
      const option = actionMeta.option;
      if (!option) return selected;

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
        const aIndex =
          stableOrderIndex.get(a.value) ?? Number.MAX_SAFE_INTEGER;
        const bIndex =
          stableOrderIndex.get(b.value) ?? Number.MAX_SAFE_INTEGER;
        return aIndex - bIndex;
      });

      // Promote the most recently added value to the front so the hover-expanded
      // chips show the newest selection first without mutating the persisted order
      // of the underlying payload.
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
