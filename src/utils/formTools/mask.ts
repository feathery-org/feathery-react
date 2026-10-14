// Values an agent/host should never see in full, even read-only.
const MASKED_TYPES = new Set([
  'ssn',
  'password',
  'pin_input',
  'payment_method'
]);

// Never even partly shown: their last 4 characters are most of the secret
const SECRET_TYPES = new Set(['password', 'pin_input']);

export const maskFieldValue = (type: string, value: unknown): unknown => {
  if (!MASKED_TYPES.has(type) || value === null || value === undefined)
    return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (SECRET_TYPES.has(type)) return str ? '••••' : str;
  return str.length <= 4 ? '•'.repeat(str.length) : `••••${str.slice(-4)}`;
};
