/**
 * Whether writing `next` over `current` would leave a field's value unchanged.
 *
 * Used to skip the network flush (and rerender) when a logic rule or the
 * public API sets a field to the value it already holds. Repeated fields
 * are arrays and file values are Promises, so arrays and plain objects are
 * compared structurally while files, promises and other class instances
 * only count as the same by reference.
 */
export function isSameFieldValue(current: any, next: any): boolean {
  if (current === next) return true;
  if (Array.isArray(current) || Array.isArray(next)) {
    if (!Array.isArray(current) || !Array.isArray(next)) return false;
    if (current.length !== next.length) return false;
    // Index loop rather than `every`, which skips holes in sparse arrays
    for (let i = 0; i < current.length; i++) {
      if (!isSameFieldValue(current[i], next[i])) return false;
    }
    return true;
  }
  if (!isPlainObject(current) || !isPlainObject(next)) return false;
  const currentKeys = Object.keys(current);
  if (currentKeys.length !== Object.keys(next).length) return false;
  return currentKeys.every(
    (key) => key in next && isSameFieldValue(current[key], next[key])
  );
}

function isPlainObject(value: any): value is Record<string, any> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
