/**
 * Table geometry, reported and never refused (ruling 5): a row that covers fewer grid columns than
 * its neighbours is legal (gridBefore and gridAfter fill it, and the grid is derived), so a change
 * set that leaves a table it touched ragged, where it was even before, verifies with a fact and a
 * `table-ragged` warning the model can act on. It runs as the last finalizer and changes nothing.
 */
import type { DocumentView, Finalizer } from '../../../pack';
import { NfNode, canonicalJson } from '../../../tree';
import { KIND } from '../adapter/keys';
import { arr } from '../util';

type Formats = Record<string, Record<string, unknown>>;

function covers(formats: Formats, table: NfNode): number[] {
  const f = (ref: unknown) =>
    typeof ref === 'string' ? formats[ref] ?? {} : {};
  return arr<NfNode>(table.rows).map((row) => {
    const rf = f(row.style);
    const spans = arr<NfNode>(row.cells).reduce(
      (n, c) => n + Number(f(c.style).columnSpan ?? 1),
      0
    );
    return Number(rf.gridBefore ?? 0) + spans + Number(rf.gridAfter ?? 0);
  });
}
const ragged = (c: number[]) => new Set(c).size > 1;

/** Every table in a document, by id. */
function tablesOf(root: NfNode): NfNode[] {
  const out: NfNode[] = [];
  const rec = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(rec);
    if (!n || typeof n !== 'object') return;
    if ((n as NfNode).kind === KIND.table) out.push(n as NfNode);
    for (const [k, v] of Object.entries(n))
      if (k !== 'binding' && k !== 'pending') rec(v);
  };
  rec(root);
  return out;
}

export const tableGeometryReport: Finalizer = {
  name: 'table-geometry',
  run(after, { before }: { before: DocumentView }) {
    const reports: Array<{ id: string; columns: number[] }> = [];
    for (const table of tablesOf(after.root)) {
      const now = covers(after.formats as Formats, table);
      if (!ragged(now)) continue;
      const old = before.get(table.id);
      if (old && canonicalJson(old) === canonicalJson(table)) continue;
      if (old && ragged(covers(before.nf.formats as Formats, old))) continue;
      reports.push({ id: table.id, columns: now });
    }
    if (!reports.length) return { ids: [] };
    const summary = reports
      .map((r) => `table ${r.id}: rows cover ${r.columns.join(', ')} columns`)
      .join('; ');
    return {
      ids: [],
      facts: [
        {
          kind: 'finalizer',
          name: 'table-geometry',
          ids: reports.map((r) => r.id),
          summary
        }
      ],
      warnings: [
        {
          code: 'table-ragged',
          message: `Rows now have different widths (${summary}). That is legal; if every row should span the full table, give each the same number of cells, counting spans.`
        }
      ]
    };
  }
};
