import { fieldValues } from './init';
import internalState from './internalState';

type OPERATOR_CODE =
  | 'equal'
  | 'not_equal'
  | 'equal_ignore_case'
  | 'not_equal_ignore_case'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'is_filled'
  | 'is_empty'
  | 'is_true'
  | 'is_false'
  | 'contains'
  | 'not_contains'
  | 'contains_ignore_case'
  | 'not_contains_ignore_case'
  | 'starts_with'
  | 'not_starts_with'
  | 'ends_with'
  | 'not_ends_with'
  | 'is_numerical'
  | 'is_text'
  | 'selections_include'
  | 'selections_dont_include';

export type FieldValueType = {
  field_type: 'servar' | 'hidden';
  field_id: string;
  field_key: string;
};
export type ValueType = string | FieldValueType;

export interface ComparisonRule {
  field_type?: '' | 'servar' | 'hidden';
  hidden_field?: string | null;
  servar?: string | null;
  comparison?: OPERATOR_CODE; // always present after the initial state
  values: ValueType[];
  field_id: string | null; // always non-null after the initial state
  field_key?: string;
}

// making resolved fields required
export interface ResolvedComparisonRule extends ComparisonRule {
  field_type: 'servar' | 'hidden';
  comparison: OPERATOR_CODE;
  field_key: string;
}

const valueTypeIsField = (v: ValueType): v is FieldValueType =>
  typeof v === 'object' && 'field_id' in v;

/**
 * Evaluates a comparison rule.
 * @param rule
 * @param repeatIndex If evaluating for a specific index of a repeat, use the index to
 * only compare repeating fields (left and right) at THAT index, i.e. only use that indexed
 * value in the comparison.
 * @param internalId Needed to get field data and verify if a field is repeating
 *
 * Note: The right side field values can be multi-values (array) as well
 * as the left-side field value (repeating field).
 * The LEFT side field values may be repeating because the field is in a repeat
 * or because the field is multi-valued.  To complicate further, the multi-valued
 * field may be in a repeat, resulting in an array of arrays.
 * Additionally, the RIGHT side field values could also be existing fields which themselves
 * might be multi-valued (either a multi-valued type or in a repeat or both).
 * Either way, the logic evaluation is the same:
 * SOME LEFT SIDE VALUE MUST COMPARE TRUTHY TO AT LEAST ONE (SOME) RIGHT SIDE VALUE
 * FOR THE OVERALL EXPRESSION TO BE TRUE.
 *
 * Note: The [undefined] arrays used when flattening the left and right values below are
 *  to deal with multi-valued repeating fields (e.g. checkbox group) on both the left and right
 *  that have no values (empty array).  This logic is flattening the values out to feed to
 *  the "some left value must compare to some right value" comparison logic.
 *  Since [].every() always returns true, we need to have a value of undefined for each empty
 *  field value for it to properly evaluate the empty field case.
 */

const evalComparisonRule = (
  rule: ResolvedComparisonRule,
  repeatIndex?: number | undefined,
  internalId?: string
): boolean => {
  // flatten the right side values/fields into flat list of values
  const flatValues = rule.values.flatMap((value) => {
    if (value !== null && valueTypeIsField(value))
      return getValuesAsArray(value.field_key, repeatIndex, internalId).flatMap(
        (v: any) => {
          if (Array.isArray(v) && !v.length) return [undefined];
          return v;
        }
      );
    return value;
  });

  const leftFieldValues = getValuesAsArray(
    rule.field_key,
    repeatIndex,
    internalId
  ).flatMap((v: any) => {
    if (Array.isArray(v) && !v.length) return [undefined];
    return v;
  });
  return COMPARISON_FUNCTIONS[rule.comparison](leftFieldValues, flatValues);
};
const getValuesAsArray = (
  key: string,
  repeatIndex?: number,
  internalId?: string
) => {
  const values: any = fieldValues[key];

  let isRepeat = Array.isArray(values);
  if (internalId) {
    const fieldType =
      internalState[internalId]?.fields?.[key]?._getFormSpecificProps().type;
    if (['button_group', 'multiselect', 'dropdown_multi'].includes(fieldType)) {
      // TODO: this only gets the types for fields on the current form. We need
      //  a solution that will robustly get either the repeatability or type of
      //  ALL fields.
      isRepeat = Array.isArray(values[0]);
    }
  }

  if (isRepeat) {
    if (values.length) {
      if (repeatIndex !== undefined) return [values[repeatIndex]];
      return values;
    }
    return [undefined];
  }
  return [values];
};

type COMPARISON_FUNCTION = (leftOperand: any, rightOperand?: any) => boolean;

// Determines if the left compares to at least one right value
const someRight = (fn: COMPARISON_FUNCTION, l: any, r: any): boolean => {
  if (detectType(r) === 'array') return r.some((rv: any) => fn(l, rv));
  return fn(l, r);
};
// Determines if the left compares to at every right value
const everyRight = (fn: COMPARISON_FUNCTION, l: any, r: any): boolean => {
  if (detectType(r) === 'array') return r.every((rv: any) => fn(l, rv));
  return fn(l, r);
};

const COMPARISON_FUNCTIONS: {
  [key: string]: (leftOperand: any, rightOperand?: any) => boolean;
} = {
  equal: (l, r) =>
    l.some((l: any) =>
      someRight(
        (l, r) => (!l && !r) || deepEquals(coerceType(l), coerceType(r)),
        l,
        r
      )
    ),
  not_equal: (l, r) =>
    l.some((l: any) =>
      everyRight(
        (l, r) => {
          if (!l) return !!r;
          else if (!r) return !!l;
          else return !deepEquals(coerceType(l), coerceType(r));
        },
        l,
        r
      )
    ),
  equal_ignore_case: (l, r) =>
    l.some((l: any) =>
      someRight(
        (l, r) =>
          (!l && !r) || deepEquals(coerceType(l, true), coerceType(r, true)),
        l,
        r
      )
    ),
  not_equal_ignore_case: (l, r) =>
    l.some((l: any) =>
      everyRight(
        (l, r) => {
          if (!l) return !!r;
          else if (!r) return !!l;
          else return !deepEquals(coerceType(l, true), coerceType(r, true));
        },
        l,
        r
      )
    ),
  selections_include: (l, r) => {
    const compareRight = (l: any, r: any) =>
      someRight(
        (l, r) => (!l && !r) || deepEquals(coerceType(l), coerceType(r)),
        l,
        r
      );
    return l.some((l: any) => {
      if (l && detectType(l) === 'object')
        // Special behavior for left side objects.  Their keys will be compared to the right side
        // values.  While generally useful, this is specifically for the case where the left side
        // is the feathery.cart field which is an object with keys that are the
        // product ids selected for purchase.
        return Object.keys(l).some((key) => compareRight(key, r));
      return compareRight(l, r);
    });
  },
  selections_dont_include: (l, r) => {
    const compareRight = (l: any, r: any) =>
      everyRight(
        (l, r) => {
          if (!l) return !!r;
          else if (!r) return !!l;
          else return !deepEquals(coerceType(l), coerceType(r));
        },
        l,
        r
      );
    return l.every((l: any) => {
      if (l && detectType(l) === 'object')
        // Special behavior for left side objects.  Their keys will be compared to the right side
        // values.  While generally useful, this is specifically for the case where the left side
        // is the feathery.cart field which is an object with keys that are the
        // product ids selected for purchase.
        return Object.keys(l).every((key) => compareRight(key, r));
      return compareRight(l, r);
    });
  },
  is_filled: (l) =>
    l.some((l: any) => {
      const type = detectType(l);
      if (type === 'boolean' || type === 'number' || type === 'bigint')
        // Can only detect it as a number if it is filled
        return true;
      if (type === 'array') return (l as any[]).length > 0;
      return Boolean(l);
    }),
  is_empty: (l) =>
    l.some((l: any) => {
      const type = detectType(l);
      // Can only detect it as a number if it is filled
      if (type === 'boolean' || type === 'number' || type === 'bigint')
        return false;
      if (type === 'array') return (l as any[]).length === 0;
      return !l;
    }),
  greater_than: (l, r) =>
    l.some((l: any) =>
      someRight(
        // If either side is null/empty, then the expression is false
        (l, r) => !anyEmptyOperands(l, r) && coerceType(l) > coerceType(r),
        l,
        r
      )
    ),
  greater_than_or_equal: (l, r) =>
    l.some((l: any) =>
      someRight(
        (l, r) => !anyEmptyOperands(l, r) && coerceType(l) >= coerceType(r),
        l,
        r
      )
    ),
  less_than: (l, r) =>
    l.some((l: any) =>
      someRight(
        (l, r) => !anyEmptyOperands(l, r) && coerceType(l) < coerceType(r),
        l,
        r
      )
    ),
  less_than_or_equal: (l, r) =>
    l.some((l: any) =>
      someRight(
        (l, r) => !anyEmptyOperands(l, r) && coerceType(l) <= coerceType(r),
        l,
        r
      )
    ),
  is_numerical: (l) =>
    l.some((l: any) => {
      const type = detectType(l);
      return type === 'number' || type === 'bigint';
    }),
  is_text: (l) =>
    l.some((l: any) => !isEmptyOrNull(l) && detectType(l) === 'string'),
  contains: (l, r) =>
    l.some((l: any) => someRight((l, r) => String(l).includes(r), l, r)),
  not_contains: (l, r) =>
    l.some((l: any) => everyRight((l, r) => !String(l).includes(r), l, r)),
  contains_ignore_case: (l, r) =>
    l.some((l: any) =>
      someRight(
        (l, r) =>
          String((l ?? '').toLowerCase()).includes((r ?? '').toLowerCase()),
        l,
        r
      )
    ),
  not_contains_ignore_case: (l, r) =>
    l.some((l: any) =>
      everyRight(
        (l, r) =>
          !String((l ?? '').toLowerCase()).includes((r ?? '').toLowerCase()),
        l,
        r
      )
    ),
  starts_with: (l, r) =>
    l.some((l: any) => someRight((l, r) => String(l).startsWith(r), l, r)),
  not_starts_with: (l, r) =>
    l.some((l: any) => everyRight((l, r) => !String(l).startsWith(r), l, r)),
  ends_with: (l, r) =>
    l.some((l: any) => someRight((l, r) => String(l).endsWith(r), l, r)),
  not_ends_with: (l, r) =>
    l.some((l: any) => everyRight((l, r) => !String(l).endsWith(r), l, r)),
  is_true: (l) => l.some((l: any) => Boolean(l)),
  is_false: (l) => l.some((l: any) => !l)
};

function deepEquals(a: any, b: any): boolean {
  if (a === b) {
    return true;
  } else if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return [...aKeys, ...bKeys].every((key) => deepEquals(a[key], b[key]));
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    } else {
      return a.every((_, index) => deepEquals(a[index], b[index]));
    }
  } else {
    return false;
  }
}
const anyEmptyOperands = (l: any, r: any) =>
  isEmptyOrNull(l) || isEmptyOrNull(r);
const isEmptyOrNull = (v: any) => v === null || v === '';

type TYPE =
  | 'object'
  | 'number'
  | 'bigint'
  | 'string'
  | 'boolean'
  | 'array'
  | 'symbol'
  | 'function'
  | 'undefined';
function detectType(val: unknown): TYPE {
  let type: TYPE = typeof val;
  if (type === 'object' && Array.isArray(val)) type = 'array';
  // strings 'disguised' as numbers?
  if (
    type === 'string' &&
    !isNaN(val as number) &&
    !isNaN(parseFloat(val as string))
  )
    type = 'number';
  return type;
}
function coerceType(val: any, ignoreCase = false): any {
  const type = detectType(val);
  if (type === 'number') return Number(val);
  if (type === 'bigint') return BigInt(val);
  if (type === 'string' && ignoreCase) return val.toLowerCase();
  return val;
}

export { evalComparisonRule };
export type { OPERATOR_CODE };
