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

// The range once a linked field holds a number: the linked bound, otherwise the
// fixed one, never inverted
function getLinkedRange(servar: any) {
  const linked = getLinkedBounds(servar);
  if (linked.min === undefined && linked.max === undefined) return undefined;
  const min = linked.min ?? servar.min_length ?? 0;
  const max = linked.max ?? servar.max_length ?? 100;
  return { min, max: Math.max(min, max) };
}

// Sliders without a linked bound keep their fixed range and value as they were
// before bounds could be linked
export function getSliderRange(servar: any) {
  return (
    getLinkedRange(servar) ?? {
      min: servar.min_length ?? 0,
      max: servar.max_length ?? 100
    }
  );
}

// The value the slider shows, and so the value submit stores
export function clampToSliderRange(value: number, servar: any) {
  const range = getLinkedRange(servar);
  return range ? Math.min(Math.max(value, range.min), range.max) : value;
}

// Keys whose value sets a slider's range on the step. Number fields only use
// their linked bounds on submit, so only sliders need to rerender
export function getValueBoundReferences(step: any) {
  const keys = new Set<string>();
  (step?.servar_fields ?? []).forEach(({ servar }: any) => {
    if (servar?.type !== 'slider') return;
    const { min_value_field_key: min, max_value_field_key: max } =
      servar.metadata ?? {};
    if (min) keys.add(min);
    if (max) keys.add(max);
  });
  return keys;
}
