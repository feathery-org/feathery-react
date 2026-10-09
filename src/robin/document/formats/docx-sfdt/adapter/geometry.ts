/**
 * Table geometry the model never states twice: `grid` and `columnCount` are derived from the
 * cells' preferred widths and spans, and each cell's `columnIndex` from its position. A table whose
 * cell geometry is unchanged keeps its original grid byte for byte.
 */
type Obj = Record<string, unknown>;
const fmt = (n: Obj | undefined, key: string): Obj => (n?.[key] as Obj) ?? {};
const rowsOf = (table: Obj): Obj[] =>
  Array.isArray(table.rows) ? (table.rows as Obj[]) : [];
const cellsOf = (row: Obj): Obj[] =>
  Array.isArray(row.cells) ? (row.cells as Obj[]) : [];
const span = (cell: Obj) => Number(fmt(cell, 'cellFormat').columnSpan ?? 1);

/** The cell geometry `grid` and `columnCount` derive from. */
export function geometrySignature(table: Obj): string {
  return JSON.stringify(
    rowsOf(table).map((row) => [
      fmt(row, 'rowFormat').gridBefore ?? 0,
      cellsOf(row).map((c) => [
        fmt(c, 'cellFormat').columnSpan ?? 1,
        fmt(c, 'cellFormat').preferredWidth ?? null
      ]),
      fmt(row, 'rowFormat').gridAfter ?? 0
    ])
  );
}

const cover = (row: Obj) =>
  Number(fmt(row, 'rowFormat').gridBefore ?? 0) +
  cellsOf(row).reduce((n, c) => n + span(c), 0) +
  Number(fmt(row, 'rowFormat').gridAfter ?? 0);

/** The widest row's covered grid columns. */
export function derivedColumnCount(table: Obj): number {
  return rowsOf(table).reduce((m, row) => Math.max(m, cover(row)), 0);
}

/** Grid widths from the widest row; a spanned cell's width is split evenly across its columns. */
export function derivedGrid(table: Obj): number[] {
  const count = derivedColumnCount(table);
  const grid = new Array(count).fill(0);
  let best: Obj | null = null;
  for (const row of rowsOf(table))
    if (!best || cover(row) > cover(best)) best = row;
  if (!best) return grid;
  let at = Number(fmt(best, 'rowFormat').gridBefore ?? 0);
  for (const cell of cellsOf(best)) {
    const s = span(cell);
    const width = Number(fmt(cell, 'cellFormat').preferredWidth) || 0;
    for (let k = 0; k < s && at < count; k += 1, at += 1) grid[at] = width / s;
  }
  return grid;
}

/** Each cell's column index, from gridBefore and the spans before it. */
export function columnIndices(row: Obj): number[] {
  let at = Number(fmt(row, 'rowFormat').gridBefore ?? 0);
  return cellsOf(row).map((cell) => {
    const here = at;
    at += span(cell);
    return here;
  });
}
