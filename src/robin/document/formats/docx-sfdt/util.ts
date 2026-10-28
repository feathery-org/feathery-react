/**
 * An array value, or an empty one. Used instead of `(x as T[]) ?? []` in loops: the product's
 * babel for-of transform infers the iterable's type, and a TypeScript cast beside an inferred
 * array literal makes that inference throw at build time.
 */
export const arr = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];
