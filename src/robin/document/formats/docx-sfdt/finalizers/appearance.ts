/**
 * Restripe (architecture 5.1a, conventions as container properties): when a change set adds,
 * removes or reorders rows of a banded table, the body rows take the banding the table had before,
 * by derived row role. Header and total rows keep their own look; a table with no detectable
 * banding is left alone. Banding detection and row roles are the moved `tableAppearance` and
 * `tableStructure` modules, unchanged.
 */
import type { Finalizer, FormatTable } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';
import { computeBindingState } from '../features/binding';
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

export const restripeFinalizer: Finalizer = {
  name: 'restripe',
  run(after, { before, formats }) {
    const beforeNative = computeBindingState(before.nf).native;
    const afterNative = computeBindingState(after).native;
    const ids: string[] = [];
    const tables: NfNode[] = [];
    const rec = (n: unknown) => {
      if (Array.isArray(n)) return n.forEach(rec);
      if (!isObject(n)) return;
      if (n.kind === KIND.table) tables.push(n as NfNode);
      for (const [k, v] of Object.entries(n))
        if (k !== 'binding' && k !== 'pending') rec(v);
    };
    rec(after.root);
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
    for (const table of tables) {
      const old = before.get(table.id);
      if (!old) continue;
      const rowsNow = arr<NfNode>(table.rows)
        .map((r) => r.id)
        .join(',');
      const rowsWas = arr<NfNode>(old.rows)
        .map((r) => r.id)
        .join(',');
      if (rowsNow === rowsWas) continue;
      const appearance = collectTableAppearance(
        nativeAt(beforeNative, pathOf(before, old.id))
      );
      const banding = appearance ? detectTableBanding(appearance) : null;
      if (!banding) continue;
      const block = nativeAt(afterNative, pathOf(working, table.id));
      if (!block) continue;
      // each fill as this table writes it, from a cell that has it
      const exemplars = new Map<string, unknown>();
      for (const r of arr<NfNode>(old.rows))
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
        const role = roles[i]?.role;
        if (i < banding.headerRows || role === 'aggregate' || role === 'header')
          return;
        const want = bandedShadingForRow(banding, i);
        if (want === undefined) return;
        for (const cell of arr<NfNode>(row.cells))
          if (setShading(cell, want, exemplars, formats)) ids.push(cell.id);
      });
    }
    return {
      ids,
      facts: ids.length
        ? [
            {
              kind: 'finalizer',
              name: 'restripe',
              ids,
              summary: `${ids.length} cell(s) restriped to the table's banding`
            }
          ]
        : []
    };
  }
};
