// Shared fixtures for the number-bound specs, which span src/utils and
// src/elements/fields. Pure data, so no jest mocks belong here.

export const ref = (fieldKey: string) => ({
  field_type: 'servar' as const,
  field_id: `${fieldKey}-id`,
  field_key: fieldKey
});

export const condition = (
  fieldKey: string,
  comparison: any,
  values: any[]
) => ({
  ...ref(fieldKey),
  comparison,
  values
});

// A rule keyed off a "range" dropdown, the motivating bracket case.
export const rangeRule = (value: string, min: any, max: any) => ({
  id: value,
  conditions: [condition('range', 'equal', [value])],
  min,
  max
});
