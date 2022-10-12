type OPERATOR_CODE =
  | 'equal'
  | 'not_equal'
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
  | 'starts_with'
  | 'not_starts_with'
  | 'ends_with'
  | 'not_ends_with'
  | 'is_numerical'
  | 'is_text';

export interface ComparisonRule {
  field_type?: '' | 'servar' | 'hidden';
  hidden_field?: string | null;
  servar?: string | null;
  comparison?: OPERATOR_CODE; // always present after the initial state
  values?: any[];
  field_id: string | null; // always non-null after the initial state
  field_key?: string;
}

// making resolved fields required
export interface ResolvedComparisonRule extends ComparisonRule {
  field_type: 'servar' | 'hidden';
  comparison: OPERATOR_CODE;
  field_key: string;
}

/**
 * Evaluates a comparison rule.
 * Note: The right side field values can be multi-values (array) as well
 * as the left-side field value (repeating field).
 * The LEFT side field values may be repeating because the field is in a repeat
 * or because the field is multi-valued.  To complicate further, the multi-valued
 * field may be in a repeat, resulting in an array of arrays.
 * Either way, the logic evaluation is the same:
 * EVERY LEFT SIDE VALUE MUST COMPARE TRUTHY TO AT LEAST ONE (SOME) RIGHT SIDE VALUE
 * FOR THE OVERALL EXPRESSION TO BE TRUE.
 */
const evalComparisonRule = (
  rule: ResolvedComparisonRule,
  fieldValues: { [key: string]: any }
): boolean => {
  const fieldValue = fieldValues[rule.field_key];
  return (
    Array.isArray(fieldValue)
      ? fieldValue.length
        ? fieldValue
        : [undefined]
      : [fieldValue]
  )
    .flatMap((v: any) => {
      if (Array.isArray(v) && !v.length) return [undefined];
      return v;
    })
    .every((fv: any) =>
      COMPARISON_FUNCTIONS[rule.comparison](
        fv,
        rule.values // TODO: support fields
      )
    );
};

type COMPARISON_FUNCTION = (leftOperand: any, rightOperand?: any) => boolean;

// Determines if the left compares to at least one right value
const someRight = (fn: COMPARISON_FUNCTION, l: any, r: any): boolean => {
  if (detectType(r) === 'array') return r.some((rv: any) => fn(l, rv));
  return fn(l, r);
};

const COMPARISON_FUNCTIONS: {
  [key: string]: (leftOperand: any, rightOperand?: any) => boolean;
} = {
  equal: (l, r) =>
    someRight((l, r) => deepEquals(coerceType(l), coerceType(r)), l, r),
  not_equal: (l, r) =>
    someRight((l, r) => !deepEquals(coerceType(l), coerceType(r)), l, r),
  is_filled: (l) => {
    const type = detectType(l);
    if (type === 'boolean' || type === 'number' || type === 'bigint')
      // Can only detect it as a number if it is filled
      return true;
    if (type === 'array') return (l as any[]).length > 0;
    return Boolean(l);
  },
  is_empty: (l) => {
    const type = detectType(l);
    // Can only detect it as a number if it is filled
    if (type === 'boolean' || type === 'number' || type === 'bigint')
      return false;
    if (type === 'array') return (l as any[]).length === 0;
    return !l;
  },
  greater_than: (l, r) =>
    someRight(
      (l, r) =>
        // If either side is null/empty, then the expression is false
        !anyEmptyOperands(l, r) && coerceType(l) > coerceType(r),
      l,
      r
    ),
  greater_than_or_equal: (l, r) =>
    someRight(
      (l, r) => !anyEmptyOperands(l, r) && coerceType(l) >= coerceType(r),
      l,
      r
    ),
  less_than: (l, r) =>
    someRight(
      (l, r) => !anyEmptyOperands(l, r) && coerceType(l) < coerceType(r),
      l,
      r
    ),
  less_than_or_equal: (l, r) =>
    someRight(
      (l, r) => !anyEmptyOperands(l, r) && coerceType(l) <= coerceType(r),
      l,
      r
    ),
  is_numerical: (l) => {
    const type = detectType(l);
    return type === 'number' || type === 'bigint';
  },
  is_text: (l) => !isEmptyOrNull(l) && detectType(l) === 'string',
  contains: (l, r) => someRight((l, r) => String(l).includes(r), l, r),
  not_contains: (l, r) => someRight((l, r) => !String(l).includes(r), l, r),
  starts_with: (l, r) => someRight((l, r) => String(l).startsWith(r), l, r),
  not_starts_with: (l, r) =>
    someRight((l, r) => !String(l).startsWith(r), l, r),
  ends_with: (l, r) => someRight((l, r) => String(l).endsWith(r), l, r),
  not_ends_with: (l, r) => someRight((l, r) => !String(l).endsWith(r), l, r),
  is_true: (l) => Boolean(l),
  is_false: (l) => !l
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
function coerceType(val: any, type: TYPE = detectType(val)): any {
  if (type === 'number') return Number(val);
  if (type === 'bigint') return BigInt(val);
  return val;
}

export { evalComparisonRule, type OPERATOR_CODE };
