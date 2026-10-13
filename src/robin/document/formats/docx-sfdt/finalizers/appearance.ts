/**
 * Restripe (architecture 5.1a, conventions as container properties; the end-of-change-set
 * appearance the engine owns): when a change set adds, removes or reorders rows of a banded table,
 * or splits one, the body rows take the banding the table had before, by derived row role; when it
 * only adds cells, each new cell takes its row's look (its band's fill, its neighbour's borders).
 * Header and total rows keep their own look; a table with no detectable banding is left alone. Banding detection and row roles are the moved `tableAppearance` and
 * `tableStructure` modules, unchanged.
 */
import type { Finalizer, FormatTable } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { fromNormalForm } from '../adapter/fromNormalForm';
import { bindingState } from '../features/binding';
import {
  bandedShadingForRow,
  collectTableAppearance,
  detectTableBanding
} from '../tableAppearance';
import { deriveTableStructure } from '../tableStructure';
import { arr } from '../util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** The native block at the same position as a normal-form node. */
function nativeAt(native: unknown, path: Array<string | number>): Obj | null {
  let cur: unknown = native;
  for (const t of path)
    cur =
      isObject(cur) || Array.isArray(cur)
        ? (cur as Obj)[t as string]
        : undefined;
  return isObject(cur) ? cur : null;
}

/** Path tokens from the root to a node, by its placements. */
function pathOf(
  view: {
    placement(
      id: string
    ): { parent: NfNode | null; key: string | null; index: number } | undefined;
  },
  id: string
): Array<string | number> {
  const out: Array<string | number> = [];
  let p = view.placement(id);
  while (p && p.parent) {
    out.unshift(...(p.key as string).split('/'), p.index);
    p = view.placement(p.parent.id);
  }
  return out;
}

/**
 * A fill's key: the colour upper-cased, or `NONE` for no fill. The editor spells no fill two ways,
 * an absent colour and the literal `empty`, and they are the same fill.
 */
function fillKey(shading: unknown): string {
  const raw =
    isObject(shading) && typeof shading.backgroundColor === 'string'
      ? shading.backgroundColor.trim()
      : '';
  return !raw || raw.toLowerCase() === 'empty' ? 'NONE' : raw.toUpperCase();
}

/**
 * Give a cell the fill of its band. The shading object is copied whole from a cell of the same
 * table that already has that fill, so the cell carries exactly what the editor writes for it
 * (colour spelling, texture, foreground); only without an exemplar is the colour set alone.
 */
function setShading(
  cell: NfNode,
  want: string | null,
  exemplars: Map<string, unknown>,
  formats: FormatTable
): boolean {
  const ref = typeof cell.style === 'string' ? cell.style : undefined;
  const entry = { ...(ref ? formats.get(ref) ?? {} : {}) };
  const key = fillKey({ backgroundColor: want ?? '' });
  if (fillKey(entry.shading) === key) return false;
  const exemplar = exemplars.get(key);
  if (exemplars.has(key)) {
    if (exemplar === undefined) delete entry.shading;
    else entry.shading = JSON.parse(JSON.stringify(exemplar));
  } else {
    const shading = isObject(entry.shading) ? { ...entry.shading } : {};
    if (want) shading.backgroundColor = want;
    else delete shading.backgroundColor;
    if (Object.keys(shading).length) entry.shading = shading;
    else delete entry.shading;
  }
  cell.style = formats.intern(entry);
  return true;
}

/** A cell's format entry with `key` taken from `from` (or removed when `from` has none). */
function takeFrom(
  cell: NfNode,
  from: NfNode,
  key: string,
  formats: FormatTable
): boolean {
  const entry = {
    ...(typeof cell.style === 'string' ? formats.get(cell.style) ?? {} : {})
  };
  const source =
    typeof from.style === 'string' ? formats.get(from.style) ?? {} : {};
  if (JSON.stringify(entry[key]) === JSON.stringify(source[key])) return false;
  if (source[key] === undefined) delete entry[key];
  else entry[key] = JSON.parse(JSON.stringify(source[key]));
  cell.style = formats.intern(entry);
  return true;
}

export const restripeFinalizer: Finalizer = {
  name: 'restripe',
  run(after, { before, formats, copies = {} }) {
    const ids = new Set<string>();
    const rowIds = (t: NfNode) =>
      arr<NfNode>(t.rows)
        .map((r) => r.id)
        .join(',');
    /** The table a row sat in before (or the row it copies did), when it sat in one. */
    const tableOfRow = (rowId: string): NfNode | null => {
      const parent = before.placement(copies[rowId] ?? rowId)?.parent;
      return parent && parent.kind === KIND.table ? parent : null;
    };
    /**
     * Which tables restripe and from which table's banding: a table whose rows were added, removed
     * or reordered restripes whole; one that came out of a split (a new table holding rows of a
     * table before, moved or copied) restripes whole from that table's banding; one that only
     * gained cells gives each new cell its row's look.
     */
    const work: Array<{ table: NfNode; source: NfNode; whole: boolean }> = [];
    const rec = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(rec);
      if (!isObject(n)) return;
      if (n.kind === KIND.table) {
        const table = n as NfNode;
        const old = before.get(table.id);
        if (old) {
          if (rowIds(old) !== rowIds(table))
            work.push({ table, source: old, whole: true });
          else if (
            arr<NfNode>(table.rows).some(
              (r) =>
                arr<NfNode>(r.cells)
                  .map((c) => c.id)
                  .join(',') !==
                arr<NfNode>(before.get(r.id)?.cells)
                  .map((c) => c.id)
                  .join(',')
            )
          )
            work.push({ table, source: old, whole: false });
        } else {
          const counts = new Map<NfNode, number>();
          for (const r of arr<NfNode>(table.rows)) {
            const from = tableOfRow(r.id);
            if (from) counts.set(from, (counts.get(from) ?? 0) + 1);
          }
          const source = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
          if (source) work.push({ table, source: source[0], whole: true });
        }
      }
      for (const [k, v] of Object.entries(n))
        if (k !== 'binding' && k !== 'pending') rec(v);
    };
    rec(after.root);
    if (!work.length) return { ids: [], facts: [] };
    // the document before is a settled view, its binding state cached; the working copy is read
    // once, before any cell is restriped
    const beforeNative = bindingState(before.nf).native;
    // the working copy's native blocks only, for row roles: no binding engine pass needed
    const afterNative = JSON.parse(fromNormalForm(after, {}));
    // positions in the working document, for the native block of each table
    const index = new Map<
      string,
      { parent: NfNode | null; key: string | null; index: number }
    >();
    const walk = (
      n: NfNode,
      parent: NfNode | null,
      key: string | null,
      i: number
    ) => {
      index.set(n.id, { parent, key, index: i });
      for (const k of ['sections', 'blocks', 'rows', 'cells', 'inlines'])
        if (Array.isArray(n[k]))
          (n[k] as NfNode[]).forEach((c, j) => walk(c, n, k, j));
      if (isObject(n.headersFooters))
        for (const [story, s] of Object.entries(n.headersFooters))
          if (isObject(s) && Array.isArray(s.blocks))
            (s.blocks as NfNode[]).forEach((c, j) =>
              walk(c, n, `headersFooters/${story}/blocks`, j)
            );
      if (isObject(n.textFrame) && Array.isArray(n.textFrame.blocks))
        (n.textFrame.blocks as NfNode[]).forEach((c, j) =>
          walk(c, n, 'textFrame/blocks', j)
        );
    };
    walk(after.root, null, null, 0);
    const working = { placement: (id: string) => index.get(id) };
    for (const { table, source, whole } of work) {
      const appearance = collectTableAppearance(
        nativeAt(beforeNative, pathOf(before, source.id))
      );
      const banding = appearance ? detectTableBanding(appearance) : null;
      if (!banding) continue;
      const block = nativeAt(afterNative, pathOf(working, table.id));
      if (!block) continue;
      // each fill as this table writes it, from a cell that has it
      const exemplars = new Map<string, unknown>();
      for (const r of arr<NfNode>(source.rows))
        for (const c of arr<NfNode>(r.cells)) {
          const shading =
            typeof c.style === 'string'
              ? before.nf.formats[c.style]?.shading
              : undefined;
          const colour = fillKey(shading);
          if (!exemplars.has(colour)) exemplars.set(colour, shading);
        }
      const roles = deriveTableStructure({
        tableBlock: block,
        headerRows: banding.headerRows,
        tableId: null
      }).rows;
      arr<NfNode>(table.rows).forEach((row, i) => {
        const had = new Set(
          arr<NfNode>(before.get(row.id)?.cells).map((c) => c.id)
        );
        const cells = arr<NfNode>(row.cells);
        const fresh = cells.filter((c) => !had.has(c.id));
        // a new cell in a row that has others looks like its row: the nearest kept cell's fill
        // and borders (in a banded body row that fill is the row's band)
        if (had.size)
          for (const cell of fresh) {
            const at = cells.indexOf(cell);
            const kept =
              [...cells.slice(0, at)].reverse().find((c) => had.has(c.id)) ??
              cells.slice(at + 1).find((c) => had.has(c.id));
            if (!kept) continue;
            if (takeFrom(cell, kept, 'borders', formats)) ids.add(cell.id);
            if (takeFrom(cell, kept, 'shading', formats)) ids.add(cell.id);
          }
        if (!whole) return;
        const role = roles[i]?.role;
        if (i < banding.headerRows || role === 'aggregate' || role === 'header')
          return;
        const want = bandedShadingForRow(banding, i);
        if (want === undefined) return;
        for (const cell of cells)
          if (setShading(cell, want, exemplars, formats)) ids.add(cell.id);
      });
    }
    const changed = [...ids];
    return {
      ids: changed,
      facts: changed.length
        ? [
            {
              kind: 'finalizer',
              name: 'restripe',
              ids: changed,
              summary: `${changed.length} cell(s) restriped to the table's banding`
            }
          ]
        : []
    };
  }
};
