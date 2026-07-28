/**
 * Convert an arbitrary runtime value into bounded, JSON-shaped data that can
 * safely cross the assistant transport boundary.
 *
 * The stringify/parse round trip is intentional: browser/runtime objects such
 * as File and Promise may be structured-clone hostile even when their JSON
 * representation is tiny. Returning the original value after measuring that
 * representation would let the hostile reference escape.
 */
export function sanitizeTransportValue(
  value: unknown,
  maxChars: number
): { value: unknown; truncated: boolean } {
  if (value === null || value === undefined)
    return { value: null, truncated: false };
  if (typeof value === 'string') {
    return value.length > maxChars
      ? { value: value.slice(0, maxChars), truncated: true }
      : { value, truncated: false };
  }

  const seen =
    typeof WeakSet === 'function'
      ? new WeakSet<Record<string, unknown>>()
      : null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (_key, current) => {
      if (current && typeof current === 'object') {
        const record = current as Record<string, unknown>;
        const fileLike =
          (typeof File !== 'undefined' && current instanceof File) ||
          (typeof record.name === 'string' &&
            typeof record.size === 'number' &&
            typeof record.type === 'string' &&
            typeof (record as any).arrayBuffer === 'function');
        if (fileLike) {
          return {
            kind: 'file',
            present: true,
            ...(typeof record.name === 'string' ? { name: record.name } : {}),
            ...(typeof record.type === 'string' && record.type
              ? { type: record.type }
              : {}),
            ...(typeof record.size === 'number' ? { size: record.size } : {})
          };
        }
        if (typeof (record as any).then === 'function') {
          return { kind: 'promise', present: true };
        }
        if (seen?.has(record)) return { kind: 'circular', present: true };
        seen?.add(record);
      }
      if (typeof current === 'bigint') return String(current);
      if (typeof current === 'function' || typeof current === 'symbol')
        return String(current);
      return current;
    });
  } catch {
    // Cyclic values, BigInts, and other non-JSON inputs still become a bounded
    // primitive rather than escaping by reference.
    serialized = JSON.stringify(String(value));
  }
  if (serialized === undefined) serialized = JSON.stringify(String(value));

  if (serialized.length > maxChars) {
    return {
      value: `${serialized.slice(0, maxChars)}…`,
      truncated: true
    };
  }

  try {
    return { value: JSON.parse(serialized), truncated: false };
  } catch {
    return { value: serialized, truncated: false };
  }
}
