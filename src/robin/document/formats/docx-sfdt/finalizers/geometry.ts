/**
 * Table geometry, reported and never refused (ruling 5): a row that covers fewer grid columns than
 * its neighbours is legal (gridBefore and gridAfter fill it, and the grid is derived), so a change
 * set that leaves a table it touched ragged, where it was even before, verifies with a fact and a
 * `table-ragged` warning the model can act on. It runs as the last finalizer and changes nothing.
 */
import type { DocumentView, Finalizer, Residue } from '../../../pack';
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

/** A cell's width fields from its format entry; no type means Auto. */
const widthOf = (
  formats: Formats,
  cell: NfNode
): { type: string; width: unknown } => {
  const f = typeof cell.style === 'string' ? formats[cell.style] ?? {} : {};
  return {
    type:
      typeof f.preferredWidthType === 'string' ? f.preferredWidthType : 'Auto',
    width: f.preferredWidth
  };
};

/** A sub-key the adapter hid from a native format object, from the residue. */
function hiddenIn(
  residue: Residue,
  id: string,
  key: string,
  sub: string
): unknown {
  const record = residue[id] as
    | { hiddenIn?: Record<string, Array<{ k: string; v: unknown }>> }
    | undefined;
  return record?.hiddenIn?.[key]?.find((h) => h.k === sub)?.v;
}

/**
 * Width units (measured on the rig, QA-1): a row whose cells mix width units (a percent cell among
 * Auto cells) is rewritten by the editor on open, every cell to points, the written widths
 * discarded. So when a write gives cells of a row a width in one unit, the row's other cells take
 * their laid-out width (the editor's own layout, from the residue) in that unit, and the row keeps
 * one unit, exactly as written. A reported fact; changes no width a person sees.
 */
export const widthUnitsFinalizer: Finalizer = {
  name: 'width-units',
  run(after, { before, formats, residue }) {
    const ids: string[] = [];
    const now = after.formats as Formats;
    const was = before.nf.formats as Formats;
    for (const table of tablesOf(after.root)) {
      const old = before.get(table.id);
      if (!old) continue;
      const grid = (
        residue[table.id] as { hidden?: { grid?: unknown } } | undefined
      )?.hidden?.grid;
      const total = Array.isArray(grid)
        ? grid.reduce((n: number, w) => n + (Number(w) || 0), 0)
        : 0;
      for (const row of arr<NfNode>(table.rows)) {
        const cells = arr<NfNode>(row.cells);
        // the cells this write gave a width: their unit becomes the row's one unit
        const written = cells.filter((c) => {
          const b = before.get(c.id);
          return (
            !b ||
            JSON.stringify(widthOf(was, b)) !== JSON.stringify(widthOf(now, c))
          );
        });
        const units = new Set(
          written.map((c) => widthOf(now, c).type).filter((t) => t !== 'Auto')
        );
        if (units.size !== 1) continue;
        const unit = [...units][0];
        if (unit !== 'Percent' && unit !== 'Point') continue;
        for (const cell of cells) {
          if (widthOf(now, cell).type === unit || !before.get(cell.id))
            continue;
          const laid = Number(
            hiddenIn(residue, cell.id, 'cellFormat', 'cellWidth')
          );
          if (!Number.isFinite(laid) || laid <= 0) continue;
          if (unit === 'Percent' && !(total > 0)) continue;
          const width = unit === 'Percent' ? (laid / total) * 100 : laid;
          const entry = {
            ...(typeof cell.style === 'string'
              ? formats.get(cell.style) ?? {}
              : {}),
            preferredWidth: width,
            preferredWidthType: unit
          };
          cell.style = formats.intern(entry);
          ids.push(cell.id);
        }
      }
    }
    return {
      ids,
      facts: ids.length
        ? [
            {
              kind: 'finalizer',
              name: 'width-units',
              ids,
              summary: `${ids.length} cell(s) given their laid-out width in their row's unit, so the editor keeps the widths as written`
            }
          ]
        : []
    };
  }
};
