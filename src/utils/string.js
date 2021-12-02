export function stringifyWithNull(value) {
  return value === null || value === undefined ? '' : value.toString();
}
