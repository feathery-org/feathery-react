import { fieldValues } from './init';

// The value of a linked field rounded to an integer, or undefined if it doesn't hold
// a number. Any hidden field type can be linked, so only numbers and numeric text count
export function getLinkedValue(
  fieldKey: string | undefined,
  values: Record<string, any> = fieldValues
) {
  if (!fieldKey) return undefined;
  const value = values[fieldKey];
  // Number() would turn true into 1 and blank text into 0
  if (typeof value === 'string' ? !value.trim() : typeof value !== 'number')
    return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num) : undefined;
}

// A min above the max wins, so the range never inverts
function getLinkedBounds(servar: any, values?: Record<string, any>) {
  const min = getLinkedValue(servar.metadata?.min_value_field_key, values);
  let max = getLinkedValue(servar.metadata?.max_value_field_key, values);
  if (min !== undefined && max !== undefined && min > max) max = min;
  return { min, max };
}

// The range once a linked field holds a number: the linked bound, otherwise the
// fixed one, never inverted
function getLinkedRange(servar: any, values?: Record<string, any>) {
  const linked = getLinkedBounds(servar, values);
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

// The step the slider renders with; rc-slider treats a step of 0 or less as 1
export function getSliderStep(servar: any) {
  const step = Number(servar.metadata?.step_size);
  return step > 0 ? step : 1;
}

// Mirrors rc-slider's formatValue: the handle sits on whichever of the
// step-aligned value, min and max is nearest, the later one on a tie
function snapToSlider(value: number, min: number, max: number, step: number) {
  const inRange = Math.min(Math.max(value, min), max);
  // rc-slider rounds away float noise like 0.30000000000000004 the same way
  const decimals = (num: number) => (String(num).split('.')[1] || '').length;
  const stepped = Number(
    (min + Math.round((inRange - min) / step) * step).toFixed(
      Math.max(decimals(step), decimals(min), decimals(max))
    )
  );
  const candidates = stepped >= min && stepped <= max ? [stepped] : [];
  candidates.push(min, max);
  return candidates.reduce((best, candidate) =>
    Math.abs(inRange - candidate) <= Math.abs(inRange - best) ? candidate : best
  );
}

// The value the slider shows, and so the value submit stores: a linked range can
// move under the value, and the handle snaps into it and onto a step from its
// min. `values` lets submit settle sliders against each other without writing
// fieldValues first
export function alignToSlider(
  value: number,
  servar: any,
  values?: Record<string, any>
) {
  const range = getLinkedRange(servar, values);
  if (!range) return value;
  return snapToSlider(value, range.min, range.max, getSliderStep(servar));
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
