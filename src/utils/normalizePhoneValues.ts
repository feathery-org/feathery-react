import { normalizePhoneNumber } from './phoneNumber';
import { phoneLib } from './validation';

/** Normalize known phone fields without changing hidden or unrelated values. */
export function normalizePhoneValues(
  values: Record<string, any>,
  servars: Map<string, any>,
  preserveCanonical = false,
  previousValues: Record<string, any> = {}
): Record<string, any> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const servar = servars.get(key);
      if (servar?.type !== 'phone_number') return [key, value];
      const previous = previousValues[key];
      const normalize = (entry: any) =>
        normalizePhoneNumber(
          entry,
          servar.metadata,
          phoneLib,
          preserveCanonical ||
            (Array.isArray(previous)
              ? previous.includes(entry)
              : previous === entry)
        );
      if (!Array.isArray(value)) return [key, normalize(value)];
      const normalized = value.map(normalize);
      // Keep the original array when nothing changed so callers comparing by
      // identity (e.g. the form's no-op update check) still see an unchanged value.
      const unchanged = normalized.every(
        (entry, index) => entry === value[index]
      );
      return [key, unchanged ? value : normalized];
    })
  );
}

export function phoneServarsFromSteps(steps: any): Map<string, any> {
  return new Map(
    Object.values(steps ?? {}).flatMap((step: any) =>
      (step.servar_fields ?? []).map((field: any) => [
        field.servar.key,
        field.servar
      ])
    )
  );
}

// Values written through setFieldValues before any schema (or the parser) could
// identify them. They are fresh input, but had to be stored raw; once a form
// arrives they are inferred with its country settings instead of being treated
// as saved canonical digits.
const pendingInference = new Map<string, any[]>();

// Keys that never appear in a loaded schema (e.g. hidden fields written by a
// host page on an interval) stay pending, so bound what is remembered per key.
const MAX_PENDING_ENTRIES_PER_KEY = 32;

export function markPendingPhoneInference(key: string, value: any) {
  pendingInference.set(
    key,
    [...(pendingInference.get(key) ?? []), value].slice(
      -MAX_PENDING_ENTRIES_PER_KEY
    )
  );
}

/**
 * Fresh-infer pending entries that are still in place in `values`, and return
 * only the keys that changed. Entries replaced since they were marked (e.g. by
 * session hydration) keep their current interpretation.
 */
export function applyPendingPhoneInference(
  values: Record<string, any>,
  servars: Map<string, any>
): Record<string, any> {
  const result: Record<string, any> = {};
  pendingInference.forEach((marked, key) => {
    const servar = servars.get(key);
    // Still unknown to any loaded form: keep waiting for its schema.
    if (!servar) return;
    pendingInference.delete(key);
    if (servar.type !== 'phone_number' || !(key in values)) return;
    const infer = (entry: any) =>
      marked.includes(entry)
        ? normalizePhoneNumber(entry, servar.metadata, phoneLib)
        : entry;
    const current = values[key];
    result[key] = Array.isArray(current) ? current.map(infer) : infer(current);
  });
  return result;
}
