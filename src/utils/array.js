/**
 * Inserts an element into a list without side effects.
 */
function justInsert(list, element, index, replace = true) {
    return [
        ...list.slice(0, index),
        element,
        ...list.slice(replace ? index + 1 : index)
    ];
}

/**
 * Removes an element from a list without side effects.
 */
function justRemove(list, index) {
    return [...list.slice(0, index), ...list.slice(index + 1)];
}

function toList(itemOrList) {
    return Array.isArray(itemOrList) ? itemOrList : [itemOrList];
}

export { justInsert, justRemove, toList };
