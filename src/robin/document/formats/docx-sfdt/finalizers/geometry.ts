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

/** The width a section's text runs between its margins, in points, or null when not set. */
function contentWidth(view: DocumentView, id: string): number | null {
  let p = view.placement(id);
  while (p?.parent) {
    // a table nested in a cell fits its cell, not the page: left as written
    if (p.parent.kind === KIND.cell) return null;
    if (p.parent.kind === KIND.section) {
      const f =
        typeof p.parent.style === 'string'
          ? view.nf.formats[p.parent.style] ?? {}
          : {};
      const width =
        Number(f.pageWidth) - Number(f.leftMargin) - Number(f.rightMargin);
      return Number.isFinite(width) && width > 0 ? width : null;
    }
    p = view.placement(p.parent.id);
  }
  return null;
}

/**
 * Column fit (QA-1): a column added to a table that fit between the margins would push it past
 * them, since every new cell brings its own width. The other columns narrow in proportion so each
 * row fits again, the new column keeping the width it was written with; each keeps its own unit
 * (an Auto cell takes the new column's). A reported fact; a table that did not fit before, or one
 * inside a cell, is left as written.
 */
export const columnFitFinalizer: Finalizer = {
  name: 'column-fit',
  run(after, { before, formats, residue }) {
    const ids: string[] = [];
    const tables: string[] = [];
    const now = after.formats as Formats;
    for (const table of tablesOf(after.root)) {
      const old = before.get(table.id);
      if (!old) continue;
      const grid = (
        residue[table.id] as { hidden?: { grid?: unknown } } | undefined
      )?.hidden?.grid;
      const total = Array.isArray(grid)
        ? grid.reduce((n: number, w) => n + (Number(w) || 0), 0)
        : 0;
      const room = contentWidth(before, table.id);
      if (!(total > 0) || room === null || total > room + 0.5) continue;
      const rows = arr<NfNode>(table.rows).filter((r) => before.get(r.id));
      const added = (row: NfNode) => {
        const had = new Set(
          arr<NfNode>(before.get(row.id)?.cells).map((c) => c.id)
        );
        return arr<NfNode>(row.cells).filter((c) => !had.has(c.id));
      };
      // a column: a new cell in every row the table kept
      if (!rows.length || rows.some((r) => !added(r).length)) continue;
      const points = (cell: NfNode): number => {
        const w = widthOf(now, cell);
        if (w.type === 'Percent') return (Number(w.width) / 100) * total;
        if (w.type === 'Point') return Number(w.width);
        return Number(hiddenIn(residue, cell.id, 'cellFormat', 'cellWidth'));
      };
      let changed = false;
      for (const row of rows) {
        const fresh = added(row);
        const freshIds = new Set(fresh.map((c) => c.id));
        const kept = arr<NfNode>(row.cells).filter((c) => !freshIds.has(c.id));
        const freshWidth = fresh.reduce((n, c) => n + points(c), 0);
        const keptWidth = kept.reduce((n, c) => n + points(c), 0);
        if (!Number.isFinite(freshWidth + keptWidth)) continue;
        if (freshWidth + keptWidth <= room + 0.5) continue;
        const factor = (room - freshWidth) / keptWidth;
        if (!(factor > 0)) continue;
        const freshUnit = widthOf(now, fresh[0]).type;
        for (const cell of kept) {
          const own = widthOf(now, cell).type;
          const unit =
            own !== 'Auto' ? own : freshUnit !== 'Auto' ? freshUnit : 'Point';
          const pts = points(cell) * factor;
          const width =
            unit === 'Percent'
              ? Math.round((pts / total) * 100 * 100) / 100
              : Math.round(pts * 100) / 100;
          cell.style = formats.intern({
            ...(typeof cell.style === 'string'
              ? formats.get(cell.style) ?? {}
              : {}),
            preferredWidth: width,
            preferredWidthType: unit
          });
          ids.push(cell.id);
        }
        changed = true;
      }
      if (changed) tables.push(table.id);
    }
    return {
      ids,
      facts: tables.length
        ? [
            {
              kind: 'finalizer',
              name: 'column-fit',
              ids,
              summary: `the other columns of ${tables
                .map((t) => `table ${t}`)
                .join(
                  ', '
                )} narrowed in proportion so the new column fits between the margins`
            }
          ]
        : []
    };
  }
};
