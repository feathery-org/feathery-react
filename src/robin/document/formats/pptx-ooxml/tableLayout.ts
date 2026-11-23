import type { NfNode } from '../../tree';

/** Per row and column of the new table, the one it was read as (undefined when new) and the one whose look it has */
export interface TableLayout {
  rows: Array<number | undefined>;
  columns: Array<number | undefined>;
  rowLooks: number[];
  columnLooks: number[];
}

const listOf = (node: NfNode, key: string) =>
  (node[key] as NfNode[] | undefined) ?? [];

/** The old row or column each new one takes its look from: the one it copies, else its nearest neighbour as PowerPoint does */
function looksOf(
  kept: Array<number | undefined>,
  copied: Array<number | undefined>
): number[] {
  return kept.map((own, i) => {
    const nearest = [...kept.slice(0, i).reverse(), ...kept.slice(i + 1)].find(
      (index) => index !== undefined
    );
    return own ?? copied[i] ?? nearest ?? -1;
  });
}

/** Where each entry was read, a second copy of one counting as new */
function placements(
  ids: string[],
  wasAt: (id: string) => number,
  origin: (id: string) => string
): { kept: Array<number | undefined>; copied: Array<number | undefined> } {
  const copied = ids.map((id) => {
    const at = wasAt(origin(id));
    return at < 0 ? undefined : at;
  });
  const repeats = (at: number | undefined) =>
    copied.filter((other) => other === at).length > 1;
  // Of an entry and its copies, the one kept sits between the entries it was read between
  const inPlace = (i: number) => {
    const before = copied
      .slice(0, i)
      .filter((at) => at !== undefined && !repeats(at));
    const after = copied
      .slice(i + 1)
      .filter((at) => at !== undefined && !repeats(at));
    return (
      (before.at(-1) ?? -1) < (copied[i] as number) &&
      (after[0] ?? Infinity) > (copied[i] as number)
    );
  };
  const keeper = new Map<string, number>();
  ids.forEach((id, i) => {
    const from = origin(id);
    const held = keeper.get(from);
    const better =
      held === undefined ||
      (inPlace(i) && !inPlace(held)) ||
      (inPlace(i) === inPlace(held) && id === from && ids[held] !== from);
    if (better) keeper.set(from, i);
  });
  return {
    kept: copied.map((at, i) =>
      keeper.get(origin(ids[i])) === i ? at : undefined
    ),
    copied
  };
}

/** How a written table lines up with the table it was read as, or why it cannot */
export function tableLayout(
  old: NfNode,
  table: NfNode,
  origin: (id: string) => string
): TableLayout | string {
  const oldRows = listOf(old, 'rows');
  const rowPlacements = placements(
    listOf(table, 'rows').map((row) => row.id),
    (id) => oldRows.findIndex((was) => was.id === id),
    origin
  );
  const rows = rowPlacements.kept;
  const keptRows = rows.filter((r): r is number => r !== undefined);
  if (!keptRows.length)
    return 'keeps none of its rows: change the rows it has, or remove the whole table';
  if (keptRows.some((r, i) => i > 0 && r < keptRows[i - 1]))
    return 'reorders rows, which the editor cannot do: tell the person to move them by hand';

  let columnPlacements: ReturnType<typeof placements> | undefined;
  for (const [i, r] of rows.entries()) {
    if (r === undefined) continue;
    const oldCells = listOf(oldRows[r], 'cells');
    const placed = placements(
      listOf(listOf(table, 'rows')[i], 'cells').map((cell) => cell.id),
      (id) => oldCells.findIndex((was) => was.id === id),
      origin
    );
    if (columnPlacements === undefined) columnPlacements = placed;
    else if (JSON.stringify(placed) !== JSON.stringify(columnPlacements))
      return 'adds or removes cells in some rows only: a column is added or removed in every row';
  }
  const columns = columnPlacements?.kept ?? [];
  const keptColumns = columns.filter((c): c is number => c !== undefined);
  if (!keptColumns.length)
    return 'keeps none of its columns: change the columns it has, or remove the whole table';
  if (keptColumns.some((c, i) => i > 0 && c < keptColumns[i - 1]))
    return 'reorders columns, which the editor cannot do: tell the person to move them by hand';
  const width = columns.length;
  if (
    rows.some(
      (r, i) =>
        r === undefined &&
        listOf(listOf(table, 'rows')[i], 'cells').length !== width
    )
  )
    return `adds a row without one cell for each of its ${width} columns`;

  return {
    rows,
    columns,
    rowLooks: looksOf(rows, rowPlacements.copied),
    columnLooks: looksOf(columns, columnPlacements?.copied ?? [])
  };
}

/** The old cell a new cell takes its look from, the cell itself when it was read */
export function lookOf(
  old: NfNode,
  layout: TableLayout,
  row: number,
  column: number
): NfNode {
  const oldRow = listOf(old, 'rows')[layout.rowLooks[row]];
  return listOf(oldRow, 'cells')[layout.columnLooks[column]];
}
