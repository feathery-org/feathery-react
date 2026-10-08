/**
 * What a person counts on a review card that the tree holds apart: a cell added to (or removed
 * from) every row of a table is a column; several such cells per row, several columns. Cells that
 * do not form a column are counted as cells.
 */
import type { DocumentView } from '../../pack';
import type { NfNode } from '../../tree';
import { KIND } from './adapter/keys';
import { arr } from './util';

export function cardCollections(
  kind: string,
  ids: readonly string[],
  view: DocumentView
): Array<{
  key: string;
  noun: readonly [string, string];
  count: number;
  ids: string[];
}> {
  if (kind !== KIND.cell) return [];
  // cells by table, then per row
  const byTable = new Map<
    string,
    { table: NfNode; perRow: Map<string, string[]> }
  >();
  for (const id of ids) {
    const row = view.placement(id)?.parent;
    const table = row ? view.placement(row.id)?.parent : undefined;
    if (!row || !table || table.kind !== KIND.table) continue;
    const entry = byTable.get(table.id) ?? { table, perRow: new Map() };
    entry.perRow.set(row.id, [...(entry.perRow.get(row.id) ?? []), id]);
    byTable.set(table.id, entry);
  }
  const out: Array<{
    key: string;
    noun: readonly [string, string];
    count: number;
    ids: string[];
  }> = [];
  for (const { table, perRow } of byTable.values()) {
    const rows = arr<NfNode>(table.rows);
    const sizes = rows.map((r) => perRow.get(r.id)?.length ?? 0);
    if (!rows.length || sizes.some((n) => n !== sizes[0]) || !sizes[0])
      continue;
    out.push({
      key: 'column',
      noun: ['column', 'columns'],
      count: sizes[0],
      ids: [...perRow.values()].flat()
    });
  }
  return out;
}
