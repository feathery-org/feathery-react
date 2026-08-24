// Inline validation errors are keyed ONLY by the real field key. Per-row errors
// for repeated fields live in a nested `byIndex` map rather than being encoded
// into the key string (e.g. `key-0`). This keeps the structure disjoint: a
// literal field named `foo-0` can never collide with row 0 of a repeated field
// `foo`, and repeat-row removal only ever touches a field's own `byIndex` map.
export interface InlineErrorEntry {
  // Field-wide error (non-repeat fields, or errors set without a row index).
  message?: string;
  // Per-repeat-row errors, keyed by repeat index.
  byIndex?: Record<number, { message: string }>;
}

export type InlineErrors = Record<string, InlineErrorEntry>;

// Message to display for a field at an optional repeat index. A repeated row
// uses its own `byIndex` entry, falling back to a field-wide `message`.
export function resolveInlineErrorMessage(
  entry: InlineErrorEntry | undefined,
  repeat?: number
): string | undefined {
  if (!entry) return undefined;
  if (Number.isInteger(repeat)) {
    return entry.byIndex?.[repeat as number]?.message ?? entry.message;
  }
  return entry.message;
}

// Whether an entry carries any non-empty message (field-wide or on any row).
export function inlineEntryHasMessage(
  entry: InlineErrorEntry | undefined
): boolean {
  if (!entry) return false;
  if (entry.message) return true;
  return Object.values(entry.byIndex ?? {}).some((d) => Boolean(d?.message));
}

// First non-empty message for a field, ignoring which row it's on. Used by
// surfaces that only care whether a field has an error, not per-row.
export function firstInlineErrorMessage(
  entry: InlineErrorEntry | undefined
): string | undefined {
  if (!entry) return undefined;
  if (entry.message) return entry.message;
  return Object.values(entry.byIndex ?? {}).find((d) => d?.message)?.message;
}

// Apply one (message, index) write to the map, mutating it in place.
// An empty message clears rather than stores:
//   - non-indexed empty write  -> clear the whole field (message + all rows)
//   - indexed empty write       -> clear only that row
// Entries left with no message and no rows are removed, so the aggregate
// "any error?" check and per-row display never see a stale/empty entry.
export function applyInlineError(
  inlineErrors: InlineErrors,
  fieldKey: string,
  message: string,
  index?: number | null
): void {
  if (!fieldKey) return;
  const existing = inlineErrors[fieldKey] ?? {};

  if (Number.isInteger(index)) {
    const byIndex = { ...(existing.byIndex ?? {}) };
    if (message) byIndex[index as number] = { message };
    else delete byIndex[index as number];

    const entry: InlineErrorEntry = {};
    if (existing.message) entry.message = existing.message;
    if (Object.keys(byIndex).length) entry.byIndex = byIndex;

    if (entry.message || entry.byIndex) inlineErrors[fieldKey] = entry;
    else delete inlineErrors[fieldKey];
  } else if (message) {
    inlineErrors[fieldKey] = { ...existing, message };
  } else {
    delete inlineErrors[fieldKey];
  }
}
