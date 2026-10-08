/**
 * Read before write, compare-and-swap on content (contract 2.2 and 6.3, architecture 5.2).
 *
 * Every hash a change carries is compared with the live document the write is applied to: a
 * node's `base`, the `container` of the list a node is placed in, a format entry's `base`, and the
 * acknowledged counts of a bulk `set` (`total`) and a format-entry `set` (`referrers`). A mismatch
 * means the user changed what the plan was based on: a conflict carrying the live state, never a
 * refusal.
 */
import type {
  Change,
  ConflictResult,
  FindInput,
  WriteInput
} from '../envelope';
import { isNodeId } from '../envelope';
import type { DocumentView, Pack } from '../pack';
import { baseOf, isPlainObject, NfNode, withoutLists } from '../tree';
import { emitNode, matchQuery, referencedFormats } from '../view';

export type Conflict = ConflictResult['conflict'];

/** Nodes whose own fields reference a format entry. */
export function referrersOf(
  view: DocumentView,
  pack: Pack,
  formatId: string
): string[] {
  return view
    .nodes()
    .filter((node) => {
      return referencedFormats(pack, withoutLists(node, pack.tree)).has(
        formatId
      );
    })
    .map((n) => n.id);
}

/** The query of a bulk target as `find` evaluates it (`limit` does not apply). */
export function bulkQuery(find: FindInput): FindInput {
  const query = { ...find };
  delete query.limit;
  return query;
}

export function checkBases(
  view: DocumentView,
  pack: Pack,
  write: WriteInput,
  outlineHash: string
): Conflict | null {
  const stale = new Map<string, Conflict['stale'][number]>();
  const bulk: Conflict['bulk'] = [];
  const formats: Conflict['formats'] = [];
  const live = (node: NfNode) => emitNode(view, pack, node);
  const compare = (id: string, carried: string | undefined) => {
    if (!isNodeId(id) || carried === undefined || stale.has(id)) return;
    const node = view.get(id);
    if (!node) return; // an unknown id is a refusal, decided before this check
    if (baseOf(node) !== carried)
      stale.set(id, { id, base: carried, live: live(node) });
  };
  const compareContainer = (anchor: string, carried: string | undefined) => {
    if (!isNodeId(anchor) || carried === undefined) return;
    const parent = view.placement(anchor)?.parent;
    if (!parent || stale.has(parent.id)) return;
    if (baseOf(parent) !== carried)
      stale.set(parent.id, {
        id: parent.id,
        base: carried,
        live: live(parent)
      });
  };
  const check = (change: Change) => {
    switch (change.kind) {
      case 'replace':
      case 'delete':
        compare(change.id, change.base);
        return;
      case 'insert_before':
      case 'insert_after':
        compareContainer(change.anchor, change.container);
        return;
      case 'move':
        compare(change.id, change.base);
        compareContainer(change.anchor, change.container);
        return;
      case 'set': {
        const t = change.target;
        if ('ids' in t) for (const id of t.ids) compare(id, t.base[id]);
        else if ('match' in t) compare(t.id, t.base);
        else if ('find' in t) {
          const count = matchQuery(view, pack, bulkQuery(t.find)).length;
          if (count !== t.total)
            bulk.push({ find: t.find, total: t.total, live: count });
        } else {
          const entry = view.nf.formats[t.formatId];
          if (!entry) return; // unknown format: a refusal, decided before this check
          const count = referrersOf(view, pack, t.formatId).length;
          const liveBase = baseOf(entry);
          if (count !== t.referrers || liveBase !== t.base)
            formats.push({
              id: t.formatId,
              referrers: t.referrers,
              live: count,
              ...(liveBase !== t.base
                ? { base: t.base, liveEntry: { ...entry, base: liveBase } }
                : {})
            });
        }
      }
    }
  };
  write.changes.forEach(check);
  if (!stale.size && !bulk.length && !formats.length) return null;
  return { stale: [...stale.values()], bulk, formats, outlineHash };
}

/** A one-line message for a conflict result. */
export function conflictMessage(conflict: Conflict): string {
  const parts: string[] = [];
  if (conflict.stale.length)
    parts.push(`${conflict.stale.length} node(s) changed since they were read`);
  if (conflict.bulk.length)
    parts.push(
      conflict.bulk
        .map(
          (b) => `a bulk target now matches ${b.live} node(s), not ${b.total}`
        )
        .join('; ')
    );
  if (conflict.formats.length)
    parts.push(
      conflict.formats
        .map((f) =>
          isPlainObject(f) && 'liveEntry' in f
            ? `format ${f.id} changed since it was read`
            : `format ${f.id} now has ${f.live} referrer(s), not ${f.referrers}`
        )
        .join('; ')
    );
  return `${parts.join('; ')}.`;
}
