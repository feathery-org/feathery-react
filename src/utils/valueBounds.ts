import { fieldValues } from './init';

// The value of a linked field rounded to an integer, or undefined if it doesn't hold
// a number. Any hidden field type can be linked, so only numbers and numeric text count
export function getLinkedValue(fieldKey: string | undefined) {
  if (!fieldKey) return undefined;
  const value = fieldValues[fieldKey];
  // Number() would turn true into 1 and blank text into 0
  if (typeof value === 'string' ? !value.trim() : typeof value !== 'number')
    return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : undefined;
}

// A min above the max wins, so the range never inverts
function getLinkedBounds(servar: any) {
  const min = getLinkedValue(servar.metadata?.min_value_field_key);
  let max = getLinkedValue(servar.metadata?.max_value_field_key);
  if (min !== undefined && max !== undefined && min > max) max = min;
  return { min, max };
}

// A linked bound once its field holds a number, otherwise the fixed one
export function getSliderRange(servar: any) {
  const linked = getLinkedBounds(servar);
  const min = linked.min ?? servar.min_length ?? 0;
  const max = linked.max ?? servar.max_length ?? 100;
  return { min, max: Math.max(min, max) };
}

export function clampToLinkedBounds(value: number, servar: any) {
  const { min, max } = getLinkedBounds(servar);
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}
