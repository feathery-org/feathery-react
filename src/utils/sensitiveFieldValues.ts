// Values an agent/host should never see in full, even read-only.
const MASKED_TYPES = new Set([
  'ssn',
  'password',
  'pin_input',
  'payment_method'
]);

// Never even partly shown: their last 4 characters are most of the secret
const SECRET_TYPES = new Set(['password', 'pin_input']);

export const maskFieldValue = (
  type: string | undefined,
  value: unknown
): unknown => {
  if (!type || !MASKED_TYPES.has(type)) return value;
  // A repeated field holds one value per row
  if (Array.isArray(value))
    return value.map((row) => maskFieldValue(type, row));
  if (value === null || value === undefined) return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (SECRET_TYPES.has(type)) return str ? '••••' : str;
  return str.length <= 4 ? '•'.repeat(str.length) : `••••${str.slice(-4)}`;
};

// What maskFieldValue returns, so a masked value is never written back as a real one
export const isMaskedValue = (value: unknown): boolean =>
  typeof value === 'string' && /^(•{1,4}|••••.{4})$/.test(value);

// Each field's type across every step, so its value can be masked wherever it shows
export const fieldTypesByKey = (steps: unknown): Map<string, string> => {
  const types = new Map<string, string>();
  Object.values((steps ?? {}) as Record<string, any>).forEach((step) =>
    (step?.servar_fields ?? []).forEach((field: any) => {
      if (field?.servar?.key) types.set(field.servar.key, field.servar.type);
    })
  );
  return types;
};

export const maskFieldValues = (
  values: Record<string, unknown>,
  types: Map<string, string>
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      maskFieldValue(types.get(key), value)
    ])
  );
