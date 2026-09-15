import { fieldValues } from './init';
import { FieldValueType } from './logic';

/**
 * A number field's min/max may track another field rather than a fixed number,
 * named by `servar.metadata.bound_fields`. A side with no reference falls back
 * to the `min_length` / `max_length` column.
 */
export type FieldRef = FieldValueType;
export type BoundValue = number | null | FieldRef;
export interface ResolvedNumberBounds {
  min: number | null;
  max: number | null;
  // Whether a bound tracks a field, so it can move under a stored value
  dynamic: boolean;
}

export const NUMBER_BOUND_TYPES = new Set(['integer_field', 'slider']);

export const isFieldRef = (value: any): value is FieldRef =>
  typeof value === 'object' && value !== null && 'field_id' in value;

const toBound = (value: any): number | null => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export function hasDynamicBounds(servar: any): boolean {
  const boundFields = servar?.metadata?.bound_fields;
  return isFieldRef(boundFields?.min) || isFieldRef(boundFields?.max);
}

export function resolveBound(bound: BoundValue, repeat?: number | null) {
  if (!isFieldRef(bound)) return toBound(bound);
  let raw: any = fieldValues[bound.field_key];
  // A repeated driver read from outside its repeat uses the first row
  if (Array.isArray(raw)) raw = raw[repeat ?? 0];
  return toBound(raw);
}

export function resolveNumberBounds(
  servar: any,
  repeat?: number | null
): ResolvedNumberBounds {
  const boundFields = servar?.metadata?.bound_fields;
  const side = (name: 'min' | 'max', column: any) => {
    const ref = boundFields?.[name];
    return isFieldRef(ref) ? resolveBound(ref, repeat) : toBound(column);
  };
  return {
    min: side('min', servar?.min_length),
    max: side('max', servar?.max_length),
    dynamic: hasDynamicBounds(servar)
  };
}

/**
 * Widens bounds to include `value`. imask re-appends a value character by
 * character on mount, so a stored 25 under a max of 20 would come back as 2;
 * validation, not the mask, is what reports a value the bounds moved past.
 */
export function widenBoundsToValue(
  bounds: ResolvedNumberBounds,
  value: any
): ResolvedNumberBounds {
  const num = toBound(value);
  if (num === null) return bounds;
  return {
    ...bounds,
    min: bounds.min === null ? null : Math.min(bounds.min, num),
    max: bounds.max === null ? null : Math.max(bounds.max, num)
  };
}

/**
 * Field keys whose changes can move a number field's bounds on this step, so
 * the form rerenders those fields the way it does for text variables.
 */
export function getNumberBoundReferences(
  elements: [any, string][]
): Set<string> {
  const refSet = new Set<string>();
  elements.forEach(([element]) => {
    const boundFields = element?.servar?.metadata?.bound_fields;
    [boundFields?.min, boundFields?.max].forEach(
      (bound) => isFieldRef(bound) && refSet.add(bound.field_key)
    );
  });
  return refSet;
}
