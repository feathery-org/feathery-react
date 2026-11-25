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

/** The old index nearest before each new entry, else after it, as PowerPoint copies the row or column beside a new one */
function looksOf(kept: Array<number | undefined>): number[] {
  return kept.map((own, i) => {
    const nearest = [...kept.slice(0, i).reverse(), ...kept.slice(i + 1)].find(
      (index) => index !== undefined
    );
    return own ?? nearest ?? -1;
  });
}

const COPIED =
  'copies a row or cell by its ids, which the editor cannot do: write a new row or column without ids, it takes the look of the one beside it, then set its text and formatting';

/** How a written table lines up with the table it was read as, or why it cannot */
export function tableLayout(
  old: NfNode,
  table: NfNode,
  origin: (id: string) => string,
  wasRead: (id: string) => boolean
): TableLayout | string {
  // A table copied with its slide holds copies of the rows it was read with, each once
  const copiedTable = origin(table.id) !== table.id;
  const indexIn = (list: NfNode[], id: string) =>
    list.findIndex((was) => was.id === (copiedTable ? origin(id) : id));
  const isCopy = (list: NfNode[], id: string, ids: string[]) =>
    copiedTable
      ? ids.filter((other) => origin(other) === origin(id)).length > 1 ||
        (wasRead(origin(id)) && indexIn(list, id) < 0)
      : origin(id) !== id || (wasRead(id) && indexIn(list, id) < 0);
  const placed = (list: NfNode[], ids: string[]) =>
    ids.map((id) => {
      const at = indexIn(list, id);
      return at < 0 ? undefined : at;
    });

  const oldRows = listOf(old, 'rows');
  const written = listOf(table, 'rows');
  const rowIds = written.map((row) => row.id);
  if (rowIds.some((id) => isCopy(oldRows, id, rowIds))) return COPIED;
  const rows = placed(
    oldRows,
    written.map((row) => row.id)
  );
  const keptRows = rows.filter((r): r is number => r !== undefined);
  if (!keptRows.length)
    return 'keeps none of its rows: change the rows it has, or remove the whole table';
  if (keptRows.some((r, i) => i > 0 && r < keptRows[i - 1]))
    return 'reorders rows, which the editor cannot do: tell the person to move them by hand';

  const allCellIds = written.flatMap((row) =>
    listOf(row, 'cells').map((cell) => cell.id)
  );
  let columns: Array<number | undefined> | undefined;
  for (const [i, r] of rows.entries()) {
    const cells = listOf(written[i], 'cells');
    const oldCells = r === undefined ? [] : listOf(oldRows[r], 'cells');
    if (cells.some((cell) => isCopy(oldCells, cell.id, allCellIds)))
      return COPIED;
    if (r === undefined) continue;
    const here = placed(
      oldCells,
      cells.map((cell) => cell.id)
    );
    if (columns === undefined) columns = here;
    else if (JSON.stringify(here) !== JSON.stringify(columns))
      return 'adds or removes cells in some rows only: a column is added or removed in every row';
  }
  const keptColumns = (columns ?? []).filter(
    (c): c is number => c !== undefined
  );
  if (!keptColumns.length)
    return 'keeps none of its columns: change the columns it has, or remove the whole table';
  if (keptColumns.some((c, i) => i > 0 && c < keptColumns[i - 1]))
    return 'reorders columns, which the editor cannot do: tell the person to move them by hand';
  const width = (columns ?? []).length;
  if (
    rows.some(
      (r, i) => r === undefined && listOf(written[i], 'cells').length !== width
    )
  )
    return `adds a row without one cell for each of its ${width} columns`;

  return {
    rows,
    columns: columns ?? [],
    rowLooks: looksOf(rows),
    columnLooks: looksOf(columns ?? [])
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
