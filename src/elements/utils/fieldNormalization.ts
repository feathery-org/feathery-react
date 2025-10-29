export type WarnType = 'option' | 'value';

export type WarningArgs = {
  state: Set<string>;
  type: WarnType;
  field: string;
  reason: string;
  context: string;
  payload: unknown;
  entityLabel?: string;
};

export const normalizeToString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
};

export const warnInvalidData = ({
  state,
  type,
  field,
  reason,
  context,
  payload,
  entityLabel = 'Field'
}: WarningArgs) => {
  const signature = `${type}|${field}|${reason}|${context}`;
  if (state.has(signature)) return;
  state.add(signature);

  const label = type === 'option' ? 'option entry' : 'selected value';
  console.warn(
    `[Feathery] ${entityLabel} "${field}" skipped invalid ${label} (${reason}) at ${context}.`,
    payload
  );
};
