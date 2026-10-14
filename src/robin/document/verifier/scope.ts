/**
 * Declared scope (contract 6.4, architecture 5.3). One rule, no exceptions: every node the commit
 * touched, after the finalizers ran, is covered by a declaration.
 *
 * What the commit touched comes from the two trees, not from the changes: a node is changed when
 * its own content changed (its fields, or which children it holds and in what order), when it
 * moved, or when it was removed; nodes the write created need no declaration. What covers a node:
 *
 *   - its id, or an ancestor's id, in `scope.ids` (declaring a node covers everything below it);
 *   - a finalizer that declared it;
 *   - a bulk `set` that matched it, when the bulk target is repeated in `scope.bulk`;
 *   - for a node whose only change is which children it holds: every child added, removed or
 *     reordered being itself created or covered.
 *
 * Each bulk and format-entry `set` must also be repeated in `scope.bulk` and `scope.formats`.
 */
import type { RefusalProblem, WriteInput } from '../envelope';
import type { DocumentView, Pack } from '../pack';
import {
  canonicalJson,
  childIdLists,
  NfNode,
  ownContentText,
  withoutLists
} from '../tree';
import { bulkQuery } from './base';
import { problem } from './index';

export interface TreeDiff {
  /** Existing nodes whose own content changed, that moved, or whose children changed. */
  changed: Set<string>;
  removed: Set<string>;
  created: Set<string>;
  moved: Set<string>;
  /** Changed nodes whose only change is which children they hold or their order. */
  membershipOnly: Set<string>;
}

function ownFieldsText(node: NfNode, pack: Pack): string {
  return canonicalJson(withoutLists(node, pack.tree));
}

/** Longest common subsequence membership of `a` within `b` (ids common to both, in order). */
function lcsKeep(a: string[], b: string[]): Set<string> {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1)
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
  const keep = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      keep.add(a[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  return keep;
}

export function diffTrees(
  before: DocumentView,
  after: DocumentView,
  pack: Pack
): TreeDiff {
  const diff: TreeDiff = {
    changed: new Set(),
    removed: new Set(),
    created: new Set(),
    moved: new Set(),
    membershipOnly: new Set()
  };
  for (const node of before.nodes())
    if (!after.get(node.id)) diff.removed.add(node.id);
  for (const node of after.nodes()) {
    const old = before.get(node.id);
    if (!old) {
      diff.created.add(node.id);
      continue;
    }
    const pa = before.placement(node.id);
    const pb = after.placement(node.id);
    if (pa?.parent?.id !== pb?.parent?.id || pa?.key !== pb?.key) {
      diff.moved.add(node.id);
      diff.changed.add(node.id);
    }
    // compared as canonical text, not hashed: only equality matters here
    if (ownContentText(old, pack.tree) !== ownContentText(node, pack.tree)) {
      diff.changed.add(node.id);
      if (ownFieldsText(old, pack) === ownFieldsText(node, pack))
        diff.membershipOnly.add(node.id);
    }
    // children that stayed under this node but changed order
    const a = childIdLists(old, pack.tree);
    const b = childIdLists(node, pack.tree);
    for (const key of Object.keys(b)) {
      const common = new Set(
        (a[key] ?? []).filter((id) => b[key].includes(id))
      );
      const seqA = (a[key] ?? []).filter((id) => common.has(id));
      const seqB = b[key].filter((id) => common.has(id));
      const keep = lcsKeep(seqA, seqB);
      for (const id of seqB)
        if (!keep.has(id)) {
          diff.moved.add(id);
          diff.changed.add(id);
        }
    }
  }
  return diff;
}

export interface ScopeInputs {
  before: DocumentView;
  after: DocumentView;
  pack: Pack;
  diff: TreeDiff;
  write: WriteInput;
  /** Ids each bulk `set` matched, by change index. */
  bulkHits: Map<number, string[]>;
  finalizerIds: ReadonlySet<string>;
}

/** Ids every node the commit touched, for the result's `touched`. */
export function touchedIds(
  diff: TreeDiff,
  finalizerIds: ReadonlySet<string>
): string[] {
  return [
    ...new Set([
      ...diff.changed,
      ...diff.removed,
      ...diff.created,
      ...finalizerIds
    ])
  ];
}

export function scopeProblems(inputs: ScopeInputs): RefusalProblem[] {
  const { before, after, pack, diff, write, bulkHits, finalizerIds } = inputs;
  const problems: RefusalProblem[] = [];
  const declared = new Set(write.scope.ids);

  // bulk and format-entry sets must be repeated in scope
  const bulkDeclared = new Set(
    (write.scope.bulk ?? []).map((b) =>
      canonicalJson({ q: bulkQuery(b.find), t: b.total })
    )
  );
  const formatsDeclared = new Set(
    (write.scope.formats ?? []).map((f) =>
      canonicalJson({ id: f.id, r: f.referrers })
    )
  );
  const bulkCovered = new Set<string>();
  write.changes.forEach((change, index) => {
    if (change.kind !== 'set') return;
    const t = change.target;
    if ('find' in t) {
      if (
        !bulkDeclared.has(canonicalJson({ q: bulkQuery(t.find), t: t.total }))
      )
        problems.push(
          problem(
            'scope',
            `Nothing was applied: changes[${index}] is a bulk set whose query and total are not repeated in scope.bulk.`,
            {
              detail: [{ change: index, find: t.find, total: t.total }],
              hint: 'Repeat every bulk target, query and total, in scope.bulk.'
            }
          )
        );
      else for (const id of bulkHits.get(index) ?? []) bulkCovered.add(id);
    }
    if (
      'formatId' in t &&
      !formatsDeclared.has(canonicalJson({ id: t.formatId, r: t.referrers }))
    )
      problems.push(
        problem(
          'scope',
          `Nothing was applied: changes[${index}] changes shared format ${t.formatId} for ${t.referrers} node(s) but scope.formats does not acknowledge it.`,
          {
            detail: [{ change: index, id: t.formatId, referrers: t.referrers }],
            hint: 'Repeat every format-entry target, id and referrers, in scope.formats.'
          }
        )
      );
  });

  const declaredOrAncestor = (id: string): boolean => {
    if (declared.has(id)) return true;
    let p = before.placement(id)?.parent ?? null;
    while (p) {
      if (declared.has(p.id)) return true;
      p = before.placement(p.id)?.parent ?? null;
    }
    return false;
  };
  const memo = new Map<string, boolean>();
  const covered = (id: string): boolean => {
    if (diff.created.has(id)) return true;
    const known = memo.get(id);
    if (known !== undefined) return known;
    memo.set(id, false); // cycles cannot cover themselves
    let ok =
      declaredOrAncestor(id) || finalizerIds.has(id) || bulkCovered.has(id);
    if (!ok && diff.membershipOnly.has(id)) {
      const a = childIdLists(before.get(id) as NfNode, pack.tree);
      const b = childIdLists(after.get(id) as NfNode, pack.tree);
      const deltas = new Set<string>();
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const x = a[key] ?? [];
        const y = b[key] ?? [];
        for (const c of x) if (!y.includes(c)) deltas.add(c);
        for (const c of y)
          if (!x.includes(c) || diff.moved.has(c)) deltas.add(c);
      }
      ok = [...deltas].every(covered);
    }
    memo.set(id, ok);
    return ok;
  };

  const uncovered = [...diff.changed, ...diff.removed].filter(
    (id) => !covered(id)
  );
  if (uncovered.length) {
    const describe = (id: string) => {
      const node = before.get(id);
      const text = node ? pack.text(node) : null;
      return `${id} (${node?.kind ?? 'node'}${
        text ? ` "${text.slice(0, 40)}"` : ''
      })${diff.removed.has(id) ? ' removed' : ''}`;
    };
    problems.push(
      problem(
        'scope',
        `Nothing was applied: the change would touch ${
          uncovered.length
        } node(s) outside the declared scope: ${uncovered
          .slice(0, 8)
          .map(describe)
          .join('; ')}${uncovered.length > 8 ? '; ...' : ''}.`,
        {
          detail: uncovered.map((id) => ({
            id,
            removed: diff.removed.has(id)
          })),
          hint: 'Declare every node the write means to change in scope.ids, or leave the listed nodes as they are.'
        }
      )
    );
  }
  return problems;
}
