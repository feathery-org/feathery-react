import { getDefaultFieldValue } from './fieldHelperFunctions';

/**
 * Inserts an element into a list without side effects.
 */
function justInsert(
  list: any,
  element: any,
  index: any,
  field: any = undefined,
  replace = true
) {
  const newList = [...list];

  // Add null values if the index is beyond the current length of the list
  if (index >= newList.length) {
    newList.length = index;
    const fillValue = field ? getDefaultFieldValue(field) : '';
    newList.fill(fillValue, list.length, index);
  }

  return [
    ...newList.slice(0, index),
    element,
    ...newList.slice(replace ? index + 1 : index)
  ];
}

/**
 * Moves one entry to a new index without side effects. `to` is the entry's
 * index in the result, matching Array#splice semantics. The input is returned
 * identity-equal when the move is a no-op or out of range, so callers can
 * cheaply detect that nothing happened.
 */
function arrayMove(list: any[], from: number, to: number) {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  if (to < 0 || to >= list.length) return list;

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Removes an element from a list without side effects.
 */
function justRemove(list: any, index: any) {
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

function toList(itemOrList: any, coerceCSV = false) {
  if (Array.isArray(itemOrList)) return itemOrList;
  else if ([null, undefined].includes(itemOrList)) return [];
  else if (coerceCSV && typeof itemOrList === 'string')
    return itemOrList.split(',').map((s: string) => s.trim());
  return [itemOrList];
}

function isEmptyArray(arr: any) {
  return Array.isArray(arr) && arr.length === 0;
}

export { justInsert, justRemove, arrayMove, toList, isEmptyArray };
