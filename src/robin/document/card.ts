/**
 * The review card's title, composed by the engine from what the change set did (architecture 7.5):
 * two to four words in the user's terms, counted at the level a person sees (a row added is one
 * row, not its cells, paragraphs and runs), with a parenthetical when the change also removes
 * something. Derived changes the finalizers made (recomputed values, restriped rows) are not what
 * the user asked for and are not counted.
 *
 * The diff kind table, in order of precedence:
 *
 *   Added      nodes the change created (outermost only)
 *   Moved      nodes that changed parent or order
 *   Edited     nodes whose text changed, counted at the nearest named ancestor
 *   Formatted  nodes whose properties changed and text did not
 *   Removed    nodes the change removed (outermost only); a parenthetical when not the title
 *
 * A pack names the kinds people count (`cardNouns`); a kind it does not name rolls up to its
 * nearest named ancestor (a run's edit is its paragraph's).
 */
import type { DocumentView, Pack } from './pack';
import type { NfNode } from './tree';
import type { TreeDiff } from './verifier/scope';

type Verb = 'Added' | 'Moved' | 'Edited' | 'Formatted' | 'Removed';
const ORDER: Verb[] = ['Added', 'Moved', 'Edited', 'Formatted', 'Removed'];

export interface CardTitleInput {
  pack: Pack;
  before: DocumentView;
  after: DocumentView;
  diff: TreeDiff;
  /** Ids only finalizers changed: derived, not counted. */
  derived: ReadonlySet<string>;
}

function phrase(
  nouns: Readonly<Record<string, readonly [string, string]>>,
  kind: string,
  count: number
): string {
  const [one, many] = nouns[kind] ?? [kind, `${kind}s`];
  return count === 1
    ? `${/^[aeiou]/i.test(one) ? 'an' : 'a'} ${one}`
    : `${count} ${many}`;
}

export function cardTitle({
  pack,
  before,
  after,
  diff,
  derived
}: CardTitleInput): string {
  const nouns = pack.cardNouns ?? {};
  const named = (view: DocumentView, id: string): NfNode | null => {
    let node = view.get(id) ?? null;
    while (node && !(node.kind in nouns))
      node = view.placement(node.id)?.parent ?? null;
    return node;
  };
  const buckets = new Map<Verb, Map<string, Set<string>>>();
  const add = (verb: Verb, node: NfNode | null) => {
    if (!node || !(node.kind in nouns)) return;
    const byKind = buckets.get(verb) ?? new Map<string, Set<string>>();
    const ids = byKind.get(node.kind) ?? new Set<string>();
    ids.add(node.id);
    byKind.set(node.kind, ids);
    buckets.set(verb, byKind);
  };
  const outermost = (view: DocumentView, ids: ReadonlySet<string>) =>
    [...ids].filter((id) => {
      const parent = view.placement(id)?.parent;
      return !parent || !ids.has(parent.id);
    });
  // something added or removed inside a node that stays (a run in a paragraph) edits that node
  for (const id of outermost(after, diff.created)) {
    const n = named(after, id);
    add(n && !diff.created.has(n.id) ? 'Edited' : 'Added', n);
  }
  for (const id of outermost(before, diff.removed)) {
    const n = named(before, id);
    if (n && !diff.removed.has(n.id)) add('Edited', after.get(n.id) ?? n);
    else add('Removed', n);
  }
  const inAdded = (id: string) => {
    let p = after.placement(id)?.parent;
    while (p) {
      if (diff.created.has(p.id)) return true;
      p = after.placement(p.id)?.parent;
    }
    return false;
  };
  for (const id of diff.moved)
    if (!diff.created.has(id) && !derived.has(id))
      add('Moved', named(after, id));
  for (const id of diff.changed) {
    if (diff.moved.has(id) || diff.created.has(id) || derived.has(id)) continue;
    if (diff.membershipOnly.has(id) || inAdded(id)) continue;
    const now = named(after, id);
    const was = now ? before.get(now.id) : undefined;
    if (!now || !was) continue;
    // text compared at the level counted: a run's edit is its paragraph's text changing; a
    // feature attribute (a formula, a binding) is content too
    const textChanged =
      JSON.stringify(pack.text(was)) !== JSON.stringify(pack.text(now));
    const original = before.get(id);
    const changedNode = after.get(id);
    const featureChanged = (pack.featureKeys ?? []).some(
      (k) =>
        JSON.stringify(original?.[k] ?? null) !==
        JSON.stringify(changedNode?.[k] ?? null)
    );
    add(textChanged || featureChanged ? 'Edited' : 'Formatted', now);
  }
  // what a person counts: collections the pack recognises (a column), the rest by kind
  const counts = new Map<Verb, Map<string, number>>();
  const allNouns: Record<string, readonly [string, string]> = { ...nouns };
  for (const [verb, byKind] of buckets) {
    const m = new Map<string, number>();
    const view = verb === 'Removed' ? before : after;
    for (const [kind, ids] of byKind) {
      const rest = new Set(ids);
      for (const group of pack.cardCollections?.(kind, [...ids], view) ?? []) {
        m.set(group.key, (m.get(group.key) ?? 0) + group.count);
        allNouns[group.key] = group.noun;
        group.ids.forEach((id) => rest.delete(id));
      }
      if (rest.size) m.set(kind, (m.get(kind) ?? 0) + rest.size);
    }
    counts.set(verb, m);
  }
  const total = (verb: Verb) =>
    [...(counts.get(verb)?.values() ?? [])].reduce((n, c) => n + c, 0);
  const describe = (verb: Verb) => {
    const byKind = [...(counts.get(verb) ?? new Map<string, number>())].sort(
      (a, b) => b[1] - a[1]
    );
    if (byKind.length === 1)
      return phrase(allNouns, byKind[0][0], byKind[0][1]);
    // several kinds under one verb: count them as items
    return `${total(verb)} items`;
  };
  const primary = ORDER.find((verb) => total(verb) > 0);
  // only derived changes: then they are what the change did (a recomputed value the user wrote)
  if (!primary && derived.size)
    return cardTitle({ pack, before, after, diff, derived: new Set() });
  if (!primary) return 'Changed the document';
  const title = `${primary} ${describe(primary)}`;
  if (primary !== 'Removed' && total('Removed') > 0)
    return `${title} (removes ${describe('Removed')})`;
  return title;
}
