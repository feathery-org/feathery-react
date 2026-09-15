/**
 * Row identity for field-backed tables.
 *
 * A field-backed table stores its data column by column — `fieldValues[key]` is
 * an array, one entry per row — so a row is nothing but a position, and a
 * position is not an identity: inserting above it moves it, sorting and
 * filtering show it somewhere else entirely. Anything that has to point at a
 * row and still be pointing at it later — an annotation, above all — needs a
 * name the row keeps.
 *
 * So the table mints one. Keys are opaque, unique to the table that minted
 * them, and never reused: a key that names a row that no longer exists
 * resolves to nothing, which is the honest answer.
 *
 * Data Hub tables need none of this — a hub row already has `localId` — so they
 * use that instead, and these helpers are for the field-backed case.
 */

/** Hands out a key no row of this table has held before. */
export type RowKeyMinter = () => string;

export function makeRowKeyMinter(tableId: string): RowKeyMinter {
  let counter = 0;
  return () => `${tableId}:r${counter++}`;
}

/**
 * Lines the keys up with the rows that actually exist.
 *
 * Rows appear and disappear without going through `insertRowKey` /
 * `removeRowKey` — a paste that runs past the last row, a rule writing a whole
 * column, a hub refetch — and there is no way to tell which row is which when
 * that happens. Reconciling from the end is the one assumption that leaves
 * every untouched row alone: grow by minting, shrink by dropping the tail.
 *
 * Idempotent, so it is safe to run on every render.
 */
export function reconcileRowKeys(
  keys: string[],
  rowCount: number,
  mint: RowKeyMinter
): string[] {
  if (keys.length === rowCount) return keys;
  if (keys.length > rowCount) return keys.slice(0, rowCount);
  const minted = Array.from({ length: rowCount - keys.length }, mint);
  return [...keys, ...minted];
}

/** A row was inserted at `rowIndex`; everything below it keeps its key. */
export function insertRowKey(
  keys: string[],
  rowIndex: number,
  mint: RowKeyMinter
): string[] {
  const at = Math.max(0, Math.min(rowIndex, keys.length));
  return [...keys.slice(0, at), mint(), ...keys.slice(at)];
}

/** A row was deleted; its key goes with it, and is never handed out again. */
export function removeRowKey(keys: string[], rowIndex: number): string[] {
  if (rowIndex < 0 || rowIndex >= keys.length) return keys;
  return keys.filter((_, index) => index !== rowIndex);
}
