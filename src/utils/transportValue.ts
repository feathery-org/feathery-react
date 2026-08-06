/**
 * Convert an arbitrary runtime value into JSON-shaped data that can safely
 * cross the assistant transport boundary.
 *
 * The stringify/parse round trip is intentional: browser/runtime objects such
 * as File and Promise may be structured-clone hostile even when their JSON
 * representation is tiny. Returning the original value would let the hostile
 * reference escape. Prompt bounding stays the server's job (it digests
 * oversized values with full-fidelity recall via queryOutput), so the cap here
 * is a coarse wire guard only.
 */
// Every request carries the whole message history, so one unbounded value can
// push later requests past the server's body limit and wedge the thread
const TRANSPORT_MAX_CHARS = 250_000;

const withinTransportLimit = (text: string): string =>
  text.length > TRANSPORT_MAX_CHARS
    ? `${text.slice(0, TRANSPORT_MAX_CHARS)}…[truncated]`
    : text;

export function sanitizeTransportValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return withinTransportLimit(value);

  const ancestors: Record<string, unknown>[] = [];
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, function (_key, current) {
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
        while (
          ancestors.length > 0 &&
          ancestors[ancestors.length - 1] !== this
        ) {
          ancestors.pop();
        }
        if (ancestors.includes(record))
          return { kind: 'circular', present: true };
        ancestors.push(record);
      }
      if (typeof current === 'bigint') return String(current);
      if (typeof current === 'function' || typeof current === 'symbol')
        return String(current);
      return current;
    });
  } catch {
    // Cyclic values, BigInts, and other non-JSON inputs still become a
    // primitive rather than escaping by reference.
    serialized = JSON.stringify(String(value));
  }
  if (serialized === undefined) serialized = JSON.stringify(String(value));

  // Over the cap the value crosses as truncated text: a clipped serialization
  // is not parseable, and the head still tells the model what it held
  if (serialized.length > TRANSPORT_MAX_CHARS)
    return withinTransportLimit(serialized);

  try {
    return JSON.parse(serialized);
  } catch {
    return serialized;
  }
}
