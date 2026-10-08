/**
 * Table geometry: in a table the change set touched, every row covers the same number of grid
 * columns (gridBefore + the cells' spans + gridAfter), as the derived grid requires; a table that
 * was already ragged is not held to it.
 */
import type { DocumentView, Invariant } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { refusal } from './common';

function covers(view: DocumentView, table: NfNode): number[] {
  const f = (ref: unknown) =>
    typeof ref === 'string' ? view.nf.formats[ref] ?? {} : {};
  return ((table.rows as NfNode[] | undefined) ?? []).map((row) => {
    const rf = f(row.style);
    const spans = ((row.cells as NfNode[] | undefined) ?? []).reduce(
      (n, c) => n + Number(f(c.style).columnSpan ?? 1),
      0
    );
    return Number(rf.gridBefore ?? 0) + spans + Number(rf.gridAfter ?? 0);
  });
}
const ragged = (c: number[]) => new Set(c).size > 1;

export const tableGeometry: Invariant = {
  name: 'table-geometry',
  cards: ['table'],
  check({ before, after, changed, created }) {
    const touched = new Set([...changed, ...created]);
    const bad: Array<{ id: string; columns: number[] }> = [];
    for (const table of after.nodes()) {
      if (table.kind !== KIND.table) continue;
      const inside =
        touched.has(table.id) ||
        ((table.rows as NfNode[] | undefined) ?? []).some(
          (r) =>
            touched.has(r.id) ||
            ((r.cells as NfNode[] | undefined) ?? []).some((c) =>
              touched.has(c.id)
            )
        );
      if (!inside) continue;
      const now = covers(after, table);
      const old = before.get(table.id);
      if (ragged(now) && !(old && ragged(covers(before, old))))
        bad.push({ id: table.id, columns: now });
    }
    if (!bad.length) return [];
    return [
      refusal(
        'table-geometry',
        `table(s) ${bad
          .map((b) => `${b.id} (rows cover ${b.columns.join(', ')} columns)`)
          .join('; ')} would have rows of different widths.`,
        bad,
        ['table'],
        'Give every row the same number of cells (counting spans): a new column needs a cell in every row, header and total rows included.'
      )
    ];
  }
};
