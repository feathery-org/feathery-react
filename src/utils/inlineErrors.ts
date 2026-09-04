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

// Rebuilds each owner's `byIndex` map under a row renumbering, dropping any row
// the mapping sends to null. Every repeat-row structural change is one of these
// renumberings, so they share the entry bookkeeping: an owner left with no
// message and no rows is deleted, so the aggregate "any error?" check never
// sees a stale empty entry.
//
// `ownerKeys` must cover EVERY element in the repeat container that can own a
// per-row error -- servar fields plus buttons and containers, which key
// submit/action failures by element id.
function remapInlineErrorRows(
  inlineErrors: InlineErrors,
  ownerKeys: Iterable<string>,
  remap: (index: number) => number | null
): InlineErrors {
  const next: InlineErrors = { ...inlineErrors };
  for (const key of new Set(ownerKeys)) {
    const existing = next[key];
    if (!existing?.byIndex) continue;
    const shifted: Record<number, { message: string }> = {};
    for (const [idxStr, data] of Object.entries(existing.byIndex)) {
      const to = remap(Number(idxStr));
      if (to === null) continue;
      shifted[to] = data;
    }
    const entry: InlineErrorEntry = {};
    if (existing.message) entry.message = existing.message;
    if (Object.keys(shifted).length) entry.byIndex = shifted;
    if (entry.message || entry.byIndex) next[key] = entry;
    else delete next[key];
  }
  return next;
}

// Move a repeat row: the moved row carries its own error to its new index, and
// the rows it passes shift one place the other way. Splice semantics, matching
// arrayMove, so `to` is the moved row's index in the result.
export function moveInlineErrorRows(
  inlineErrors: InlineErrors,
  ownerKeys: Iterable<string>,
  from: number,
  to: number
): InlineErrors {
  if (from === to) return inlineErrors;
  return remapInlineErrorRows(inlineErrors, ownerKeys, (idx) => {
    if (idx === from) return to;
    if (from < to) return idx > from && idx <= to ? idx - 1 : idx;
    return idx >= to && idx < from ? idx + 1 : idx;
  });
}

// Insert a repeat row: rows at or past the new position shift up one. The new
// row itself is untouched, so it starts with no error -- a row nobody has
// filled in yet must not inherit the error of the row it displaced.
export function insertInlineErrorRows(
  inlineErrors: InlineErrors,
  ownerKeys: Iterable<string>,
  at: number
): InlineErrors {
  return remapInlineErrorRows(inlineErrors, ownerKeys, (idx) =>
    idx >= at ? idx + 1 : idx
  );
}

// Remove a repeat row: drop each owner's error for that row and shift
// higher-indexed rows down, so remaining rows keep their own errors instead of
// inheriting a neighbour's. `ownerKeys` must cover EVERY element in the repeat
// container that can own a per-row error -- servar fields plus buttons and
// containers, which key submit/action failures by element id.
export function shiftInlineErrorRows(
  inlineErrors: InlineErrors,
  ownerKeys: Iterable<string>,
  removedIndex: number
): InlineErrors {
  return remapInlineErrorRows(inlineErrors, ownerKeys, (idx) => {
    if (idx === removedIndex) return null;
    return idx > removedIndex ? idx - 1 : idx;
  });
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
