/**
 * Inserts an element into a list without side effects.
 */
function justInsert(list: any, element: any, index: any, replace = true) {
  return [
    ...list.slice(0, index),
    element,
    ...list.slice(replace ? index + 1 : index)
  ];
}

/**
 * Removes an element from a list without side effects.
 */
function justRemove(list: any, index: any) {
  return [...list.slice(0, index), ...list.slice(index + 1)];
}

function toList(itemOrList: any) {
  return Array.isArray(itemOrList) ? itemOrList : [itemOrList];
}

function isEmptyArray(arr: any) {
  return Array.isArray(arr) && arr.length === 0;
}

export { justInsert, justRemove, toList, isEmptyArray };
