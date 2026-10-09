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
  RefusalProblem,
  ConflictResult,
  FindInput,
  WriteInput
} from '../envelope';
import { isNodeId } from '../envelope';
import type { DocumentView, Pack } from '../pack';
import { baseOf, NfNode, shapeOf, withoutLists } from '../tree';
import { emitNode, matchQuery, referencedFormats } from '../view';
import { problem } from './index';

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
  /** Compare a carried `base` (whole subtree) or `shape` (own fields and child ids). */
  const compare = (
    id: string,
    axis: 'base' | 'shape',
    carried: string | undefined
  ) => {
    if (!isNodeId(id) || carried === undefined || stale.has(id)) return;
    const node = view.get(id);
    if (!node) return; // an unknown id is a refusal, decided before this check
    const now = axis === 'base' ? baseOf(node) : shapeOf(node, pack.tree);
    if (now !== carried)
      stale.set(id, {
        id,
        [axis]: carried,
        live: live(node)
      } as Conflict['stale'][number]);
  };
  /** `container` is the shape of the node that owns the anchor's list. */
  const compareContainer = (anchor: string, carried: string | undefined) => {
    if (!isNodeId(anchor)) return;
    const parent = view.placement(anchor)?.parent;
    if (parent) compare(parent.id, 'shape', carried);
  };
  const check = (change: Change) => {
    switch (change.kind) {
      case 'replace':
      case 'delete':
        compare(change.id, 'base', change.base);
        return;
      case 'insert_before':
      case 'insert_after':
        compareContainer(change.anchor, change.container);
        return;
      case 'move':
        compare(change.id, 'shape', change.shape);
        compareContainer(change.anchor, change.container);
        return;
      case 'set': {
        const t = change.target;
        if ('ids' in t)
          for (const id of t.ids) compare(id, 'shape', t.shape[id]);
        else if ('match' in t) compare(t.id, 'shape', t.shape);
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
              base: t.base,
              referrers: t.referrers,
              live: count,
              liveBase,
              liveEntry: { base: liveBase, ...entry }
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
  for (const f of conflict.formats)
    parts.push(
      f.liveBase !== f.base
        ? `format ${f.id} changed since it was read`
        : `format ${f.id} now has ${f.live} referrer(s), not ${f.referrers}`
    );
  return `${parts.join('; ')}.`;
}

/**
 * A hash in the wrong field: a change that carries a node's `base` where its `shape` is asked for,
 * or the reverse. It is the model's slip, not the user's edit, so it is an envelope refusal that
 * names the right field rather than a conflict. Nodes whose two hashes coincide (no children) are
 * never misplaced.
 */
export function misplacedHashes(
  view: DocumentView,
  pack: Pack,
  write: WriteInput
): RefusalProblem[] {
  const problems: RefusalProblem[] = [];
  const check = (
    at: string,
    id: string | undefined,
    wanted: 'base' | 'shape',
    carried: string | undefined,
    role: string
  ) => {
    if (!id || !isNodeId(id) || carried === undefined) return;
    const node = view.get(id);
    if (!node) return;
    const base = baseOf(node);
    const shape = shapeOf(node, pack.tree);
    if (base === shape) return;
    const other = wanted === 'base' ? shape : base;
    const right = wanted === 'base' ? base : shape;
    if (carried !== other || carried === right) return;
    problems.push(
      problem(
        'envelope',
        `Nothing was applied: ${at} carries the ${
          wanted === 'base' ? 'shape' : 'base'
        } of ${id}; ${role}.`,
        {
          detail: [{ at, id, wanted }],
          hint: `Copy \`${wanted}\` from the read of ${id} into ${at
            .split('.')
            .pop()}: a change that rewrites or removes a whole subtree carries its base; one that places, moves or sets on a node carries the shape (the parent's shape as container).`
        }
      )
    );
  };
  const parentOf = (anchor: string) =>
    isNodeId(anchor) ? view.placement(anchor)?.parent?.id : undefined;
  write.changes.forEach((change, i) => {
    const at = `changes[${i}]`;
    switch (change.kind) {
      case 'replace':
      case 'delete':
        check(
          `${at}.base`,
          change.id,
          'base',
          change.base,
          `${change.kind} carries the base of the node it ${
            change.kind === 'delete' ? 'removes' : 'rewrites'
          }`
        );
        return;
      case 'insert_before':
      case 'insert_after':
        check(
          `${at}.container`,
          parentOf(change.anchor),
          'shape',
          change.container,
          "container is the shape of the node that owns the anchor's list"
        );
        return;
      case 'move':
        check(
          `${at}.shape`,
          change.id,
          'shape',
          change.shape,
          'a move carries the shape of the node it moves'
        );
        check(
          `${at}.container`,
          parentOf(change.anchor),
          'shape',
          change.container,
          "container is the shape of the node that owns the anchor's list"
        );
        return;
      case 'set': {
        const t = change.target;
        if ('ids' in t)
          for (const id of t.ids)
            check(
              `${at}.target.shape.${id}`,
              id,
              'shape',
              t.shape[id],
              'a set carries the shape of each node it sets on'
            );
        else if ('match' in t)
          check(
            `${at}.target.shape`,
            t.id,
            'shape',
            t.shape,
            'a set carries the shape of the node it sets on'
          );
      }
    }
  });
  return problems;
}
