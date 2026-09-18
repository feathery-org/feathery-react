export type HubConstraintCondition = {
  field_key?: string;
  comparator: string;
  value?: string | number;
};

export type HubConstraintRule = {
  when?: HubConstraintCondition[];
  constraint: HubConstraintCondition;
  error_message?: string;
};

type CellCondition = {
  fieldKey: string;
  type: string;
  comparator: string;
  value: string;
};

export type CellConstraint = {
  when: CellCondition[];
  constraint: CellCondition;
  message: string;
};

export function cellConstraints(
  owner: { key: string; constraint_rules?: HubConstraintRule[] },
  fields: Map<string, { type: string }>,
  storageKey: (hubKey: string) => string
): CellConstraint[] {
  const resolve = (condition: HubConstraintCondition): CellCondition => {
    const key =
      !condition.field_key || condition.field_key === 'value'
        ? owner.key
        : condition.field_key;
    return {
      fieldKey: storageKey(key),
      type: fields.get(key)?.type ?? 'any',
      comparator: condition.comparator,
      value: String(condition.value ?? '')
    };
  };
  return (owner.constraint_rules ?? []).map((rule) => ({
    when: (rule.when ?? []).map(resolve),
    constraint: resolve(rule.constraint),
    message:
      rule.error_message || `Field \`${owner.key}\` failed a constraint rule`
  }));
}

function dateValue(value: string): number {
  // The Hub interprets timestamps without an offset as UTC.
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
  return Date.parse(naive.test(value) ? `${value}Z` : value);
}

const NONPRINTING = new RegExp('[\\p{C}\\p{Z}]', 'u');

/** Match the Hub's Python str/repr for JSON values used in comparisons. */
function hubString(value: unknown, nested = false): string {
  if (value == null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string') {
    if (!nested) return value;
    // Python prefers single quotes, switching when that avoids an escape.
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    const escaped = Array.from(value)
      .map((char) => {
        if (char === '\\' || char === quote) return `\\${char}`;
        if (char === '\n') return '\\n';
        if (char === '\r') return '\\r';
        if (char === '\t') return '\\t';
        if (char !== ' ' && NONPRINTING.test(char)) {
          const code = char.codePointAt(0) ?? 0;
          const prefix = code <= 255 ? 'x' : code <= 65535 ? 'u' : 'U';
          const width = code <= 255 ? 2 : code <= 65535 ? 4 : 8;
          return `\\${prefix}${code.toString(16).padStart(width, '0')}`;
        }
        return char;
      })
      .join('');
    return `${quote}${escaped}${quote}`;
  }
  if (Array.isArray(value))
    return `[${value.map((item) => hubString(item, true)).join(', ')}]`;
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${hubString(key, true)}: ${hubString(item, true)}`)
      .join(', ')}}`;
  return String(value);
}

function matches(
  condition: CellCondition,
  getValue: (key: string) => any
): boolean {
  const value = getValue(condition.fieldKey);
  const empty =
    value == null || value === '' || (Array.isArray(value) && !value.length);
  if (condition.comparator === 'is_filled') return !empty;
  if (condition.comparator === 'is_empty') return empty;
  if (value == null || value === '') return false;

  let actual: string | number | boolean = hubString(value);
  let expected: string | number | boolean = condition.value;
  if (condition.type === 'number') {
    actual =
      typeof value === 'boolean' ? Number(value) : Number(String(value).trim());
    expected = condition.value.trim() ? Number(condition.value) : NaN;
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  } else if (condition.type === 'date' || condition.type === 'datetime') {
    const text = String(value);
    actual = dateValue(condition.type === 'date' ? text.slice(0, 10) : text);
    expected = dateValue(condition.value);
    if (Number.isNaN(actual) || Number.isNaN(expected)) return false;
  } else if (condition.type === 'boolean') {
    const text = String(value).trim().toLowerCase();
    if (!['true', 'false', '1', '0', 'yes', 'no', 'y', 'n'].includes(text))
      return false;
    actual = ['true', '1', 'yes', 'y'].includes(text);
    expected = ['true', '1'].includes(condition.value.toLowerCase());
  }

  switch (condition.comparator) {
    case 'equal':
      return actual === expected;
    case 'not_equal':
      return actual !== expected;
    case 'greater_than':
      return actual > expected;
    case 'greater_than_or_equal':
      return actual >= expected;
    case 'less_than':
      return actual < expected;
    case 'less_than_or_equal':
      return actual <= expected;
    case 'contains':
      return String(actual)
        .toLowerCase()
        .includes(String(expected).toLowerCase());
    case 'not_contains':
      return !String(actual)
        .toLowerCase()
        .includes(String(expected).toLowerCase());
    case 'starts_with':
      return String(actual)
        .toLowerCase()
        .startsWith(String(expected).toLowerCase());
    case 'ends_with':
      return String(actual)
        .toLowerCase()
        .endsWith(String(expected).toLowerCase());
    default:
      return false;
  }
}

export function validateConstraints(
  constraints: CellConstraint[] | undefined,
  getValue: (key: string) => any
): string | null {
  const failed = constraints?.find(
    (rule) =>
      rule.constraint.comparator &&
      rule.when.every((condition) => matches(condition, getValue)) &&
      !matches(rule.constraint, getValue)
  );
  return failed?.message ?? null;
}
