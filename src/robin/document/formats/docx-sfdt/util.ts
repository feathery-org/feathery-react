import type { NormalForm } from '../../tree';

/**
 * An array value, or an empty one. Used instead of `(x as T[]) ?? []` in loops: the product's
 * babel for-of transform infers the iterable's type, and a TypeScript cast beside an inferred
 * array literal makes that inference throw at build time.
 */
export const arr = <T>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

/** A format entry read whole: a hoisted reference resolved, an inline object as it is. */
export const entryOf = (
  nf: NormalForm,
  ref: unknown
): Record<string, unknown> | null =>
  typeof ref === 'string'
    ? (nf.formats[ref] as Record<string, unknown> | undefined) ?? null
    : ref !== null && typeof ref === 'object' && !Array.isArray(ref)
    ? (ref as Record<string, unknown>)
    : null;
