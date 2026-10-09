/**
 * The proof step (architecture 4.4, 4.3a; contract section 8 `proof`).
 *
 * After a commit the live document is read back and compared, through the pack's own accept and
 * reject projections, with what was intended:
 *
 *   landed      accept(live) equals accept(intended): the change landed as asked, not beside the
 *               target and not partially;
 *   reversible  reject(live) equals reject(what rejecting should restore): by default the document
 *               before the write; a pack that applies some changes untracked says what instead.
 *
 * Equality is strict over content: ids are engine bookkeeping and format references compare by the
 * entry they name. The only differences admitted are the pack's enumerated normalizations, and the
 * ones that were needed are reported by name. A failed proof is rolled back until the editor's
 * bytes equal the bytes before the write.
 */
import { READ_ONLY_NODE_KEYS } from './envelope';
import { renameFormatRefs } from './ids';
import type { EditorHost, Pack, Residue } from './pack';
import {
  NormalForm,
  canonicalJson,
  clone,
  contentOf,
  hash64,
  indexTree,
  isPlainObject,
  walk
} from './tree';

/** A document as the proof compares it: no ids, format references replaced by entry content. */
export function comparable(pack: Pack, nf: NormalForm): unknown {
  const root = clone(nf.root);
  const byContent = new Map(
    Object.entries(nf.formats).map(([id, entry]) => [
      id,
      `format:${hash64(canonicalJson(entry))}`
    ])
  );
  renameFormatRefs(root, pack.formatRefKeys, byContent);
  return contentOf(root, { keepPending: true });
}

const READ_ONLY_BUT_PENDING = new Set<string>(
  READ_ONLY_NODE_KEYS.filter((k) => k !== 'pending')
);

/**
 * `canonicalJson(comparable(pack, nf))` in one pass, without the two intermediate copies: the
 * text the proof compares documents by.
 */
export function comparableText(pack: Pack, nf: NormalForm): string {
  const byContent = new Map(
    Object.entries(nf.formats).map(([id, entry]) => [
      id,
      `format:${hash64(canonicalJson(entry))}`
    ])
  );
  const refKeys = new Set(pack.formatRefKeys);
  const rec = (value: unknown): string => {
    if (value === undefined) return 'null';
    if (value === null || typeof value !== 'object')
      return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(rec).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter(
        (k) =>
          obj[k] !== undefined &&
          k !== 'id' &&
          k !== 'base' &&
          !READ_ONLY_BUT_PENDING.has(k)
      )
      .sort();
    return `{${keys
      .map((k) => {
        const child = obj[k];
        const named =
          refKeys.has(k) && typeof child === 'string' && byContent.has(child)
            ? byContent.get(child)
            : child;
        return `${JSON.stringify(k)}:${rec(named)}`;
      })
      .join(',')}}`;
  };
  return rec(nf.root);
}

/** Up to `limit` paths where two JSON values differ, for refusal detail. */
export function differences(a: unknown, b: unknown, limit = 6): string[] {
  const out: string[] = [];
  const rec = (x: unknown, y: unknown, path: string) => {
    if (out.length >= limit) return;
    if (canonicalJson(x) === canonicalJson(y)) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length)
        out.push(`${path || '/'}: ${x.length} items, expected ${y.length}`);
      for (let i = 0; i < Math.min(x.length, y.length); i += 1)
        rec(x[i], y[i], `${path}/${i}`);
      return;
    }
    if (isPlainObject(x) && isPlainObject(y)) {
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
        rec(x[key], y[key], `${path}/${key}`);
      return;
    }
    out.push(
      `${path || '/'}: ${JSON.stringify(x)?.slice(
        0,
        80
      )} where ${JSON.stringify(y)?.slice(0, 80)} was intended`
    );
  };
  rec(a, b, '');
  return out;
}

interface Comparison {
  equal: boolean;
  normalizations: string[];
  diff: string[];
}

/**
 * Strict equality, then equality with the pack's normalizations applied to both sides; names the
 * ones that changed either side (a normalization returns its input when it changes nothing, so
 * this costs no extra reads of the documents).
 */
function compareWithNormalizations(
  pack: Pack,
  live: NormalForm,
  intended: NormalForm
): Comparison {
  const canon = (nf: NormalForm) => comparableText(pack, nf);
  if (canon(live) === canon(intended))
    return { equal: true, normalizations: [], diff: [] };
  let l = live;
  let i = intended;
  const used: string[] = [];
  for (const n of pack.projections.normalizations) {
    const nl = n.apply(l);
    const ni = n.apply(i);
    if (nl !== l || ni !== i) used.push(n.name);
    l = nl;
    i = ni;
  }
  const equal = canon(l) === canon(i);
  return {
    equal,
    normalizations: equal ? used : [],
    diff: equal ? [] : differences(comparable(pack, l), comparable(pack, i))
  };
}

export interface ProofOutcome {
  passed: boolean;
  /** accept(live) equals accept(intended). */
  landed: boolean;
  /** reject(live) equals reject(what rejecting should restore). */
  reversible: boolean;
  /** Every surviving node's conserved residue is what the write intended. */
  conserved: boolean;
  /** The pending changes not authored by this turn are exactly those the document had before. */
  authorship: boolean;
  normalizations: string[];
  landedDiff: string[];
  reversibleDiff: string[];
  conservedDiff: string[];
  authorshipDiff: string[];
}

export interface ProofInput {
  before: NormalForm;
  intended: NormalForm;
  /** The live document read back, with engine ids continued from the intended one. */
  live: NormalForm;
  turnId: string;
  intendedResidue: Residue;
  liveResidue: Residue;
}

/** Residue the commit must not have changed, for every node the intended document keeps. */
function residueConserved(pack: Pack, input: ProofInput): string[] {
  const view = pack.projections.conservedResidue ?? ((entry: unknown) => entry);
  const live = indexTree(input.live.root, pack.tree);
  const out: string[] = [];
  for (const [id, entry] of Object.entries(input.intendedResidue)) {
    if (id !== input.live.root.id && !live.has(id)) continue;
    const want = canonicalJson(view(entry));
    const got = canonicalJson(view(input.liveResidue[id]));
    if (want !== got)
      out.push(
        `${id}: native data the normal form does not show changed or was lost`
      );
    if (out.length >= 6) break;
  }
  return out;
}

/** Pending annotations as a sorted multiset of canonical texts. */
function pendingMultiset(
  pack: Pack,
  nf: NormalForm,
  keep: (p: unknown) => boolean
): string[] {
  const out: string[] = [];
  walk(nf.root, pack.tree, ({ node }) => {
    if (node.pending !== undefined && keep(node.pending))
      out.push(canonicalJson(node.pending));
  });
  return out.sort();
}

/** Pending changes not authored by this turn: exactly those the document had before. */
function authorshipKept(pack: Pack, input: ProofInput): string[] {
  const before = pendingMultiset(pack, input.before, () => true);
  const { othersOf, authoredBy } = pack.projections;
  const after = othersOf
    ? (() => {
        const out: string[] = [];
        walk(input.live.root, pack.tree, ({ node }) => {
          if (node.pending === undefined) return;
          const rest = othersOf(node.pending, input.turnId);
          if (rest !== null && rest !== undefined)
            out.push(canonicalJson(rest));
        });
        return out.sort();
      })()
    : pendingMultiset(pack, input.live, (p) => !authoredBy(p, input.turnId));
  if (canonicalJson(before) === canonicalJson(after)) return [];
  const count = (list: string[]) =>
    list.reduce(
      (m, x) => m.set(x, (m.get(x) ?? 0) + 1),
      new Map<string, number>()
    );
  const a = count(before);
  const b = count(after);
  const out: string[] = [];
  for (const [k, n] of a)
    if ((b.get(k) ?? 0) < n) out.push(`lost or re-authored: ${k}`);
  for (const [k, n] of b)
    if ((a.get(k) ?? 0) < n) out.push(`not grouped under this change: ${k}`);
  return out.slice(0, 6);
}

export function prove(pack: Pack, input: ProofInput): ProofOutcome {
  const { before, intended, live } = input;
  const { accept, reject, expectedRejection } = pack.projections;
  const landed = compareWithNormalizations(
    pack,
    accept(live),
    accept(intended)
  );
  const restores = expectedRejection
    ? expectedRejection(before, intended)
    : before;
  const reversible = compareWithNormalizations(
    pack,
    reject(live),
    reject(restores)
  );
  const conservedDiff = residueConserved(pack, input);
  const authorshipDiff = authorshipKept(pack, input);
  return {
    passed:
      landed.equal &&
      reversible.equal &&
      !conservedDiff.length &&
      !authorshipDiff.length,
    landed: landed.equal,
    reversible: reversible.equal,
    conserved: !conservedDiff.length,
    authorship: !authorshipDiff.length,
    normalizations: [
      ...new Set([...landed.normalizations, ...reversible.normalizations])
    ],
    landedDiff: landed.diff,
    reversibleDiff: reversible.diff,
    conservedDiff,
    authorshipDiff
  };
}

/**
 * Whether two native documents are the same document under the pack's enumerated normalizations:
 * what a native undo or a reopen restores when it is not byte-stable.
 */
export function equivalentNative(pack: Pack, a: string, b: string): boolean {
  if (a === b) return true;
  const normalized = (native: string) => {
    let nf = pack.adapter.toNormalForm(native).nf;
    for (const n of [
      ...pack.projections.normalizations,
      ...(pack.projections.undoNormalizations ?? [])
    ])
      nf = n.apply(nf);
    return comparableText(pack, nf);
  };
  return normalized(a) === normalized(b);
}

export interface RollbackOutcome {
  byteEqual: boolean;
  /** Back to the same document under the pack's normalizations, though not byte-exact. */
  equivalent: boolean;
  via: 'nothing' | 'editor-undo' | 'snapshot';
  undoSteps: number;
}

/**
 * Put the editor back to the document before the write. Native undo is tried at most `undoLimit`
 * times, the number of undo groups the commit itself added, and stops as soon as the document is
 * back, byte-exact or equivalent under `equivalent`; so a native group that does not undo
 * byte-exact never takes the user's own edits with it. Only when undo cannot get back is the
 * snapshot reopened, which clears the editor's history.
 */
export function rollback(
  host: EditorHost,
  beforeNative: string,
  {
    undoLimit,
    equivalent = () => false
  }: { undoLimit: number; equivalent?: (native: string) => boolean }
): RollbackOutcome {
  if (host.serialize() === beforeNative)
    return { byteEqual: true, equivalent: true, via: 'nothing', undoSteps: 0 };
  let steps = 0;
  while (steps < undoLimit && host.canUndo()) {
    host.undo();
    steps += 1;
    const now = host.serialize();
    if (now === beforeNative)
      return {
        byteEqual: true,
        equivalent: true,
        via: 'editor-undo',
        undoSteps: steps
      };
    if (equivalent(now))
      return {
        byteEqual: false,
        equivalent: true,
        via: 'editor-undo',
        undoSteps: steps
      };
  }
  host.open(beforeNative);
  const byteEqual = host.serialize() === beforeNative;
  return {
    byteEqual,
    equivalent: byteEqual,
    via: 'snapshot',
    undoSteps: steps
  };
}
