import { fieldValues } from './init';
import {
  evalComparisonRule,
  FieldValueType,
  ResolvedComparisonRule
} from './logic';

/**
 * Dynamic min/max for number fields. The first rule in
 * `servar.metadata.dynamic_bounds` whose conditions all pass wins; a bound is
 * a literal number, null (unbounded), or another field whose current value is
 * read at resolve time. When no rule matches, each side falls back to the
 * field named by `servar.metadata.bound_fields` if there is one, and otherwise
 * to the `min_length` / `max_length` column.
 */
export type FieldRef = FieldValueType;
export type BoundValue = number | null | FieldRef;
export interface DynamicBoundRule {
  id: string;
  conditions: ResolvedComparisonRule[];
  min: BoundValue;
  max: BoundValue;
}
export interface ResolvedNumberBounds {
  min: number | null;
  max: number | null;
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
  const meta = servar?.metadata;
  const rules = meta?.dynamic_bounds;
  if (Array.isArray(rules) && rules.length > 0) return true;
  return (
    isFieldRef(meta?.bound_fields?.min) || isFieldRef(meta?.bound_fields?.max)
  );
}

export function resolveBound(bound: BoundValue, repeat?: number | null) {
  if (!isFieldRef(bound)) return toBound(bound);
  let raw: any = fieldValues[bound.field_key];
  // A repeated driver read from outside its repeat uses the first row
  if (Array.isArray(raw)) raw = raw[repeat ?? 0];
  return toBound(raw);
}

/**
 * The bounds that apply when no rule matches: each side is the field named by
 * `metadata.bound_fields` when there is one, otherwise the static column.
 */
function baseBounds(servar: any, repeat?: number | null): ResolvedNumberBounds {
  const boundFields = servar?.metadata?.bound_fields;
  const side = (name: 'min' | 'max', column: any) => {
    const ref = boundFields?.[name];
    return isFieldRef(ref) ? resolveBound(ref, repeat) : toBound(column);
  };
  return {
    min: side('min', servar?.min_length),
    max: side('max', servar?.max_length)
  };
}

export function resolveNumberBounds(
  servar: any,
  repeat?: number | null,
  internalId?: string
): ResolvedNumberBounds {
  if (!hasDynamicBounds(servar)) return baseBounds(servar, repeat);
  const repeatIndex = repeat ?? undefined;
  try {
    const rules = servar.metadata.dynamic_bounds;
    const match = (
      Array.isArray(rules) ? (rules as DynamicBoundRule[]) : []
    ).find((rule) =>
      (rule.conditions ?? []).every((condition) =>
        evalComparisonRule(condition, repeatIndex, internalId)
      )
    );
    if (!match) return baseBounds(servar, repeat);
    return {
      min: resolveBound(match.min, repeat),
      max: resolveBound(match.max, repeat)
    };
  } catch {
    // Malformed metadata must never take the field down with it
    return baseBounds(servar, repeat);
  }
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
    const meta = element?.servar?.metadata;
    [meta?.bound_fields?.min, meta?.bound_fields?.max].forEach(
      (bound) => isFieldRef(bound) && refSet.add(bound.field_key)
    );
    const rules = meta?.dynamic_bounds;
    if (!Array.isArray(rules)) return;
    rules.forEach((rule: DynamicBoundRule) => {
      // Runs inside a step-level memo, so malformed metadata must not throw
      if (!rule || typeof rule !== 'object') return;
      const conditions = rule.conditions;
      if (Array.isArray(conditions))
        conditions.forEach((condition) => {
          if (!condition || typeof condition !== 'object') return;
          if (condition.field_key) refSet.add(condition.field_key);
          const values = condition.values;
          if (Array.isArray(values))
            values.forEach(
              (value) => isFieldRef(value) && refSet.add(value.field_key)
            );
        });
      [rule.min, rule.max].forEach(
        (bound) => isFieldRef(bound) && refSet.add(bound.field_key)
      );
    });
  });
  return refSet;
}
