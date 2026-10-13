/**
 * Table geometry, reported and never refused (ruling 5): a row that covers fewer grid columns than
 * its neighbours is legal (gridBefore and gridAfter fill it, and the grid is derived), so a change
 * set that leaves a table it touched ragged, where it was even before, verifies with a fact and a
 * `table-ragged` warning the model can act on. It runs as the last finalizer and changes nothing.
 */
import type {
  DocumentView,
  Finalizer,
  FinalizerContext,
  Residue
} from '../../../pack';
import { NfNode, NormalForm, canonicalJson, listAt } from '../../../tree';
import { docxTree } from '../tree';
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

/** A cell's default side margins when neither it nor its table sets them, in points. */
const CELL_MARGIN = 5.4;

/**
 * The width a table is laid out into, in `nf`: the text width of its section at the top level,
 * or, inside a cell, that cell's point width less its side margins; null when unknown.
 */
function availableWidth(nf: NormalForm, id: string): number | null {
  const formats = nf.formats as Formats;
  const formatOf = (n: NfNode | null) =>
    n && typeof n.style === 'string' ? formats[n.style] ?? {} : {};
  let found: number | null | undefined;
  const rec = (
    n: NfNode,
    section: NfNode | null,
    cell: NfNode | null,
    table: NfNode | null
  ) => {
    if (found !== undefined) return;
    if (n.id === id) {
      if (cell) {
        const c = formatOf(cell);
        const t = formatOf(table);
        const width = Number(c.preferredWidth);
        const side = (k: 'leftMargin' | 'rightMargin') =>
          Number.isFinite(Number(c[k]))
            ? Number(c[k])
            : Number.isFinite(Number(t[k]))
            ? Number(t[k])
            : CELL_MARGIN;
        found =
          c.preferredWidthType === 'Point' && width > 0
            ? width - side('leftMargin') - side('rightMargin')
            : null;
      } else if (section) {
        const f = formatOf(section);
        const width =
          Number(f.pageWidth) - Number(f.leftMargin) - Number(f.rightMargin);
        found = Number.isFinite(width) && width > 0 ? width : null;
      } else found = null;
      return;
    }
    for (const key of docxTree.childLists(n))
      for (const c of arr<NfNode>(listAt(n, key)))
        rec(
          c,
          n.kind === KIND.section ? n : section,
          n.kind === KIND.cell ? n : cell,
          n.kind === KIND.table ? n : table
        );
  };
  rec(nf.root, null, null, null);
  return found ?? null;
}

/**
 * A new table written with no widths at all: every cell new (not moved, not a copy, which bring
 * the widths they were laid out at) and none with a preferred width. The editor would lay it out
 * on a zero grid, so its columns share equally the width the table has: its own point width, or a
 * percent of what it is laid out into (the text width, or its cell's width when nested), or all
 * of that.
 */
function shareNewTable(
  after: NormalForm,
  table: NfNode,
  formats: FinalizerContext['formats'],
  copies: Readonly<Record<string, string>>,
  before: DocumentView
): { ids: string[]; summary: string } | null {
  if (copies[table.id]) return null;
  const now = after.formats as Formats;
  const rows = arr<NfNode>(table.rows);
  const cells = rows.flatMap((r) => arr<NfNode>(r.cells));
  if (!cells.length || cells.some((c) => copies[c.id] || before.get(c.id)))
    return null;
  if (cells.some((c) => widthOf(now, c).width !== undefined)) return null;
  const available = availableWidth(after, table.id);
  const own = typeof table.style === 'string' ? now[table.style] ?? {} : {};
  const ownWidth = Number(own.preferredWidth);
  const room =
    own.preferredWidthType === 'Point' && ownWidth > 0
      ? available === null
        ? ownWidth
        : Math.min(available, ownWidth)
      : available === null
      ? null
      : own.preferredWidthType === 'Percent' && ownWidth > 0
      ? (available * Math.min(100, ownWidth)) / 100
      : available;
  if (room === null || !(room > 0)) return null;
  const spanOf = (c: NfNode) => {
    const f = typeof c.style === 'string' ? now[c.style] ?? {} : {};
    return Math.max(1, Number(f.columnSpan) || 1);
  };
  const columns = Math.max(
    ...rows.map((r) => arr<NfNode>(r.cells).reduce((n, c) => n + spanOf(c), 0))
  );
  if (!(columns > 0)) return null;
  const share = Math.round((room / columns) * 100) / 100;
  for (const cell of cells)
    cell.style = formats.intern({
      ...(typeof cell.style === 'string' ? formats.get(cell.style) ?? {} : {}),
      preferredWidth: Math.round(share * spanOf(cell) * 100) / 100,
      preferredWidthType: 'Point'
    });
  return {
    ids: cells.map((c) => c.id),
    summary: `table ${
      table.id
    } was written with no widths, so its ${columns} columns share the ${
      Math.round(room * 100) / 100
    } pt the table has equally, ${share} pt each`
  };
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
  run(after, { before, formats, residue, copies = {} }) {
    const ids: string[] = [];
    const tables: string[] = [];
    const fitted: string[] = [];
    const now = after.formats as Formats;
    const was = before.nf.formats as Formats;
    const round = (n: number) => Math.round(n * 100) / 100;
    for (const table of tablesOf(after.root)) {
      const old = before.get(table.id);
      if (!old) {
        const shared = shareNewTable(after, table, formats, copies, before);
        if (shared) {
          ids.push(...shared.ids);
          fitted.push(shared.summary);
        }
        continue;
      }
      const grid = (
        residue[table.id] as { hidden?: { grid?: unknown } } | undefined
      )?.hidden?.grid;
      const total = Array.isArray(grid)
        ? grid.reduce((n: number, w) => n + (Number(w) || 0), 0)
        : 0;
      // the width the editor lays the table into: the text width, or the table's own preferred
      // width when it sets one (a point width, or a percent of the text width), whichever is less
      // (measured, matrix-2 T2: a table of 468 pt in a 522 pt text width lays its cells out in 468)
      const text = contentWidth(before, table.id);
      const own = typeof table.style === 'string' ? now[table.style] ?? {} : {};
      const ownWidth = Number(own.preferredWidth);
      const room =
        text === null
          ? null
          : own.preferredWidthType === 'Point' && ownWidth > 0
          ? Math.min(text, ownWidth)
          : own.preferredWidthType === 'Percent' && ownWidth > 0
          ? Math.min(text, (text * ownWidth) / 100)
          : text;
      if (!(total > 0) || room === null) continue;
      const rows = arr<NfNode>(table.rows).filter((r) => before.get(r.id));
      const added = (row: NfNode) => {
        const had = new Set(
          arr<NfNode>(before.get(row.id)?.cells).map((c) => c.id)
        );
        return arr<NfNode>(row.cells).filter((c) => !had.has(c.id));
      };
      const points = (cell: NfNode): number => {
        const w = widthOf(now, cell);
        if (w.type === 'Percent') return (Number(w.width) / 100) * total;
        if (w.type === 'Point') return Number(w.width);
        return Number(hiddenIn(residue, cell.id, 'cellFormat', 'cellWidth'));
      };
      // a column: a new cell in every row the table kept
      if (!rows.length || rows.some((r) => !added(r).length)) {
        // widths set wider than the text: the editor would lay the row out narrower than asked,
        // so the row's point widths scale to fit and the fact says the widths that fit
        let scaled = false;
        for (const row of rows) {
          const cells = arr<NfNode>(row.cells);
          const set = cells.some((c) => {
            const b = before.get(c.id);
            return (
              b &&
              JSON.stringify(widthOf(was, b)) !==
                JSON.stringify(widthOf(now, c))
            );
          });
          if (!set) continue;
          const fixed = cells.filter((c) => widthOf(now, c).type === 'Point');
          const fixedWidth = fixed.reduce((n, c) => n + points(c), 0);
          const otherWidth = cells
            .filter((c) => !fixed.includes(c))
            .reduce((n, c) => n + points(c), 0);
          if (!Number.isFinite(fixedWidth + otherWidth) || !fixed.length)
            continue;
          if (fixedWidth + otherWidth <= room + 0.5) continue;
          const factor = (room - otherWidth) / fixedWidth;
          if (!(factor > 0)) continue;
          const asked = fixed.map((c) => round(points(c)));
          for (const cell of fixed) {
            cell.style = formats.intern({
              ...(typeof cell.style === 'string'
                ? formats.get(cell.style) ?? {}
                : {}),
              preferredWidth: round(points(cell) * factor),
              preferredWidthType: 'Point'
            });
            ids.push(cell.id);
          }
          if (!scaled)
            fitted.push(
              `table ${table.id}: asked ${asked.join(', ')} pt (${round(
                fixedWidth + otherWidth
              )} pt) is wider than the ${round(
                room
              )} pt the table has, so the columns are ${fixed
                .map((c) => points(c))
                .join(', ')} pt, in the same proportions`
            );
          scaled = true;
        }
        continue;
      }
      if (total > room + 0.5) continue;
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
    const summaries = [
      ...(tables.length
        ? [
            `the other columns of ${tables
              .map((t) => `table ${t}`)
              .join(
                ', '
              )} narrowed in proportion so the new column fits between the margins`
          ]
        : []),
      ...fitted
    ];
    return {
      ids,
      facts: summaries.length
        ? [
            {
              kind: 'finalizer',
              name: 'column-fit',
              ids,
              summary: summaries.join('; ')
            }
          ]
        : []
    };
  }
};
