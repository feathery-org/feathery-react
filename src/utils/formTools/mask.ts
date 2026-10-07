// Values an agent/host should never see in full, even read-only.
const MASKED_TYPES = new Set([
  'ssn',
  'password',
  'pin_input',
  'payment_method'
]);

export const maskFieldValue = (type: string, value: unknown): unknown => {
  if (!MASKED_TYPES.has(type) || value === null || value === undefined)
    return value;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return `••••${str.slice(-4)}`;
};
