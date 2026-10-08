/**
 * Row identity (architecture 4.2, ported from the lab's deriveBindingRows): the model only says a
 * binding is row-scoped by writing `row`; the engine owns the value. In each table, a row that
 * keeps the row key of a row the document had keeps it; every other row with a key already used in
 * that table (a copy, or a row the model invented with a copied key) gets a fresh key, unique in
 * the document, with the prefix the table's rows already use.
 */
import type { Finalizer } from '../../../pack';
import type { NfNode, NormalForm } from '../../../tree';
import { KIND } from '../adapter/keys';
import { arr } from '../util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Bound controls in a row, not inside a nested table's rows. */
function rowControls(row: NfNode): NfNode[] {
  const out: NfNode[] = [];
  const rec = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(rec);
    if (!isObject(n)) return;
    if (n.kind === KIND.table) return;
    if (
      n.kind === KIND.control &&
      isObject(n.binding) &&
      typeof n.binding.row === 'string'
    )
      out.push(n as NfNode);
    for (const [k, v] of Object.entries(n))
      if (k !== 'binding' && k !== 'pending') rec(v);
  };
  rec(row.cells);
  return out;
}

const keyOf = (row: NfNode): string | null => {
  const keys = new Set(
    rowControls(row).map((c) => String((c.binding as Obj).row))
  );
  return keys.size === 1 ? [...keys][0] : null;
};

function tables(nf: NormalForm): NfNode[] {
  const out: NfNode[] = [];
  const rec = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(rec);
    if (!isObject(n)) return;
    if (n.kind === KIND.table) out.push(n as NfNode);
    for (const [k, v] of Object.entries(n))
      if (k !== 'binding' && k !== 'pending') rec(v);
  };
  rec(nf.root);
  return out;
}

export const rowIdentityFinalizer: Finalizer = {
  name: 'rows',
  run(after, { before }) {
    const used = new Set<string>();
    for (const t of tables(after))
      for (const r of arr<NfNode>(t.rows))
        for (const c of rowControls(r))
          used.add(String((c.binding as Obj).row));
    const ids: string[] = [];
    for (const table of tables(after)) {
      const seen = new Set<string>();
      const rows = arr<NfNode>(table.rows);
      // rows the document had keep their key first, then the rest in order
      const order = [
        ...rows.filter(
          (r) =>
            before.get(r.id) && keyOf(before.get(r.id) as NfNode) === keyOf(r)
        ),
        ...rows
      ];
      const handled = new Set<NfNode>();
      for (const row of order) {
        if (handled.has(row)) continue;
        handled.add(row);
        const key = keyOf(row);
        if (key === null) continue;
        if (!seen.has(key)) {
          seen.add(key);
          continue;
        }
        const prefix = key.replace(/-r\d+$/, '');
        let n = 1;
        for (const k of used) {
          const m = k.startsWith(`${prefix}-r`)
            ? /^\d+$/.exec(k.slice(prefix.length + 2))
            : null;
          if (m) n = Math.max(n, Number(m[0]) + 1);
        }
        const fresh = `${prefix}-r${n}`;
        used.add(fresh);
        seen.add(fresh);
        for (const c of rowControls(row)) {
          c.binding = { ...(c.binding as Obj), row: fresh };
          ids.push(c.id);
        }
      }
    }
    return {
      ids,
      facts: ids.length
        ? [
            {
              kind: 'finalizer',
              name: 'rows',
              ids,
              summary: `${ids.length} bound cell(s) given their own row identity`
            }
          ]
        : []
    };
  }
};

/**
 * Copied bookmarks: a bookmark name is unique in a document, so a copy of content that holds a
 * bookmark the document keeps elsewhere drops the copied start and end, as the editor's own paste
 * does. Bookmarks the document had, and new names, are left as they are.
 */
export const copiedBookmarksFinalizer: Finalizer = {
  name: 'bookmarks',
  run(after, { before }) {
    const kept = new Set<string>();
    for (const n of before.nodes())
      if (n.kind === KIND.bookmark && typeof n.name === 'string')
        kept.add(n.name);
    const dropped: string[] = [];
    const rec = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(rec);
      if (!isObject(n)) return;
      if (Array.isArray(n.inlines))
        n.inlines = (n.inlines as NfNode[]).filter((i) => {
          const copied =
            i.kind === KIND.bookmark &&
            typeof i.name === 'string' &&
            kept.has(i.name) &&
            !before.get(i.id);
          if (copied) dropped.push(String(i.name));
          return !copied;
        });
      for (const [k, v] of Object.entries(n))
        if (k !== 'binding' && k !== 'pending') rec(v);
    };
    rec(after.root);
    const names = [...new Set(dropped)];
    return {
      ids: [],
      facts: names.length
        ? [
            {
              kind: 'finalizer',
              name: 'bookmarks',
              ids: [],
              summary: `copied bookmark(s) ${names.join(
                ', '
              )} left out: a bookmark name is unique`
            }
          ]
        : []
    };
  }
};
