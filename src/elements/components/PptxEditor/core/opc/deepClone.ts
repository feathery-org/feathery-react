// Structural deep clone for the plain object/array trees the PPTX core works
// with (parsed OOXML ONode trees and JSON projections). Used instead of
// structuredClone so the core runs in older browsers and legacy test
// environments; unlike JSON round-tripping it keeps `undefined` properties.
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return out as T;
}
